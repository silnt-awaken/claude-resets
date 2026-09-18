// Goal rounds and free entries (D1). Money never touches this code: contributions go
// straight to the on-chain pool, and the winner is chosen by a public block hash.

export type RoundStatus = 'open' | 'frozen' | 'drawn' | 'paid' | 'cancelled';

export interface GoalRound {
  id: number;
  title: string;
  target_usd: number;
  status: RoundStatus;
  opened_at: string;
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
  identity_kind: 'wallet' | 'x';
  identity: string;
  display: string;
  created_at: string;
}

export type EntryInput = { ok: true; kind: 'wallet' | 'x'; identity: string; display: string } | { ok: false; error: string };

/** Accept an EVM address or an X handle. One entry per identity per round. */
export function parseEntry(raw: unknown): EntryInput {
  if (typeof raw !== 'string') return { ok: false, error: 'enter a wallet address or an X handle' };
  const value = raw.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(value)) return { ok: true, kind: 'wallet', identity: value.toLowerCase(), display: `${value.slice(0, 6)}…${value.slice(-4)}` };
  if (/^0x/i.test(value)) return { ok: false, error: 'a wallet address must be 0x followed by 40 hex characters' };
  const handle = value.replace(/^@/, '').replace(/^https?:\/\/(x|twitter)\.com\//i, '').split(/[/?#]/)[0] ?? '';
  if (/^[A-Za-z0-9_]{1,15}$/.test(handle)) return { ok: true, kind: 'x', identity: handle.toLowerCase(), display: `@${handle}` };
  return { ok: false, error: 'enter a 0x wallet address (42 characters) or an X handle' };
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

export async function openRound(db: D1Database, title: string, targetUsd: number, now: Date): Promise<GoalRound> {
  const existing = await currentRound(db);
  if (existing) throw new Error(`round ${existing.id} is still ${existing.status}`);
  const r = await db
    .prepare("INSERT INTO goal_rounds (title, target_usd, status, opened_at) VALUES (?1, ?2, 'open', ?3) RETURNING *")
    .bind(title, targetUsd, now.toISOString())
    .first<GoalRound>();
  if (!r) throw new Error('could not open round');
  return r;
}

export async function countEntries(db: D1Database, roundId: number): Promise<number> {
  const r = await db.prepare('SELECT COUNT(*) AS n FROM goal_entries WHERE round_id = ?1').bind(roundId).first<{ n: number }>();
  return r?.n ?? 0;
}

export type AddEntryResult = { ok: true; entry: GoalEntry; created: boolean } | { ok: false; code: 'closed' | 'browser_limit' | 'duplicate'; message: string };

export async function addEntry(db: D1Database, round: GoalRound, input: Extract<EntryInput, { ok: true }>, browserId: string | null, now: Date): Promise<AddEntryResult> {
  if (round.status !== 'open') return { ok: false, code: 'closed', message: 'entries are closed for this round' };
  if (browserId) {
    const prior = await db.prepare('SELECT * FROM goal_entries WHERE round_id = ?1 AND browser_id = ?2').bind(round.id, browserId).first<GoalEntry>();
    if (prior && prior.identity !== input.identity) return { ok: false, code: 'browser_limit', message: 'this browser already entered this round' };
  }
  const inserted = await db
    .prepare('INSERT OR IGNORE INTO goal_entries (round_id, identity_kind, identity, display, browser_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
    .bind(round.id, input.kind, input.identity, input.display, browserId, now.toISOString())
    .run();
  const entry = await db.prepare('SELECT * FROM goal_entries WHERE round_id = ?1 AND identity_kind = ?2 AND identity = ?3').bind(round.id, input.kind, input.identity).first<GoalEntry>();
  if (!entry) throw new Error('entry not stored');
  return { ok: true, entry, created: (inserted.meta.changes ?? 0) > 0 };
}

export async function listEntries(db: D1Database, roundId: number): Promise<GoalEntry[]> {
  const r = await db.prepare('SELECT id, round_id, identity_kind, identity, display, created_at FROM goal_entries WHERE round_id = ?1 ORDER BY id').bind(roundId).all<GoalEntry>();
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

export async function recordDraw(db: D1Database, roundId: number, drawHash: string): Promise<{ winner: GoalEntry; index: number; entries: number }> {
  const round = await db.prepare('SELECT * FROM goal_rounds WHERE id = ?1').bind(roundId).first<GoalRound>();
  if (!round) throw new Error('unknown round');
  if (round.status !== 'frozen') throw new Error('round must be frozen before the draw');
  const entries = await listEntries(db, roundId);
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
  return db.prepare('SELECT id, round_id, identity_kind, identity, display, created_at FROM goal_entries WHERE id = ?1').bind(round.winner_entry_id).first<GoalEntry>();
}
