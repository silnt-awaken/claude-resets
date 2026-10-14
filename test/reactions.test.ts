import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __setContentForTests } from '../src/domain/content';
import type { Env } from '../src/env';
import { __resetRateLimits } from '../src/util/ratelimit';
import { makeEvent, snapshotFor } from './fixtures';
import { clearDb, env, json, request } from './helpers';

beforeEach(async () => { __setContentForTests(null); __resetRateLimits(); await clearDb(); });
afterEach(() => __setContentForTests(null));

function cookieFrom(res: Response): string {
  const set = res.headers.get('set-cookie') ?? '';
  return set.split(';')[0] ?? '';
}

describe('beg reaction', () => {
  it('preserves the legacy live counter on the current banked reset', async () => {
    await (env as unknown as Env).DB.prepare("UPDATE reactions SET count = 18 WHERE key = 'beg'").run();
    const state = await json<{ eventId: string; count: number; totals: Record<string, number> }>('/api/v1/reactions');
    expect(state.body).toMatchObject({ eventId: '2026-09-22-opus-5-5-reset', count: 18, totals: { '2026-09-22-opus-5-5-reset': 18 } });
  });

  it('starts a new reset at zero, preserves 18 on the previous card, resets the cooldown, and refuses stale-page reactions', async () => {
    const before = makeEvent({ id: 'previous-reset', at: '2026-09-01T12:00:00Z' });
    const after = makeEvent({ id: 'new-banked-reset', kind: 'credit', on: '2026-09-22', resetOffer: { expiresOn: '2099-10-22' }, windows: ['unspecified'] });
    __setContentForTests(snapshotFor([before]));
    const first = await request('/api/v1/reactions/beg', { method: 'POST' });
    const cookie = cookieFrom(first);
    await (env as unknown as Env).DB.prepare("UPDATE reactions SET count = 18 WHERE key = 'beg:previous-reset'").run();
    __setContentForTests(snapshotFor([before, after]));
    const state = await json<{ eventId: string; count: number; totals: Record<string, number> }>('/api/v1/reactions');
    expect(state.body).toMatchObject({ eventId: after.id, count: 0, totals: { [before.id]: 18, [after.id]: 0 } });
    const stale = await request('/api/v1/reactions/beg', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ eventId: before.id }) });
    expect(stale.status).toBe(409);
    const next = await request('/api/v1/reactions/beg', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ eventId: after.id }) });
    expect(next.status).toBe(200);
    expect(await next.json()).toMatchObject({ eventId: after.id, count: 1 });
    const history = (await json<{ totals: Record<string, number> }>('/api/v1/reactions')).body.totals;
    expect(history[before.id]).toBe(18);
    const page = await (await request('/')).text();
    const previousCard = page.split(`id="event-${before.id}"`)[1]!.split('</li>')[0]!;
    expect(previousCard).toContain('18 begs');
    expect(await (await request(`/resets/${before.id}`)).text()).toContain('18 begs');
    const filtered = await (await request('/?window=weekly')).text();
    expect(filtered).not.toContain('data-role="beg"');
    expect(filtered).toContain('18 begs');
    __setContentForTests(snapshotFor([before, { ...after, revision: 2 }]));
    expect((await json<{ count: number }>('/api/v1/reactions')).body.count).toBe(1);
    __setContentForTests(snapshotFor([makeEvent({ id: 'older-history', at: '2026-08-01T12:00:00Z' }), before, after]));
    expect((await json<{ count: number }>('/api/v1/reactions')).body.count).toBe(1);
  });

  it('starts at zero, accepts one reaction per identity, and persists across refresh', async () => {
    expect((await json<{ count: number }>('/api/v1/reactions')).body.count).toBe(0);
    const first = await request('/api/v1/reactions/beg', { method: 'POST' });
    expect(first.status).toBe(200);
    const body = (await first.json()) as { accepted: boolean; count: number; cooldownUntil: string };
    expect(body.accepted).toBe(true);
    expect(body.count).toBe(1);
    expect(body.cooldownUntil).toBeTruthy();
    const cookie = cookieFrom(first);
    expect(cookie.startsWith('cr_id=')).toBe(true);
    expect(first.headers.get('set-cookie')).toContain('HttpOnly');

    const second = await request('/api/v1/reactions/beg', { method: 'POST', headers: { cookie } });
    expect(second.status).toBe(429);
    const denied = (await second.json()) as { accepted: boolean; count: number };
    expect(denied.accepted).toBe(false);
    expect(denied.count).toBe(1);
    expect(second.headers.get('retry-after')).toBeTruthy();

    expect((await json<{ count: number }>('/api/v1/reactions')).body.count).toBe(1);
  });

  it('rejects a forged or tampered identity cookie and mints a fresh one', async () => {
    const res = await request('/api/v1/reactions/beg', { method: 'POST', headers: { cookie: 'cr_id=AAAAAAAAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('cr_id=');
  });

  it('counts exactly once under concurrent duplicate requests from one identity', async () => {
    const first = await request('/api/v1/reactions/beg', { method: 'POST' });
    const cookie = cookieFrom(first);
    await clearDb();
    const results = await Promise.all(Array.from({ length: 6 }, () => request('/api/v1/reactions/beg', { method: 'POST', headers: { cookie } })));
    const accepted = results.filter((r) => r.status === 200).length;
    expect(accepted).toBe(1);
    expect((await json<{ count: number }>('/api/v1/reactions')).body.count).toBe(1);
  });

  it('increments atomically across many distinct identities', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => request('/api/v1/reactions/beg', { method: 'POST' })));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect((await json<{ count: number }>('/api/v1/reactions')).body.count).toBe(10);
  });

  it('reports unavailable without a signing secret', async () => {
    const { status, body } = await json<{ code: string }>('/api/v1/reactions/beg', { method: 'POST' }, { REACTION_SECRET: '' });
    expect(status).toBe(503);
    expect(body.code).toBe('reactions_unavailable');
  });
});
