import { beforeEach, describe, expect, it } from 'vitest';
import { clearDb, json, request } from './helpers';

beforeEach(clearDb);

function cookieFrom(res: Response): string {
  const set = res.headers.get('set-cookie') ?? '';
  return set.split(';')[0] ?? '';
}

describe('beg reaction', () => {
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
