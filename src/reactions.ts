// One durable beg counter per reset, with a separate browser cooldown for each reset.

import { loadContent, resetBoard, type ContentSnapshot } from './domain/content';
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

export function currentReactionEventId(content: ContentSnapshot = loadContent(), now: Date = new Date()): string | null {
  return resetBoard(content.events, now)[0]?.id ?? null;
}

async function ensureRound(db: D1Database, eventId: string): Promise<string> {
  const existing = await db.prepare('SELECT counter_key FROM reaction_rounds WHERE event_id = ?').bind(eventId).first<{ counter_key: string }>();
  if (existing) return existing.counter_key;
  const key = `beg:${eventId}`;
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO reactions (key, count) VALUES (?, 0)').bind(key),
    db.prepare('INSERT OR IGNORE INTO reaction_rounds (event_id, counter_key, started_at) VALUES (?, ?, ?)').bind(eventId, key, new Date().toISOString()),
  ]);
  return key;
}

export async function readCount(db: D1Database, eventId: string): Promise<number> {
  const key = await ensureRound(db, eventId);
  const row = await db.prepare('SELECT count FROM reactions WHERE key = ?').bind(key).first<{ count: number }>();
  return row?.count ?? 0;
}

export async function readReactionState(db: D1Database, eventId: string | null): Promise<{ eventId: string | null; count: number; totals: Record<string, number> }> {
  if (eventId) await ensureRound(db, eventId);
  const rows = await db.prepare('SELECT event_id, count FROM reaction_rounds JOIN reactions ON counter_key = key').all<{ event_id: string; count: number }>();
  const totals = Object.fromEntries(rows.results.map((row) => [row.event_id, row.count]));
  return { eventId, count: eventId ? totals[eventId] ?? 0 : 0, totals };
}

/**
 * Atomically gate on the identity's cooldown, then increment the shared counter.
 * The gate is a single conditional upsert: two concurrent requests from one identity
 * cannot both pass. The counter increment is a single atomic UPDATE.
 */
export async function react(db: D1Database, eventId: string, identity: string, cooldownHours: number, now: Date): Promise<ReactionOutcome> {
  const key = await ensureRound(db, eventId);
  const scopedIdentity = key === 'beg' ? identity : `${key}:${identity}`;
  const nowIso = now.toISOString();
  const cutoff = new Date(now.getTime() - cooldownHours * 3_600_000).toISOString();
  const [gate, increment] = await db.batch<{ count: number }>([
    db.prepare(
      `INSERT INTO reaction_cooldowns (identity, last_at) VALUES (?1, ?2)
       ON CONFLICT(identity) DO UPDATE SET last_at = excluded.last_at WHERE reaction_cooldowns.last_at <= ?3`,
    )
    .bind(scopedIdentity, nowIso, cutoff),
    // changes() refers to the immediately preceding cooldown gate. D1 batch is
    // transactional: the gate and count update either both commit or both roll back.
    db.prepare('UPDATE reactions SET count = count + 1, updated_at = ?1 WHERE key = ?2 AND changes() > 0 RETURNING count').bind(nowIso, key),
  ]);
  if ((gate!.meta.changes ?? 0) === 0) {
    const row = await db.prepare('SELECT last_at FROM reaction_cooldowns WHERE identity = ?').bind(scopedIdentity).first<{ last_at: string }>();
    const until = row ? new Date(Date.parse(row.last_at) + cooldownHours * 3_600_000).toISOString() : null;
    return { accepted: false, count: await readCount(db, eventId), cooldownUntil: until };
  }
  // Opportunistic cleanup of expired cooldown rows (bounded).
  await db.prepare('DELETE FROM reaction_cooldowns WHERE identity IN (SELECT identity FROM reaction_cooldowns WHERE last_at <= ?1 LIMIT 100)').bind(cutoff).run();
  return { accepted: true, count: increment!.results[0]?.count ?? (await readCount(db, eventId)), cooldownUntil: new Date(now.getTime() + cooldownHours * 3_600_000).toISOString() };
}
