// Connect the already-created bot after the Worker is live. Credentials are never printed.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT, fail, readWranglerVars } from './lib';

const file = path.join(ROOT, '.production-secrets.env');
if (existsSync(file)) process.loadEnvFile(file);
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const owner = process.env.TELEGRAM_OWNER_USER_ID;
const vars = readWranglerVars();
if (!token || !secret || !owner || !vars.SITE_URL || !vars.TELEGRAM_CHAT_ID) fail('Telegram connection settings are incomplete.');

async function call(method: string, body: unknown = {}): Promise<any> {
  let result;
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    result = await response.json() as { ok?: boolean; result?: unknown };
  } catch { fail(`Telegram ${method} connection failed.`); }
  if (!result.ok) fail(`Telegram ${method} was rejected. Check the connection and permissions.`);
  return result.result;
}

const me = await call('getMe');
const chat = await call('getChat', { chat_id: vars.TELEGRAM_CHAT_ID });
const member = await call('getChatMember', { chat_id: chat.id, user_id: me.id });
if (chat.type === 'channel' ? member.status !== 'administrator' || !member.can_post_messages : !['member', 'administrator', 'creator'].includes(member.status)) fail('The bot is not allowed to post to the destination.');
await call('setMyDescription', { description: 'Live release summaries and X post links from Claude Resets, an independent Claude usage-limit tracker. The owner can share a post here using /share.' });
await call('setMyShortDescription', { short_description: 'Claude Resets site updates and post sharing. Independent tracker.' });
await call('setMyCommands', { scope: { type: 'chat', chat_id: Number(owner) }, commands: [{ command: 'share', description: 'Share an @clauderesets X post with our community' }, { command: 'help', description: 'Show the announcement bot instructions' }] });
await call('setWebhook', { url: `${vars.SITE_URL}/telegram/webhook`, secret_token: secret, allowed_updates: ['message'], max_connections: 1 });
const webhook = await call('getWebhookInfo');
if (webhook.url !== `${vars.SITE_URL}/telegram/webhook`) fail('Webhook registration was not confirmed.');
console.log(`✔ Connected @${me.username} to ${vars.TELEGRAM_CHAT_ID}. Owner-only commands and the authenticated webhook are active.`);
