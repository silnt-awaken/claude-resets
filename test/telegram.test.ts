import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ownTweetUrl, release } from '../src/domain/release';
import type { Env } from '../src/env';
import { drainTelegram, queueTelegram } from '../src/telegram/delivery';
import { adminInit, clearDb, env, json, request } from './helpers';

const VERSION = '11111111-1111-4111-8111-111111111111';
const SECRET = 'test-telegram-webhook-secret-only';
const SETTINGS: Partial<Env> = { TELEGRAM_ENABLED: 'true', TELEGRAM_BOT_TOKEN: '123456789:test-token-not-a-real-bot-token', TELEGRAM_CHAT_ID: '@clauderesets', TELEGRAM_OWNER_USER_ID: '42', TELEGRAM_WEBHOOK_SECRET: SECRET, WORKER_VERSION: { id: VERSION, tag: '', timestamp: '' } };
const bindings = () => ({ ...(env as unknown as Env), ...SETTINGS } as Env);
const NOW = new Date('2026-10-08T20:00:00Z');
const URL = 'https://x.com/clauderesets/status/2108313497389920459';

beforeEach(async () => { await clearDb(); });
afterEach(() => { vi.restoreAllMocks(); });

function webhook(user = 42, text = `/share ${URL}`, update = 100, type = 'private') {
  return { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': SECRET }, body: JSON.stringify({ update_id: update, message: { from: { id: user }, chat: { id: user, type }, text } }) };
}

describe('Telegram publication boundaries', () => {
  it('only accepts our own post URLs and canonicalizes tracking parameters', () => {
    expect(ownTweetUrl(URL + '?s=20')?.url).toBe(URL);
    expect(ownTweetUrl(URL.replace('x.com/clauderesets', 'twitter.com/ClaudeResets'))?.url).toBe(URL);
    for (const bad of [URL.replace('clauderesets', 'AnthropicAI'), URL.replace('x.com', 'x.com.evil.example'), URL.replace('https:', 'http:'), URL + '/photo/1', URL.replace('x.com', 'user:pass@x.com')]) expect(ownTweetUrl(bad)).toBeNull();
  });

  it('requires the private admin token and exact live build for release announcements', async () => {
    expect((await request('/admin/telegram/release', { method: 'POST' }, SETTINGS)).status).toBe(401);
    const body = { release_id: release.id, version_id: VERSION };
    expect((await request('/admin/telegram/release', adminInit({ ...body, release_id: 'old-release' }), SETTINGS)).status).toBe(409);
    expect((await request('/admin/telegram/release', adminInit(body), { ...SETTINGS, TELEGRAM_BOT_TOKEN: '' })).status).toBe(503);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true, result: { message_id: 88 } })));
    expect((await json<{ queued: boolean }>('/admin/telegram/release', adminInit(body), SETTINGS)).body.queued).toBe(true);
    expect((await json<{ queued: boolean }>('/admin/telegram/release', adminInit(body), SETTINGS)).body.queued).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects forged webhooks and ignores strangers or group commands', async () => {
    const mock = vi.spyOn(globalThis, 'fetch');
    const init = webhook();
    init.headers['x-telegram-bot-api-secret-token'] = 'forged';
    expect((await request('/telegram/webhook', init, SETTINGS)).status).toBe(401);
    expect((await request('/telegram/webhook', webhook(99), SETTINGS)).status).toBe(200);
    expect((await request('/telegram/webhook', webhook(42, `/share ${URL}`, 101, 'supergroup'), SETTINGS)).status).toBe(200);
    expect(mock).not.toHaveBeenCalled();
    expect(await bindings().DB.prepare('SELECT COUNT(*) AS n FROM telegram_outbox').first('n')).toBe(0);
  });

  it('lets only the owner share a post and suppresses duplicate updates and duplicate post links', async () => {
    const mock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ ok: true, result: { message_id: 89 } })));
    expect((await request('/telegram/webhook', webhook(), SETTINGS)).status).toBe(200);
    await request('/telegram/webhook', webhook(), SETTINGS);
    await request('/telegram/webhook', webhook(42, `/share ${URL}?s=20`, 102), SETTINGS);
    const channelCalls = mock.mock.calls.filter(([, init]) => JSON.parse(String(init?.body)).chat_id === '@clauderesets');
    expect(channelCalls).toHaveLength(1);
    expect(await bindings().DB.prepare('SELECT COUNT(*) AS n FROM telegram_outbox').first('n')).toBe(1);
  });

  it('exposes a fresh public build marker without any bot credentials', async () => {
    const res = await request('/api/v1/build', {}, SETTINGS);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const text = await res.text();
    expect(text).toContain(VERSION);
    expect(text).toContain(release.id);
    expect(text).not.toContain(SETTINGS.TELEGRAM_BOT_TOKEN);
  });
});

describe('Telegram durable delivery', () => {
  it('leases atomically so overlapping drains cannot send twice', async () => {
    await queueTelegram(bindings(), 'tweet:one', 'tweet', 'One post', NOW);
    const send = vi.fn(async () => ({ status: 'sent' as const, messageId: 90 }));
    await Promise.all([drainTelegram(bindings(), { now: NOW, send }), drainTelegram(bindings(), { now: NOW, send })]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await bindings().DB.prepare('SELECT status FROM telegram_outbox').first('status')).toBe('sent');
  });

  it('holds ambiguous delivery without automatically duplicating a message', async () => {
    await queueTelegram(bindings(), 'tweet:uncertain', 'tweet', 'One post', NOW);
    const send = vi.fn(async () => { throw new Error('lost response'); });
    expect((await drainTelegram(bindings(), { now: NOW, send })).unknown).toBe(1);
    await drainTelegram(bindings(), { now: new Date(NOW.getTime() + 600_000), send });
    expect(send).toHaveBeenCalledTimes(1);
    expect(await bindings().DB.prepare('SELECT status FROM telegram_outbox').first('status')).toBe('unknown');
  });

  it('retries an explicit rate-limit rejection after its delay', async () => {
    await queueTelegram(bindings(), 'tweet:limited', 'tweet', 'One post', NOW);
    expect((await drainTelegram(bindings(), { now: NOW, send: async () => ({ status: 'retry', afterSeconds: 60 }) })).retry).toBe(1);
    const send = vi.fn(async () => ({ status: 'sent' as const, messageId: 91 }));
    await drainTelegram(bindings(), { now: new Date(NOW.getTime() + 59_000), send });
    expect(send).not.toHaveBeenCalled();
    await drainTelegram(bindings(), { now: new Date(NOW.getTime() + 60_000), send });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('holds an abandoned sending lease and keeps unconfigured delivery quiet', async () => {
    await queueTelegram(bindings(), 'tweet:crashed', 'tweet', 'One post', NOW);
    await bindings().DB.prepare("UPDATE telegram_outbox SET status='sending', leased_until=?1").bind(NOW.toISOString()).run();
    const send = vi.fn(async () => ({ status: 'sent' as const, messageId: 92 }));
    await drainTelegram(bindings(), { now: NOW, send });
    expect(send).not.toHaveBeenCalled();
    expect(await bindings().DB.prepare('SELECT status FROM telegram_outbox').first('status')).toBe('unknown');
    expect((await drainTelegram({ ...bindings(), TELEGRAM_ENABLED: 'false' }, { now: NOW, send })).configured).toBe(false);
  });
});
