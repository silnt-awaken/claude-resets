// Goal rounds and contributor entries (D1). Money never touches this code: contributions go
// straight to the on-chain pool, entries are the unique wallets that contributed during the
// round (read from the chain), and the winner is chosen by a public block hash.

import type { ContributorSummary } from './chain';

export type RoundStatus = 'open' | 'frozen' | 'drawn' | 'paid' | 'cancelled';

export interface GoalRound {
  id: number;
  title: string;
  target_usd: number;
  status: RoundStatus;
  opened_at: string;
  open_block: number | null;
  synced_block: number | null; // last block whose USDG transfers have been ingested
  frozen_at: string | null;
  freeze_block: number | null;
  draw_block: number | null;
  draw_hash: string | null;
  winner_entry_id: number | null;
  payout_tx: string | null;
  paid_at: string | null;
  note: string | null;
}

export interface GoalEntry {
  id: number;
  round_id: number;
  identity: string; // lowercase wallet
  display: string; // 0x1234…abcd
  amount_units: number;
  first_tx: string | null;
  created_at: string;
}

/** Minimum contribution that counts as an entry (USDG base units): 1 USDG. Keeps dust spam out. */
export const MIN_CONTRIBUTION_UNITS = 1_000_000n;

export function shortAddress(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

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

export async function openRound(db: D1Database, title: string, targetUsd: number, openBlock: number, now: Date): Promise<GoalRound> {
  const existing = await currentRound(db);
  if (existing) throw new Error(`round ${existing.id} is still ${existing.status}`);
  const r = await db
    .prepare("INSERT INTO goal_rounds (title, target_usd, status, opened_at, open_block) VALUES (?1, ?2, 'open', ?3, ?4) RETURNING *")
    .bind(title, targetUsd, now.toISOString(), openBlock)
    .first<GoalRound>();
  if (!r) throw new Error('could not open round');
  return r;
}

export async function countEntries(db: D1Database, roundId: number): Promise<number> {
  const r = await db.prepare('SELECT COUNT(*) AS n FROM goal_entries WHERE round_id = ?1').bind(roundId).first<{ n: number }>();
  return r?.n ?? 0;
}

/**
 * Add contributions read from a block range to the round's entries (amounts accumulate per wallet).
 * Called by the cron sync with ranges that never overlap, so a transfer is counted exactly once.
 */
export async function addContributions(db: D1Database, roundId: number, contributors: ContributorSummary[], now: Date): Promise<number> {
  const stmts = contributors.map((c) =>
    db
      .prepare(
        `INSERT INTO goal_entries (round_id, identity, display, amount_units, first_tx, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(round_id, identity) DO UPDATE SET amount_units = goal_entries.amount_units + excluded.amount_units, first_tx = COALESCE(goal_entries.first_tx, excluded.first_tx)`,
      )
      .bind(roundId, c.address, shortAddress(c.address), Number(c.units), c.firstTx, now.toISOString()),
  );
  if (stmts.length) await db.batch(stmts);
  return contributors.length;
}

export async function setSyncedBlock(db: D1Database, roundId: number, block: number): Promise<void> {
  await db.prepare('UPDATE goal_rounds SET synced_block = ?1 WHERE id = ?2').bind(block, roundId).run();
}

/** Entries at or above the minimum, optionally without the operator's wallets (for the draw). */
export async function qualifyingEntries(db: D1Database, roundId: number, minUnits: bigint, excluded: readonly string[] = []): Promise<GoalEntry[]> {
  const all = await listEntries(db, roundId);
  const skip = new Set(excluded.map((a) => a.toLowerCase()));
  return all.filter((e) => BigInt(e.amount_units) >= minUnits && !skip.has(e.identity.toLowerCase()));
}

export async function listEntries(db: D1Database, roundId: number): Promise<GoalEntry[]> {
  const r = await db.prepare('SELECT id, round_id, identity, display, amount_units, first_tx, created_at FROM goal_entries WHERE round_id = ?1 ORDER BY id').bind(roundId).all<GoalEntry>();
  return r.results ?? [];
}

export async function freezeRound(db: D1Database, roundId: number, freezeBlock: number, drawBlock: number, now: Date): Promise<void> {
  const r = await db
    .prepare("UPDATE goal_rounds SET status = 'frozen', frozen_at = ?1, freeze_block = ?2, draw_block = ?3 WHERE id = ?4 AND status = 'open'")
    .bind(now.toISOString(), freezeBlock, drawBlock, roundId)
    .run();
  if ((r.meta.changes ?? 0) === 0) throw new Error('round is not open');
}

/**
 * Deterministic winner: entries ordered by id; index = uint256(blockHash) mod count.
 * Anyone can recompute this from the published draw block hash and the entry list.
 */
export function pickWinnerIndex(drawHash: string, entryCount: number): number {
  if (entryCount <= 0) throw new Error('no entries');
  if (!/^0x[0-9a-fA-F]{64}$/.test(drawHash)) throw new Error('draw hash must be a 32-byte hex string');
  return Number(BigInt(drawHash) % BigInt(entryCount));
}

export async function recordDraw(db: D1Database, roundId: number, drawHash: string, minUnits: bigint = MIN_CONTRIBUTION_UNITS, excluded: readonly string[] = []): Promise<{ winner: GoalEntry; index: number; entries: number }> {
  const round = await db.prepare('SELECT * FROM goal_rounds WHERE id = ?1').bind(roundId).first<GoalRound>();
  if (!round) throw new Error('unknown round');
  if (round.status !== 'frozen') throw new Error('round must be frozen before the draw');
  const entries = await qualifyingEntries(db, roundId, minUnits, excluded);
  const index = pickWinnerIndex(drawHash, entries.length);
  const winner = entries[index]!;
  await db.prepare("UPDATE goal_rounds SET status = 'drawn', draw_hash = ?1, winner_entry_id = ?2 WHERE id = ?3").bind(drawHash, winner.id, roundId).run();
  return { winner, index, entries: entries.length };
}

export async function markPaid(db: D1Database, roundId: number, payoutTx: string, now: Date): Promise<void> {
  const r = await db.prepare("UPDATE goal_rounds SET status = 'paid', payout_tx = ?1, paid_at = ?2 WHERE id = ?3 AND status = 'drawn'").bind(payoutTx, now.toISOString(), roundId).run();
  if ((r.meta.changes ?? 0) === 0) throw new Error('round is not drawn');
}

export async function cancelRound(db: D1Database, roundId: number, note: string): Promise<void> {
  await db.prepare("UPDATE goal_rounds SET status = 'cancelled', note = ?1 WHERE id = ?2 AND status IN ('open','frozen')").bind(note, roundId).run();
}

export async function winnerOf(db: D1Database, round: GoalRound): Promise<GoalEntry | null> {
  if (!round.winner_entry_id) return null;
  return db.prepare('SELECT id, round_id, identity, display, amount_units, first_tx, created_at FROM goal_entries WHERE id = ?1').bind(round.winner_entry_id).first<GoalEntry>();
}
