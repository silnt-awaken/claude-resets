// Goal rounds and contributions (D1). Money never touches this code: contributors send USDC on
// Solana to the operator's wallet, the cron reads those transfers from the chain, and the winner
// is chosen automatically by a finalized Solana block hash. The operator pays the winner by hand.

import { base58Decode, bytesToBigInt } from './base58';
import type { Contribution } from './solana';

export type RoundStatus = 'open' | 'frozen' | 'drawn' | 'paid' | 'cancelled';

export interface GoalRound {
  id: number;
  title: string;
  target_usd: number;
  status: RoundStatus;
  opened_at: string;
  frozen_at: string | null;
  freeze_slot: number | null;
  draw_slot: number | null;
  draw_block: number | null;
  draw_hash: string | null;
  winner_wallet: string | null;
  winner_index: number | null;
  entries: number | null;
  drawn_at: string | null;
  payout_tx: string | null;
  paid_at: string | null;
  note: string | null;
}

export interface GoalEntry {
  wallet: string;
  units: bigint;
  firstSlot: number;
}

export interface GoalSync {
  last_signature: string | null;
  synced_at: string | null;
  last_error: string | null;
}

/** Minimum total that counts as an entry: 1 USDC (6 decimals). Keeps dust out of the draw. */
export const MIN_CONTRIBUTION_UNITS = 1_000_000n;

export const DEFAULT_ROUND_TITLE = 'One month of Claude Max 20x for a contributor';

export async function currentRound(db: D1Database): Promise<GoalRound | null> {
  return db.prepare("SELECT * FROM goal_rounds WHERE status IN ('open','frozen','drawn') ORDER BY id DESC LIMIT 1").first<GoalRound>();
}

export async function latestRound(db: D1Database): Promise<GoalRound | null> {
  return db.prepare('SELECT * FROM goal_rounds ORDER BY id DESC LIMIT 1').first<GoalRound>();
}

export async function pastRounds(db: D1Database, limit = 10): Promise<GoalRound[]> {
  const r = await db.prepare("SELECT * FROM goal_rounds WHERE status IN ('paid','cancelled') ORDER BY id DESC LIMIT ?1").bind(limit).all<GoalRound>();
  return r.results ?? [];
}

/** Open a round and adopt contributions that arrived while no round was open (between draw and payout). */
export async function openRound(db: D1Database, title: string, targetUsd: number, now: Date): Promise<GoalRound> {
  const existing = await currentRound(db);
  if (existing) throw new Error(`round ${existing.id} is still ${existing.status}`);
  const r = await db.prepare("INSERT INTO goal_rounds (title, target_usd, status, opened_at) VALUES (?1, ?2, 'open', ?3) RETURNING *").bind(title, targetUsd, now.toISOString()).first<GoalRound>();
  if (!r) throw new Error('could not open round');
  await db.prepare('UPDATE goal_contributions SET round_id = ?1 WHERE round_id IS NULL').bind(r.id).run();
  return r;
}

/**
 * Store a contribution once (by signature). It joins `roundId` only while that round is open;
 * otherwise it waits (round_id NULL) and the next round adopts it. Returns true when new.
 */
