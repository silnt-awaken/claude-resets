import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { app } from '../src/index';
import type { Env } from '../src/env';

export { env };

export const TEST_TOKEN = 'test-publish-token-0123456789';

/** Issue a request against the Worker app with the test bindings. */
export async function request(path: string, init: RequestInit = {}, overrides: Partial<Env> = {}): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await app.request(`http://test.local${path}`, init, { ...(env as unknown as Env), ...overrides } as Env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

export async function json<T = unknown>(path: string, init: RequestInit = {}, overrides: Partial<Env> = {}): Promise<{ status: number; body: T; headers: Headers }> {
  const res = await request(path, init, overrides);
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T, headers: res.headers };
}

export function adminInit(body: unknown): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TEST_TOKEN}` }, body: JSON.stringify(body) };
}

/** A well-formed fake subscription for a supported push service (keys are correct lengths, not real). */
export function fakeSubscription(n: number, host = 'fcm.googleapis.com') {
  const b64 = (len: number, seed: number) => {
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = (seed * 31 + i * 7) % 256;
    if (len === 65) bytes[0] = 4;
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  return { endpoint: `https://${host}/fcm/send/sub-${n}`, keys: { p256dh: b64(65, n), auth: b64(16, n) } };
}

export async function clearDb(): Promise<void> {
  const db = (env as unknown as Env).DB;
  await db.batch([
    db.prepare('DELETE FROM push_jobs'),
    db.prepare('DELETE FROM alerts'),
    db.prepare('DELETE FROM publications'),
    db.prepare('DELETE FROM push_subscriptions'),
    db.prepare('DELETE FROM reaction_cooldowns'),
    db.prepare("UPDATE reactions SET count = 0 WHERE key = 'beg'"),
  ]);
}
