import { beforeEach, describe, expect, it } from 'vitest';
import { __setContentForTests } from '../src/domain/content';
import type { Env } from '../src/env';
import { buildPayload, createAlert, drainPushJobs, type PushTransport } from '../src/push/delivery';
import { countActiveSubscriptions, validateSubscription } from '../src/push/subscriptions';
import { makeEvent, snapshotFor } from './fixtures';
import { clearDb, env, fakeSubscription, json, request } from './helpers';

const db = () => (env as unknown as Env).DB;
const NOW = new Date('2026-09-17T12:00:00Z');

beforeEach(async () => {
  await clearDb();
  __setContentForTests(null);
});

function fakeTransport(plan: (endpoint: string, attempt: number) => number | Error): PushTransport & { sent: Array<{ endpoint: string; title: string; url: string }>; calls: Map<string, number> } {
  const calls = new Map<string, number>();
  const sent: Array<{ endpoint: string; title: string; url: string }> = [];
  return {
    sent,
    calls,
    async send(sub, payload) {
      const n = (calls.get(sub.endpoint) ?? 0) + 1;
      calls.set(sub.endpoint, n);
      const outcome = plan(sub.endpoint, n);
      if (outcome instanceof Error) throw outcome;
      if (outcome >= 200 && outcome < 300) sent.push({ endpoint: sub.endpoint, title: payload.title, url: payload.url });
      return { status: outcome };
    },
  };
}

