import { beforeEach, describe, expect, it } from 'vitest';
import { __setContentForTests, loadContent } from '../src/domain/content';
import type { ResetEvent } from '../src/domain/types';
import type { Env } from '../src/env';
import { makeEvent, snapshotFor } from './fixtures';
import { adminInit, clearDb, env, fakeSubscription, json, request } from './helpers';

const db = () => (env as unknown as Env).DB;

beforeEach(async () => {
  await clearDb();
  __setContentForTests(null);
});

async function subscribe(n: number, createdAt: string) {
  const res = await request('/api/v1/push/subscriptions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subscription: fakeSubscription(n) }) });
  expect(res.status).toBe(201);
  await db().prepare('UPDATE push_subscriptions SET created_at = ?1 WHERE endpoint = ?2').bind(createdAt, fakeSubscription(n).endpoint).run();
}

const jobCount = async () => (await db().prepare('SELECT COUNT(*) AS n FROM push_jobs').first<{ n: number }>())?.n ?? 0;

describe('private publication endpoint', () => {
  it('requires the token and reports disabled when unconfigured', async () => {
    expect((await request('/admin/publish', { method: 'POST' })).status).toBe(401);
    expect((await request('/admin/publish', { method: 'POST', headers: { authorization: 'Bearer wrong-token-000000000' } })).status).toBe(401);
    expect((await request('/admin/publish', { method: 'POST' }, { CONTENT_PUBLISH_TOKEN: '' })).status).toBe(503);
    expect((await request('/admin/ledger')).status).toBe(401);
  });

  it('refuses events that are not deployed or differ from the deployed content', async () => {
    const deployed = loadContent().events.find((e) => e.id === '2026-09-04-max-weekly')!;
    const unknown = await json<{ code: string }>('/admin/publish', adminInit({ eventId: 'nope', mode: 'publish', event: makeEvent({ id: 'nope' }) }));
    expect(unknown.status).toBe(409);
    expect(unknown.body.code).toBe('not_deployed');
    const edited = { ...deployed, summary: 'locally edited', revision: 2, alertRevision: 1 };
    const mismatch = await json<{ code: string }>('/admin/publish', adminInit({ eventId: deployed.id, mode: 'publish', event: edited }));
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.code).toBe('content_mismatch');
    const invalid = await json<{ code: string }>('/admin/publish', adminInit({ eventId: deployed.id, mode: 'publish', event: { ...deployed, windows: [] } }));
    expect(invalid.status).toBe(400);
  });

  it('records a publication once, alerts existing subscribers only, and stays idempotent on retry', async () => {
    const fresh = makeEvent({ id: 'fresh', at: new Date(Date.now() - 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z') });
    __setContentForTests(snapshotFor([fresh]));
    await subscribe(1, '2020-01-01T00:00:00Z');
    const first = await json<{ recorded: boolean; alert: { created: boolean; jobs: number } }>('/admin/publish', adminInit({ eventId: 'fresh', mode: 'publish', event: fresh }));
    expect(first.status).toBe(200);
    expect(first.body.recorded).toBe(true);
    expect(first.body.alert.created).toBe(true);
    expect(first.body.alert.jobs).toBe(1);
    await subscribe(2, new Date().toISOString());
    const retry = await json<{ alreadyRecorded: boolean; alert: { created: boolean; jobs: number } }>('/admin/publish', adminInit({ eventId: 'fresh', mode: 'publish', event: fresh }));
    expect(retry.body.alreadyRecorded).toBe(true);
    expect(retry.body.alert.created).toBe(false);
    expect(await jobCount()).toBe(1);
    const ledger = await json<{ publications: unknown[]; alerts: unknown[] }>('/admin/ledger', { headers: adminInit({}).headers });
    expect(ledger.body.publications).toHaveLength(1);
    expect(ledger.body.alerts).toHaveLength(1);
  });

  it('historical import never enqueues alerts, even with subscribers, and blocks later default alerts', async () => {
    const old = loadContent().events.find((e) => e.id === '2026-05-15-everyone')!;
    await subscribe(1, '2020-01-01T00:00:00Z');
    const back = await json<{ alert: { created: boolean; reason: string } }>('/admin/publish', adminInit({ eventId: old.id, mode: 'backfill', alertPolicy: 'none', event: old }));
    expect(back.status).toBe(200);
    expect(back.body.alert.created).toBe(false);
    expect(await jobCount()).toBe(0);
    const later = await json<{ alert: { created: boolean; reason: string } }>('/admin/publish', adminInit({ eventId: old.id, mode: 'publish', late: true, event: old }));
    expect(later.body.alert.created).toBe(false);
    expect(later.body.alert.reason).toMatch(/history/);
    expect(await jobCount()).toBe(0);
    const bad = await json<{ code: string }>('/admin/publish', adminInit({ eventId: old.id, mode: 'backfill', alertPolicy: 'default', event: old }));
    expect(bad.status).toBe(400);
  });

  it('suppresses alerts for announcements older than the freshness limit unless explicitly marked late', async () => {
    const old = loadContent().events.find((e) => e.id === '2026-09-04-max-weekly')!;
    await subscribe(1, '2020-01-01T00:00:00Z');
    const stale = await json<{ alert: { created: boolean; reason: string } }>('/admin/publish', adminInit({ eventId: old.id, mode: 'publish', event: old }));
    expect(stale.body.alert.created).toBe(false);
    expect(stale.body.alert.reason).toMatch(/old/);
    expect(await jobCount()).toBe(0);
    await clearDb();
    await subscribe(1, '2020-01-01T00:00:00Z');
    const late = await json<{ alert: { created: boolean; jobs: number } }>('/admin/publish', adminInit({ eventId: old.id, mode: 'publish', late: true, event: old }));
    expect(late.body.alert.created).toBe(true);
    expect(late.body.alert.jobs).toBe(1);
  });

  it('does not alert for non-reset publications or announced (unconfirmed) resets, then alerts once on confirmation', async () => {
    const recent = new Date(Date.now() - 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const policy = makeEvent({ id: 'policy', kind: 'policy_change', at: recent });
    const announced = makeEvent({ id: 'soon', eventStatus: 'announced', at: recent, schedule: { statedAt: null, statedWindow: 'later today' } });
    __setContentForTests(snapshotFor([policy, announced]));
    await subscribe(1, '2020-01-01T00:00:00Z');
    expect((await json<{ alert: { created: boolean } }>('/admin/publish', adminInit({ eventId: 'policy', mode: 'publish', event: policy }))).body.alert.created).toBe(false);
    expect((await json<{ alert: { created: boolean } }>('/admin/publish', adminInit({ eventId: 'soon', mode: 'publish', event: announced }))).body.alert.created).toBe(false);
    expect(await jobCount()).toBe(0);
    // A subscriber joins between announcement and confirmation.
    await subscribe(2, new Date(Date.now() - 60_000).toISOString());
    const confirmed = { ...announced, eventStatus: 'confirmed' as const, revision: 2, alertRevision: 2, schedule: undefined, revisedAt: recent };
    delete (confirmed as { schedule?: unknown }).schedule;
    __setContentForTests(snapshotFor([policy, confirmed]));
    const res = await json<{ alert: { created: boolean; jobs: number } }>('/admin/publish', adminInit({ eventId: 'soon', mode: 'publish', event: confirmed }));
    expect(res.status).toBe(200);
    expect(res.body.alert.created).toBe(true);
    expect(res.body.alert.jobs).toBe(2);
  });

  it('keeps silent edits silent and sends explicit corrections only to the original recipients', async () => {
    const recent = new Date(Date.now() - 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const v1 = makeEvent({ id: 'evt', at: recent });
    __setContentForTests(snapshotFor([v1]));
    await subscribe(1, '2020-01-01T00:00:00Z');
    await json('/admin/publish', adminInit({ eventId: 'evt', mode: 'publish', event: v1 }));
    // Mark the job as delivered so the recipient set is known.
    await db().prepare("UPDATE push_jobs SET status = 'sent'").run();
    await subscribe(2, '2020-01-01T00:00:00Z'); // never received the original alert
    const v2 = { ...v1, summary: 'Typo fixed.', revision: 2, revisedAt: recent };
    __setContentForTests(snapshotFor([v2]));
    const silent = await json<{ alert: { created: boolean } }>('/admin/publish', adminInit({ eventId: 'evt', mode: 'correct', alertPolicy: 'none', event: v2 }));
    expect(silent.body.alert.created).toBe(false);
    expect(await jobCount()).toBe(1);
    const v3: ResetEvent = { ...v2, audience: { ...v2.audience, statement: 'Max only', plans: ['max'], scope: 'limited' }, revision: 3, alertRevision: 3, correction: { kind: 'correction', reason: 'Scope was narrower than first summarized.', at: recent } };
    __setContentForTests(snapshotFor([v3]));
    const loud = await json<{ alert: { created: boolean; jobs: number } }>('/admin/publish', adminInit({ eventId: 'evt', mode: 'correct', alertPolicy: 'correction', event: v3 }));
    expect(loud.body.alert.created).toBe(true);
    expect(loud.body.alert.jobs).toBe(1);
    const alerts = await db().prepare('SELECT kind FROM alerts ORDER BY id').all<{ kind: string }>();
    expect(alerts.results.map((a) => a.kind)).toEqual(['reset', 'correction']);
    const conflict = await json<{ code: string }>('/admin/publish', adminInit({ eventId: 'evt', mode: 'correct', alertPolicy: 'none', event: { ...v3, summary: 'changed again without a revision bump' } }));
    expect(conflict.status).toBe(409);
  });
});
