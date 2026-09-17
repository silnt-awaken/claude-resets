// Project-wide "beg" reaction: one accepted reaction per anonymous browser identity per cooldown.

import { timingSafeEqual } from './util/http';

export const REACTION_COOKIE = 'cr_id';

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return b64url(new Uint8Array(sig)).slice(0, 32);
}

/** Create a new signed anonymous identifier: `<random>.<signature>`. */
export async function mintIdentity(secret: string): Promise<string> {
  const rand = b64url(crypto.getRandomValues(new Uint8Array(16)));
  return `${rand}.${await hmac(secret, rand)}`;
}

/** Return the identity when the cookie value is well-formed and correctly signed. */
export async function verifyIdentity(secret: string, value: string | undefined): Promise<string | null> {
  if (!value) return null;
  const m = value.match(/^([A-Za-z0-9_-]{16,32})\.([A-Za-z0-9_-]{32})$/);
  if (!m) return null;
  const expected = await hmac(secret, m[1]!);
  return timingSafeEqual(expected, m[2]!) ? value : null;
}

export interface ReactionOutcome {
  accepted: boolean;
  count: number;
  cooldownUntil: string | null;
}

export async function readCount(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT count FROM reactions WHERE key = ?').bind('beg').first<{ count: number }>();
  return row?.count ?? 0;
}

/**
 * Atomically gate on the identity's cooldown, then increment the shared counter.
 * The gate is a single conditional upsert: two concurrent requests from one identity
 * cannot both pass. The counter increment is a single atomic UPDATE.
 */
export async function react(db: D1Database, identity: string, cooldownHours: number, now: Date): Promise<ReactionOutcome> {
  const nowIso = now.toISOString();
  const cutoff = new Date(now.getTime() - cooldownHours * 3_600_000).toISOString();
  const gate = await db
    .prepare(
      `INSERT INTO reaction_cooldowns (identity, last_at) VALUES (?1, ?2)
       ON CONFLICT(identity) DO UPDATE SET last_at = excluded.last_at WHERE reaction_cooldowns.last_at <= ?3`,
    )
    .bind(identity, nowIso, cutoff)
    .run();
  if ((gate.meta.changes ?? 0) === 0) {
    const row = await db.prepare('SELECT last_at FROM reaction_cooldowns WHERE identity = ?').bind(identity).first<{ last_at: string }>();
    const until = row ? new Date(Date.parse(row.last_at) + cooldownHours * 3_600_000).toISOString() : null;
    return { accepted: false, count: await readCount(db), cooldownUntil: until };
  }
  const updated = await db
    .prepare('UPDATE reactions SET count = count + 1, updated_at = ?1 WHERE key = ?2 RETURNING count')
    .bind(nowIso, 'beg')
    .first<{ count: number }>();
  // Opportunistic cleanup of expired cooldown rows (bounded).
  await db.prepare('DELETE FROM reaction_cooldowns WHERE identity IN (SELECT identity FROM reaction_cooldowns WHERE last_at <= ?1 LIMIT 100)').bind(cutoff).run();
  return { accepted: true, count: updated?.count ?? (await readCount(db)), cooldownUntil: new Date(now.getTime() + cooldownHours * 3_600_000).toISOString() };
}