async function subscribe(n: number, locale = 'en', createdAt?: string) {
  const res = await request('/api/v1/push/subscriptions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subscription: fakeSubscription(n), locale }) });
  expect(res.status).toBe(201);
  if (createdAt) await db().prepare('UPDATE push_subscriptions SET created_at = ?1 WHERE endpoint = ?2').bind(createdAt, fakeSubscription(n).endpoint).run();
  return fakeSubscription(n).endpoint;
}

describe('subscription validation', () => {
  it('accepts supported push services and rejects unsafe endpoints and malformed keys', () => {
    expect(validateSubscription(fakeSubscription(1)).ok).toBe(true);
    expect(validateSubscription(fakeSubscription(2, 'updates.push.services.mozilla.com')).ok).toBe(true);
    expect(validateSubscription(fakeSubscription(3, 'web.push.apple.com')).ok).toBe(true);
    expect(validateSubscription(fakeSubscription(4, 'wns2-bn1p.notify.windows.com')).ok).toBe(true);
    const bad = (mut: (s: ReturnType<typeof fakeSubscription>) => unknown) => {
      const s = fakeSubscription(9);
      return validateSubscription(mut(s) ?? s);
    };
    expect(bad((s) => ({ ...s, endpoint: 'http://fcm.googleapis.com/x' })).ok).toBe(false);
    expect(bad((s) => ({ ...s, endpoint: 'https://evil.example/hook' })).ok).toBe(false);
    expect(bad((s) => ({ ...s, endpoint: 'https://10.0.0.1/hook' })).ok).toBe(false);
    expect(bad((s) => ({ ...s, endpoint: 'https://localhost/hook' })).ok).toBe(false);
    expect(bad((s) => ({ ...s, endpoint: 'https://fcm.googleapis.com.evil.example/x' })).ok).toBe(false);
    expect(bad((s) => ({ ...s, endpoint: 'https://user:pw@fcm.googleapis.com/x' })).ok).toBe(false);
    expect(bad((s) => ({ ...s, keys: { ...s.keys, p256dh: 'short' } })).ok).toBe(false);
    expect(bad((s) => ({ ...s, keys: { ...s.keys, auth: s.keys.auth + 'AAAA' } })).ok).toBe(false);
    expect(bad((s) => ({ ...s, keys: { ...s.keys, auth: 'not+base64url/=' } })).ok).toBe(false);
    expect(validateSubscription('nope').ok).toBe(false);
  });

  it('stores, checks, and removes subscriptions through the HTTP API', async () => {
    const endpoint = await subscribe(1);
    expect((await json<{ active: boolean }>('/api/v1/push/subscriptions/check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint }) })).body.active).toBe(true);
    const again = await request('/api/v1/push/subscriptions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subscription: fakeSubscription(1) }) });
    expect(again.status).toBe(201);
    expect(await countActiveSubscriptions(db())).toBe(1);
    const del = await json<{ removed: boolean }>('/api/v1/push/subscriptions', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint }) });
    expect(del.body.removed).toBe(true);
    expect((await json<{ active: boolean }>('/api/v1/push/subscriptions/check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint }) })).body.active).toBe(false);
    expect((await request('/api/v1/push/subscriptions', { method: 'POST', body: '{"subscription":{"endpoint":"https://evil.example"}}', headers: { 'content-type': 'application/json' } })).status).toBe(400);
    expect((await request('/api/v1/push/subscriptions', { method: 'POST', body: 'x'.repeat(9000), headers: { 'content-type': 'application/json' } })).status).toBe(413);
  });

  it('refuses subscriptions when browser alerts are not configured', async () => {
    const res = await request('/api/v1/push/subscriptions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subscription: fakeSubscription(1) }) }, { BROWSER_ALERTS_ENABLED: 'false' });
    expect(res.status).toBe(503);
  });
});

describe('alert creation and delivery', () => {
  const event = makeEvent({ id: 'fresh', at: '2026-09-17T09:00:00Z', title: 'Fresh reset' });

  it('is idempotent and honours the subscription cutoff', async () => {
    await subscribe(1, 'en', '2026-09-17T10:00:00Z');
    await subscribe(2, 'ja', '2026-09-17T10:30:00Z');
    const cutoff = new Date('2026-09-17T11:00:00Z');
    const first = await createAlert(db(), event, 'reset', cutoff, cutoff);
    expect(first.created).toBe(true);
    expect(first.jobs).toBe(2);
    await subscribe(3, 'en', '2026-09-17T11:30:00Z'); // joined after the cutoff
    const again = await createAlert(db(), event, 'reset', cutoff, cutoff);
    expect(again.created).toBe(false);
    expect(again.jobs).toBe(0);
    const jobs = await db().prepare('SELECT COUNT(*) AS n FROM push_jobs').first<{ n: number }>();
    expect(jobs?.n).toBe(2);
  });

  it('delivers localized payloads that deep-link to the event page', async () => {
    __setContentForTests(snapshotFor([event]));
    await subscribe(1, 'en', '2026-09-17T10:00:00Z');
    await subscribe(2, 'ja', '2026-09-17T10:00:00Z');
    await createAlert(db(), event, 'reset', NOW, NOW);
    const transport = fakeTransport(() => 201);
    const result = await drainPushJobs(env as unknown as Env, { now: NOW, transport });
    expect(result).toMatchObject({ leased: 2, sent: 2, failed: 0, retried: 0, expired: 0, paused: false });
    expect(transport.sent.map((s) => s.url).sort()).toEqual(['/ja/resets/fresh', '/resets/fresh']);
    expect(transport.sent.find((s) => s.url.startsWith('/ja'))!.title).toContain('ja fresh');
    const payload = buildPayload(event, 'en', 'Claude Resets', 'reset');
    expect(payload.title).toBe('Claude Resets: Fresh reset');
    expect(payload.tag).toBe('claude-reset-fresh-reset');
    const second = await drainPushJobs(env as unknown as Env, { now: NOW, transport });
    expect(second.leased).toBe(0);
  });

  it('retries transient failures with backoff, gives up permanently, and drops gone subscriptions', async () => {
    __setContentForTests(snapshotFor([event]));
    const gone = await subscribe(1, 'en', '2026-09-17T10:00:00Z');
    const flaky = await subscribe(2, 'en', '2026-09-17T10:00:00Z');
    const broken = await subscribe(3, 'en', '2026-09-17T10:00:00Z');
    await createAlert(db(), event, 'reset', NOW, NOW);
    const transport = fakeTransport((endpoint, attempt) => (endpoint === gone ? 410 : endpoint === flaky ? (attempt === 1 ? 503 : 201) : new Error('network down')));
    const r1 = await drainPushJobs(env as unknown as Env, { now: NOW, transport, maxAttempts: 2 });
    expect(r1).toMatchObject({ leased: 3, sent: 0, failed: 1, retried: 2 });
    expect(await countActiveSubscriptions(db())).toBe(2);
    const early = await drainPushJobs(env as unknown as Env, { now: new Date(NOW.getTime() + 5_000), transport, maxAttempts: 2 });
    expect(early.leased).toBe(0); // backoff not elapsed
    const later = new Date(NOW.getTime() + 60_000);
    const r2 = await drainPushJobs(env as unknown as Env, { now: later, transport, maxAttempts: 2 });
    expect(r2).toMatchObject({ leased: 2, sent: 1, failed: 1 });
    const rows = await db().prepare('SELECT status, attempts FROM push_jobs ORDER BY id').all<{ status: string; attempts: number }>();
    expect(rows.results.map((r) => r.status).sort()).toEqual(['failed', 'failed', 'sent']);
    expect(transport.calls.get(broken)).toBe(2);
  });

  it('skips a subscriber who unsubscribed during retry and expires stale alerts', async () => {
    __setContentForTests(snapshotFor([event]));
    const endpoint = await subscribe(1, 'en', '2026-09-17T10:00:00Z');
    await createAlert(db(), event, 'reset', NOW, NOW);
    const transport = fakeTransport(() => 503);
    await drainPushJobs(env as unknown as Env, { now: NOW, transport });
    await request('/api/v1/push/subscriptions', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint }) });
    const r = await drainPushJobs(env as unknown as Env, { now: new Date(NOW.getTime() + 120_000), transport });
    expect(r.skipped).toBe(1);

    await clearDb();
    await subscribe(2, 'en', '2026-09-01T10:00:00Z');
    const old = new Date('2026-09-10T00:00:00Z');
    await createAlert(db(), event, 'reset', old, old);
    const r2 = await drainPushJobs(env as unknown as Env, { now: NOW, transport: fakeTransport(() => 201) });
    expect(r2.expired).toBe(1);
    expect(r2.sent).toBe(0);
  });

  it('respects the global pause switch and the disabled state without touching subscriptions', async () => {
    __setContentForTests(snapshotFor([event]));
    await subscribe(1, 'en', '2026-09-17T10:00:00Z');
    await createAlert(db(), event, 'reset', NOW, NOW);
    const transport = fakeTransport(() => 201);
    const paused = await drainPushJobs({ ...(env as unknown as Env), ALERTS_PAUSED: 'true' }, { now: NOW, transport });
    expect(paused.paused).toBe(true);
    expect(paused.leased).toBe(0);
    const disabled = await drainPushJobs({ ...(env as unknown as Env), BROWSER_ALERTS_ENABLED: 'false' }, { now: NOW, transport });
    expect(disabled.leased).toBe(0);
    expect(await countActiveSubscriptions(db())).toBe(1);
    const resumed = await drainPushJobs(env as unknown as Env, { now: NOW, transport });
    expect(resumed.sent).toBe(1);
  });

  it('never double-sends when two drains overlap', async () => {
    __setContentForTests(snapshotFor([event]));
    for (let i = 1; i <= 6; i++) await subscribe(i, 'en', '2026-09-17T10:00:00Z');
    await createAlert(db(), event, 'reset', NOW, NOW);
    const transport = fakeTransport(() => 201);
    const [a, b] = await Promise.all([drainPushJobs(env as unknown as Env, { now: NOW, transport, limit: 4 }), drainPushJobs(env as unknown as Env, { now: NOW, transport, limit: 4 })]);
    expect(a.sent + b.sent).toBe(6);
    expect(transport.sent).toHaveLength(6);
    expect(new Set(transport.sent.map((s) => s.endpoint)).size).toBe(6);
  });

  it('runs from the scheduled handler with the site closed', async () => {
    __setContentForTests(snapshotFor([event]));
    await subscribe(1, 'en', '2026-09-17T10:00:00Z');
    await createAlert(db(), event, 'reset', NOW, NOW);
    const { createScheduledController, createExecutionContext, waitOnExecutionContext } = await import('cloudflare:test');
    const worker = (await import('../src/index')).default;
    const ctx = createExecutionContext();
    // Real transport would call the push service; the endpoint is fake so it fails and gets retried.
    await worker.scheduled(createScheduledController({ cron: '*/2 * * * *' }), env as unknown as Env, ctx);
    await waitOnExecutionContext(ctx);
    const row = await db().prepare('SELECT status, attempts FROM push_jobs').first<{ status: string; attempts: number }>();
    expect(row?.attempts).toBe(1);
    expect(['pending', 'failed']).toContain(row?.status);
  });
});
