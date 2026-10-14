import type { Env } from '../env';

export function telegramReady(env: Env): boolean {
  return env.TELEGRAM_ENABLED === 'true' && /^\d+:[A-Za-z0-9_-]{20,}$/.test(env.TELEGRAM_BOT_TOKEN ?? '') && !!env.TELEGRAM_CHAT_ID;
}

type SendResult = { status: 'sent'; messageId: number } | { status: 'retry'; afterSeconds: number } | { status: 'failed' | 'unknown' };
export type TelegramTransport = (text: string) => Promise<SendResult>;

/** Never surface network errors: their URL can contain the bot token. */
export async function telegramCall(env: Env, method: string, payload: unknown): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15_000),
    });
    const json: unknown = await response.json();
    return json && typeof json === 'object' ? json as Record<string, unknown> : null;
  } catch { return null; }
}

function transport(env: Env): TelegramTransport {
  return async (text) => {
    const response = await telegramCall(env, 'sendMessage', { chat_id: env.TELEGRAM_CHAT_ID, text });
    const result = response?.result as { message_id?: number } | undefined;
    if (response?.ok === true && Number.isSafeInteger(result?.message_id)) return { status: 'sent', messageId: result!.message_id! };
    if (response?.ok === false) {
      const retry = response.parameters as { retry_after?: number } | undefined;
      if (response.error_code === 429) return { status: 'retry', afterSeconds: Math.max(30, retry?.retry_after ?? 60) };
      return { status: 'failed' };
    }
    return { status: 'unknown' };
  };
}

export async function queueTelegram(env: Env, key: string, kind: 'release' | 'tweet', text: string, now = new Date()): Promise<boolean> {
  const result = await env.DB.prepare('INSERT OR IGNORE INTO telegram_outbox (dedupe_key, kind, text, next_attempt_at, created_at) VALUES (?1, ?2, ?3, ?4, ?4)')
    .bind(key, kind, text, now.toISOString()).run();
  return result.meta.changes > 0;
}

/** D1 lease prevents overlapping runs. A lost delivery response is held, since Telegram has no idempotency key. */
export async function drainTelegram(env: Env, options: { now?: Date; send?: TelegramTransport } = {}) {
  const report = { sent: 0, retry: 0, failed: 0, unknown: 0, configured: telegramReady(env) };
  if (!report.configured) return report;
  const now = options.now ?? new Date();
  const at = now.toISOString();
  await env.DB.prepare("UPDATE telegram_outbox SET status = 'unknown', last_error = 'Delivery interrupted; verify channel before any resend', lease_token = NULL WHERE status = 'sending' AND leased_until <= ?1").bind(at).run();
  const token = crypto.randomUUID();
  const lease = new Date(now.getTime() + 5 * 60_000).toISOString();
  const claimed = await env.DB.prepare("UPDATE telegram_outbox SET status = 'sending', attempts = attempts + 1, leased_until = ?1, lease_token = ?2 WHERE dedupe_key IN (SELECT dedupe_key FROM telegram_outbox WHERE status = 'pending' AND next_attempt_at <= ?3 ORDER BY created_at LIMIT 5) RETURNING dedupe_key, text, attempts")
    .bind(lease, token, at).all<{ dedupe_key: string; text: string; attempts: number }>();
  for (const row of claimed.results ?? []) {
    let result: SendResult;
    try { result = await (options.send ?? transport(env))(row.text); } catch { result = { status: 'unknown' }; }
    const status = result.status === 'retry' ? (row.attempts >= 6 ? 'failed' : 'pending') : result.status;
    const next = result.status === 'retry' ? new Date(now.getTime() + Math.min(result.afterSeconds, 86_400) * 1000).toISOString() : at;
    const messageId = result.status === 'sent' ? result.messageId : null;
    const error = result.status === 'unknown' ? 'Delivery uncertain; verify channel before any resend' : status === 'failed' ? 'Telegram rejected this message; check bot permissions' : null;
    await env.DB.prepare('UPDATE telegram_outbox SET status = ?1, next_attempt_at = ?2, leased_until = NULL, lease_token = NULL, telegram_message_id = ?3, last_error = ?4, sent_at = ?5 WHERE dedupe_key = ?6 AND lease_token = ?7')
      .bind(status, next, messageId, error, status === 'sent' ? at : null, row.dedupe_key, token).run();
    if (status === 'sent') report.sent++;
    else if (status === 'pending') report.retry++;
    else if (status === 'failed') report.failed++;
    else report.unknown++;
  }
  return report;
}
