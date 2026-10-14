import { Hono } from 'hono';
import { z } from 'zod';
import { ownTweetUrl, release, releaseMessage } from '../domain/release';
import { siteConfig, type Env } from '../env';
import { drainTelegram, queueTelegram, telegramCall, telegramReady } from '../telegram/delivery';
import { problem, readJson, timingSafeEqual } from '../util/http';

export const telegramAdmin = new Hono<{ Bindings: Env }>();
export const telegramWebhook = new Hono<{ Bindings: Env }>();

telegramAdmin.get('/status', async (c) => {
  const messages = await c.env.DB.prepare('SELECT dedupe_key, kind, status, attempts, telegram_message_id, last_error, created_at, sent_at FROM telegram_outbox ORDER BY created_at DESC LIMIT 20').all();
  return c.json({ configured: telegramReady(c.env), owner_configured: !!c.env.TELEGRAM_OWNER_USER_ID, webhook_configured: !!c.env.TELEGRAM_WEBHOOK_SECRET, destination: c.env.TELEGRAM_CHAT_ID ?? null, messages: messages.results });
});

telegramAdmin.post('/release', async (c) => {
  if (!telegramReady(c.env)) return problem(c, 503, 'telegram_not_configured', 'Telegram bot connection is not configured.');
  const raw = await readJson(c, 2048);
  const parsed = z.object({ release_id: z.string(), version_id: z.string().uuid() }).safeParse(raw.ok ? raw.value : null);
  if (!parsed.success) return problem(c, 400, 'invalid_release', 'release_id and version_id are required.');
  if (parsed.data.release_id !== release.id || parsed.data.version_id !== c.env.WORKER_VERSION?.id)
    return problem(c, 409, 'build_mismatch', 'The requested release and version must match the live Worker.');
  if (!release.announce) return c.json({ queued: false, reason: 'This release is marked silent.' });
  const queued = await queueTelegram(c.env, `release:${release.id}`, 'release', releaseMessage(siteConfig(c.env).siteUrl));
  c.executionCtx.waitUntil(drainTelegram(c.env));
  return c.json({ queued, release_id: release.id });
});

telegramAdmin.post('/share', async (c) => {
  if (!telegramReady(c.env)) return problem(c, 503, 'telegram_not_configured', 'Telegram bot connection is not configured.');
  const raw = await readJson(c, 2048);
  const parsed = z.object({ url: z.string() }).safeParse(raw.ok ? raw.value : null);
  const tweet = parsed.success ? ownTweetUrl(parsed.data.url) : null;
  if (!tweet) return problem(c, 400, 'invalid_tweet', 'Provide an https post link from @clauderesets.');
  const queued = await queueTelegram(c.env, `tweet:${tweet.id}`, 'tweet', `New post from Claude Resets\n\n${tweet.url}`);
  c.executionCtx.waitUntil(drainTelegram(c.env));
  return c.json({ queued, url: tweet.url });
});

telegramAdmin.post('/drain', async (c) => c.json(await drainTelegram(c.env)));

const HELP = 'Claude Resets Updates\n\nSend /share followed by an @clauderesets post link to publish it to our Telegram community. Repeated links are ignored.\n\nLive build announcements are automatic after deployment verification.';

telegramWebhook.post('/webhook', async (c) => {
  c.header('cache-control', 'no-store');
  const secret = c.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || secret.length < 24) return problem(c, 503, 'webhook_not_configured', 'Telegram webhook is not configured.');
  if (!timingSafeEqual(c.req.header('x-telegram-bot-api-secret-token') ?? '', secret)) return problem(c, 401, 'unauthorized', 'Invalid webhook authentication.');
  const raw = await readJson(c, 16 * 1024);
  const parsed = z.object({
    update_id: z.number().int().nonnegative(),
    message: z.object({ from: z.object({ id: z.number().int(), is_bot: z.boolean().optional() }), chat: z.object({ id: z.number().int(), type: z.string() }), text: z.string().max(4096).optional() }).optional(),
  }).safeParse(raw.ok ? raw.value : null);
  if (!parsed.success) return problem(c, 400, 'invalid_update', 'Invalid Telegram update.');
  const message = parsed.data.message;
  // Only the bound owner in a private chat can publish. Group messages and all other users are ignored.
  if (!message || message.chat.type !== 'private' || message.from.is_bot || String(message.from.id) !== c.env.TELEGRAM_OWNER_USER_ID || !telegramReady(c.env)) return c.json({ ok: true });
  const match = message.text?.trim().match(/^\/share(?:@[A-Za-z0-9_]+)?\s+(\S+)$/i);
  const tweet = match ? ownTweetUrl(match[1]!) : null;
  // Queue first: a crash after recording the incoming receipt must not lose the actual announcement.
  const queued = tweet ? await queueTelegram(c.env, `tweet:${tweet.id}`, 'tweet', `New post from Claude Resets\n\n${tweet.url}`) : false;
  const receipt = await c.env.DB.prepare('INSERT OR IGNORE INTO telegram_incoming (update_id, received_at) VALUES (?1, ?2)').bind(parsed.data.update_id, new Date().toISOString()).run();
  if (!receipt.meta.changes) return c.json({ ok: true });
  let reply = HELP;
  if (match) {
    if (tweet) {
      reply = queued ? 'Queued for our Telegram community.' : 'That post is already recorded. It will not be posted twice.';
      c.executionCtx.waitUntil(drainTelegram(c.env));
    } else reply = 'Use a post link from @clauderesets, such as /share https://x.com/clauderesets/status/…';
  }
  c.executionCtx.waitUntil(telegramCall(c.env, 'sendMessage', { chat_id: message.chat.id, text: reply }));
  return c.json({ ok: true });
});