export async function recordContribution(db: D1Database, c: Contribution, roundId: number | null, now: Date): Promise<boolean> {
  const r = await db
    .prepare('INSERT OR IGNORE INTO goal_contributions (signature, round_id, wallet, amount_units, slot, block_time, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
    .bind(c.signature, roundId, c.wallet, Number(c.units), c.slot, c.blockTime, now.toISOString())
    .run();
  return (r.meta.changes ?? 0) > 0;
}

export async function hasContribution(db: D1Database, signature: string): Promise<boolean> {
  return !!(await db.prepare('SELECT 1 AS x FROM goal_contributions WHERE signature = ?1').bind(signature).first());
}

export async function raisedUnits(db: D1Database, roundId: number): Promise<bigint> {
  const r = await db.prepare('SELECT COALESCE(SUM(amount_units), 0) AS units FROM goal_contributions WHERE round_id = ?1').bind(roundId).first<{ units: number }>();
  return BigInt(r?.units ?? 0);
}

export async function contributionCount(db: D1Database, roundId: number): Promise<number> {
  const r = await db.prepare('SELECT COUNT(*) AS n FROM goal_contributions WHERE round_id = ?1').bind(roundId).first<{ n: number }>();
  return r?.n ?? 0;
}

/**
 * The draw list: wallets whose contributions in the round add up to at least the minimum, operator
 * wallets excluded, ordered by first contribution slot then wallet. Deterministic from public data.
 */
export async function qualifyingEntries(db: D1Database, roundId: number, minUnits: bigint = MIN_CONTRIBUTION_UNITS, excluded: readonly string[] = []): Promise<GoalEntry[]> {
  const r = await db
    .prepare('SELECT wallet, SUM(amount_units) AS units, MIN(slot) AS first_slot FROM goal_contributions WHERE round_id = ?1 GROUP BY wallet ORDER BY first_slot ASC, wallet ASC')
    .bind(roundId)
    .all<{ wallet: string; units: number; first_slot: number }>();
  const skip = new Set(excluded);
  return (r.results ?? []).map((e) => ({ wallet: e.wallet, units: BigInt(e.units), firstSlot: e.first_slot })).filter((e) => e.units >= minUnits && !skip.has(e.wallet));
}

export async function freezeRound(db: D1Database, roundId: number, freezeSlot: number, drawSlot: number, now: Date): Promise<void> {
  const r = await db
    .prepare("UPDATE goal_rounds SET status = 'frozen', frozen_at = ?1, freeze_slot = ?2, draw_slot = ?3 WHERE id = ?4 AND status = 'open'")
    .bind(now.toISOString(), freezeSlot, drawSlot, roundId)
    .run();
  if ((r.meta.changes ?? 0) === 0) throw new Error('round is not open');
}

/**
 * Deterministic winner: entries in draw order; index = blockHash (as a 256-bit integer) mod count.
 * Anyone can recompute this from the published block hash and the public contributor list.
 */
export function pickWinnerIndex(drawHash: string, entryCount: number): number {
  if (entryCount <= 0) throw new Error('no entries');
  const bytes = base58Decode(drawHash);
  if (bytes.length !== 32) throw new Error('draw hash must be a 32-byte base58 block hash');
  return Number(bytesToBigInt(bytes) % BigInt(entryCount));
}

export async function recordDraw(db: D1Database, roundId: number, drawBlock: number, drawHash: string, entries: GoalEntry[], now: Date): Promise<{ winner: GoalEntry; index: number }> {
  const index = pickWinnerIndex(drawHash, entries.length);
  const winner = entries[index]!;
  const r = await db
    .prepare("UPDATE goal_rounds SET status = 'drawn', draw_block = ?1, draw_hash = ?2, winner_wallet = ?3, winner_index = ?4, entries = ?5, drawn_at = ?6 WHERE id = ?7 AND status = 'frozen'")
    .bind(drawBlock, drawHash, winner.wallet, index, entries.length, now.toISOString(), roundId)
    .run();
  if ((r.meta.changes ?? 0) === 0) throw new Error('round is not frozen');
  return { winner, index };
}

export async function markPaid(db: D1Database, roundId: number, payoutTx: string, now: Date): Promise<void> {
  const r = await db.prepare("UPDATE goal_rounds SET status = 'paid', payout_tx = ?1, paid_at = ?2 WHERE id = ?3 AND status = 'drawn'").bind(payoutTx, now.toISOString(), roundId).run();
  if ((r.meta.changes ?? 0) === 0) throw new Error('round is not drawn');
}

/** Cancel an open or frozen round; its contributions roll into the next round. */
export async function cancelRound(db: D1Database, roundId: number, note: string): Promise<void> {
  const r = await db.prepare("UPDATE goal_rounds SET status = 'cancelled', note = ?1 WHERE id = ?2 AND status IN ('open','frozen')").bind(note, roundId).run();
  if ((r.meta.changes ?? 0) === 0) throw new Error('round cannot be cancelled in its current state');
  await db.prepare('UPDATE goal_contributions SET round_id = NULL WHERE round_id = ?1').bind(roundId).run();
}

export async function readSync(db: D1Database): Promise<GoalSync | null> {
  return db.prepare('SELECT last_signature, synced_at, last_error FROM goal_sync WHERE id = 1').first<GoalSync>();
}

export async function writeSync(db: D1Database, sync: GoalSync): Promise<void> {
  await db
    .prepare('INSERT INTO goal_sync (id, last_signature, synced_at, last_error) VALUES (1, ?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET last_signature = excluded.last_signature, synced_at = excluded.synced_at, last_error = excluded.last_error')
    .bind(sync.last_signature, sync.synced_at, sync.last_error)
    .run();
}
