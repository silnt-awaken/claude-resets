// Community goal: USDC on Solana to the operator's wallet, automatic draw by a finalized block hash.
// Public: status, the draw list, a transaction message for Phantom to sign, and contribution
// verification. Cron: `tickGoal` syncs transfers from the chain and moves the round along.
// Maintainer (Bearer CONTENT_PUBLISH_TOKEN): record the payout, cancel, or run a tick now.

import { Hono } from 'hono';
import type { GoalConfig } from '../config';
import { siteConfig, type Env } from '../env';
import { isSolanaAddress, isSolanaSignature } from '../goal/base58';
import {
  DEFAULT_ROUND_TITLE,
  MIN_CONTRIBUTION_UNITS,
  cancelRound,
  contributionCount,
  currentRound,
  freezeRound,
  hasContribution,
  latestRound,
  markPaid,
  openRound,
  pastRounds,
  qualifyingEntries,
  raisedUnits,
  readSync,
  recordContribution,
  recordDraw,
  writeSync,
  type GoalRound,
} from '../goal/rounds';
import {
  PRIORITY_FEE_LAMPORTS,
  SOLANA,
  base58Encode,
  blockHashAtOrAfter,
  buildTransferMessage,
  feeForMessage,
  getLatestBlockhash,
  getSlot,
  getTransaction,
  lamports,
  parseContribution,
  shortAddress,
  signaturesSince,
  associatedTokenAccount,
  type FetchLike,
} from '../goal/solana';
import { clientIp, problem, readJson, timingSafeEqual } from '../util/http';
import { rateLimit } from '../util/ratelimit';

export const goal = new Hono<{ Bindings: Env }>();

const USDC_UNITS = 1_000_000n;
/** Sanity cap for the contribution sheet; nothing stops a larger manual transfer. */
const MAX_SHEET_USD = 10_000;
/** A wallet needs this much SOL (lamports) to pay the network fee of a transfer. */
const MIN_LAMPORTS_FOR_FEE = 50_000n;
/** The chain scan is considered stale when it has not succeeded for this long. */
const STALE_AFTER_MS = 5 * 60_000;

export interface GoalStatus {
  enabled: boolean;
  network: { name: string; explorer: string };
  target_usd: number;
  min_contribution_usd: number;
  pool: { wallet: string | null; usdc_account: string | null };
  round: null | {
    id: number;
    title: string;
    status: GoalRound['status'];
    opened_at: string;
    target_usd: number;
    raised_usd: number;
    contributions: number;
    contributors: number;
    frozen_at: string | null;
    draw_slot: number | null;
    draw_block: number | null;
    draw_hash: string | null;
    winner: string | null;
    winner_wallet: string | null;
    winner_index: number | null;
    entries: number | null;
    payout_tx: string | null;
    paid_at: string | null;
  };
  past_rounds: Array<{ id: number; title: string; status: string; raised_usd: number; winner: string | null; winner_wallet: string | null; draw_block: number | null; draw_hash: string | null; payout_tx: string | null; paid_at: string | null }>;
  sync: { synced_at: string | null; stale: boolean; error: string | null };
  progress: number; // 0..1
}

function usd(units: bigint): number {
  return Number(units) / 1e6;
}

/** Shared by the API and the page renderer. D1 only; the chain is read by the cron, never per request. */
export async function goalStatus(env: Env, now: Date = new Date()): Promise<GoalStatus> {
  const cfg = siteConfig(env).goal;
  const status: GoalStatus = {
    enabled: cfg.live,
    network: { name: SOLANA.name, explorer: cfg.explorerUrl },
    target_usd: cfg.targetUsd,
    min_contribution_usd: Number(MIN_CONTRIBUTION_UNITS) / 1e6,
    pool: { wallet: cfg.live ? cfg.wallet : null, usdc_account: cfg.live ? cfg.usdcAccount : null },
    round: null,
    past_rounds: [],
    sync: { synced_at: null, stale: false, error: null },
    progress: 0,
  };
  if (!env.DB) return status;
  try {
    const round = (await currentRound(env.DB)) ?? (await latestRound(env.DB));
    if (round) {
      const raised = await raisedUnits(env.DB, round.id);
      status.round = {
        id: round.id,
        title: round.title,
        status: round.status,
        opened_at: round.opened_at,
        target_usd: round.target_usd,
        raised_usd: usd(raised),
        contributions: await contributionCount(env.DB, round.id),
        contributors: (await qualifyingEntries(env.DB, round.id, MIN_CONTRIBUTION_UNITS, cfg.excludedWallets)).length,
        frozen_at: round.frozen_at,
        draw_slot: round.draw_slot,
        draw_block: round.draw_block,
        draw_hash: round.draw_hash,
        winner: round.winner_wallet ? shortAddress(round.winner_wallet) : null,
        winner_wallet: round.winner_wallet,
        winner_index: round.winner_index,
        entries: round.entries,
        payout_tx: round.payout_tx,
        paid_at: round.paid_at,
      };
      status.progress = Math.min(1, usd(raised) / round.target_usd);
    }
    for (const r of await pastRounds(env.DB, 10)) {
      status.past_rounds.push({ id: r.id, title: r.title, status: r.status, raised_usd: usd(await raisedUnits(env.DB, r.id)), winner: r.winner_wallet ? shortAddress(r.winner_wallet) : null, winner_wallet: r.winner_wallet, draw_block: r.draw_block, draw_hash: r.draw_hash, payout_tx: r.payout_tx, paid_at: r.paid_at });
    }
    if (cfg.live) {
      const sync = await readSync(env.DB);
      const age = sync?.synced_at ? now.getTime() - Date.parse(sync.synced_at) : Number.POSITIVE_INFINITY;
      status.sync = { synced_at: sync?.synced_at ?? null, stale: !!sync?.last_error || age > STALE_AFTER_MS, error: sync?.last_error ?? null };
    }
  } catch (err) {
    console.error('goal status unavailable', err instanceof Error ? err.message : err);
  }
  return status;
}

// ---------- chain sync (cron) ----------

export interface SyncResult {
  started: boolean;
  scanned: number;
  recorded: number;
  error: string | null;
}

/**
 * Read USDC transfers into the pool's token account that are newer than the cursor and store them as
 * contributions. The first run only sets the cursor: transfers from before the goal existed never count.
 * Never throws; an RPC problem leaves the cursor on the last processed signature and is retried next minute.
 */
export async function syncContributions(env: Env, fetchFn: FetchLike = fetch, now: Date = new Date()): Promise<SyncResult> {
  const cfg = siteConfig(env).goal;
  const db = env.DB;
  if (!cfg.live) return { started: false, scanned: 0, recorded: 0, error: 'goal not live' };
  const cursor = await readSync(db);
  let last = cursor?.last_signature ?? null;
  let recorded = 0;
  let scanned = 0;
  try {
    if (!cursor) {
      // First run: remember the newest existing signature and count nothing before it. Written only on
      // success, so a failed first run is simply retried as a first run and history is never ingested.
      const head = await signaturesSince(fetchFn, cfg.rpcUrl, cfg.usdcAccount!, null, 1, 1);
      await writeSync(db, { last_signature: head[0]?.signature ?? null, synced_at: now.toISOString(), last_error: null });
      console.log('goal sync started', JSON.stringify({ from: head[0]?.signature ?? null }));
      return { started: true, scanned: head.length, recorded: 0, error: null };
    }
    const sigs = await signaturesSince(fetchFn, cfg.rpcUrl, cfg.usdcAccount!, last);
    scanned = sigs.length;
    for (const s of [...sigs].reverse()) {
      if (!s.err) {
        const tx = await getTransaction(fetchFn, cfg.rpcUrl, s.signature);
        if (!tx) throw new Error(`transaction ${s.signature} not available yet`);
        const c = parseContribution(tx, cfg.usdcAccount!);
        if (c) {
          const round = await currentRound(db);
          if (await recordContribution(db, c, round?.status === 'open' ? round.id : null, now)) {
            recorded++;
            console.log('goal contribution', JSON.stringify({ signature: c.signature, wallet: c.wallet, units: c.units.toString(), round: round?.status === 'open' ? round.id : null }));
          }
        }
      }
      last = s.signature;
    }
    await writeSync(db, { last_signature: last, synced_at: now.toISOString(), last_error: null });
    return { started: false, scanned, recorded, error: null };
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    console.error('goal sync failed', message);
    if (cursor) await writeSync(db, { last_signature: last, synced_at: cursor.synced_at, last_error: message }).catch(() => {});
    return { started: false, scanned, recorded, error: message };
  }
}

export interface TickResult {
  sync: SyncResult;
  round: number | null;
  action: 'skipped' | 'none' | 'opened' | 'frozen' | 'waiting' | 'drawn' | 'awaiting_payout';
  detail: string | null;
}

/**
 * One cron step: sync, then move the round along. open → (target reached) frozen → (draw slot
 * finalized) drawn → (operator records the payout) paid → a new round opens on the next tick.
 * Never throws; every step is idempotent and logged.
 */
export async function tickGoal(env: Env, fetchFn: FetchLike = fetch, now: Date = new Date()): Promise<TickResult> {
  const cfg = siteConfig(env).goal;
  const sync = await syncContributions(env, fetchFn, now);
  if (!cfg.live) return { sync, round: null, action: 'skipped', detail: cfg.reason };
  const db = env.DB;
  try {
    let round = await currentRound(db);
    if (!round) {
      round = await openRound(db, DEFAULT_ROUND_TITLE, cfg.targetUsd, now);
      console.log('goal round opened', JSON.stringify({ round: round.id, target: round.target_usd }));
      return { sync, round: round.id, action: 'opened', detail: null };
    }
    if (round.status === 'open') {
      const raised = await raisedUnits(db, round.id);
      const entries = await qualifyingEntries(db, round.id, MIN_CONTRIBUTION_UNITS, cfg.excludedWallets);
      if (raised < BigInt(round.target_usd) * USDC_UNITS) return { sync, round: round.id, action: 'none', detail: `${usd(raised)} of ${round.target_usd} USDC` };
      if (entries.length === 0) return { sync, round: round.id, action: 'none', detail: 'target reached but no eligible contributor yet' };
      const slot = await getSlot(fetchFn, cfg.rpcUrl, 'confirmed');
      await freezeRound(db, round.id, slot, slot + SOLANA.drawLeadSlots, now);
      console.log('goal round frozen', JSON.stringify({ round: round.id, freezeSlot: slot, drawSlot: slot + SOLANA.drawLeadSlots, entries: entries.length }));
      return { sync, round: round.id, action: 'frozen', detail: `draw at slot ${slot + SOLANA.drawLeadSlots}` };
    }
    if (round.status === 'frozen') {
      const finalized = await getSlot(fetchFn, cfg.rpcUrl, 'finalized');
      if (finalized < round.draw_slot!) return { sync, round: round.id, action: 'waiting', detail: `finalized slot ${finalized}, draw slot ${round.draw_slot}` };
      const block = await blockHashAtOrAfter(fetchFn, cfg.rpcUrl, round.draw_slot!);
      if (!block) return { sync, round: round.id, action: 'waiting', detail: 'draw block not finalized yet' };
      const entries = await qualifyingEntries(db, round.id, MIN_CONTRIBUTION_UNITS, cfg.excludedWallets);
      const result = await recordDraw(db, round.id, block.slot, block.hash, entries, now);
      console.log('goal round drawn', JSON.stringify({ round: round.id, block: block.slot, hash: block.hash, index: result.index, entries: entries.length, winner: result.winner.wallet }));
      return { sync, round: round.id, action: 'drawn', detail: `winner ${result.winner.wallet} (index ${result.index} of ${entries.length})` };
    }
    return { sync, round: round.id, action: 'awaiting_payout', detail: `pay ${round.winner_wallet} and run goal:round paid --tx <signature>` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('goal tick failed', message);
    return { sync, round: null, action: 'none', detail: message };
  }
}

// ---------- public ----------

goal.use('*', async (c, next) => {
  if (c.req.method === 'POST') {
    const rl = rateLimit(`goal:${clientIp(c)}`, 30, 60_000);
    if (!rl.allowed) return problem(c, 429, 'rate_limited', 'Too many requests. Please slow down.', { retryAfter: rl.retryAfterSeconds });
    c.header('cache-control', 'no-store');
  }
  await next();
});

goal.get('/', async (c) => {
  return c.json(await goalStatus(c.env), 200, { 'cache-control': 'public, max-age=30', 'access-control-allow-origin': '*' });
});

/** The draw list for the current (or latest) round, in draw order, so anyone can recompute `hash mod entries`. */
goal.get('/contributors', async (c) => {
  const cfg = siteConfig(c.env).goal;
  const round = (await currentRound(c.env.DB)) ?? (await latestRound(c.env.DB));
  if (!round) return c.json({ round: null, contributors: [] }, 200, { 'cache-control': 'public, max-age=30', 'access-control-allow-origin': '*' });
  const list = (await qualifyingEntries(c.env.DB, round.id, MIN_CONTRIBUTION_UNITS, cfg.excludedWallets)).map((e, i) => ({ index: i, wallet: e.wallet, usdc: usd(e.units), first_slot: e.firstSlot }));
  return c.json(
    { round: round.id, status: round.status, min_contribution_usd: Number(MIN_CONTRIBUTION_UNITS) / 1e6, excluded: cfg.excludedWallets, draw_block: round.draw_block, draw_hash: round.draw_hash, winner_index: round.winner_index, explorer: cfg.explorerUrl, contributors: list },
    200,
    { 'cache-control': 'public, max-age=30', 'access-control-allow-origin': '*' },
  );
});

function openOr409(c: Parameters<typeof problem>[0], cfg: GoalConfig, round: GoalRound | null): Response | null {
  if (!cfg.live) return problem(c, 409, 'goal_not_open', 'The community goal is not open.');
  if (!round || round.status !== 'open') return problem(c, 409, 'round_closed', 'Entries are closed while the current round is drawn and paid; the next round opens right after.');
  return null;
}

/**
 * Build the USDC transfer for a contributor: their wallet pays the fee and signs, the pool's token
 * account receives. Returns the serialized legacy message (base58) for Phantom's signAndSendTransaction.
 */
goal.post('/tx', async (c) => {
  const cfg = siteConfig(c.env).goal;
  const closed = openOr409(c, cfg, await currentRound(c.env.DB));
  if (closed) return closed;
  const body = await readJson(c, 2048);
  if (!body.ok) return problem(c, 400, 'invalid_body', body.error);
  const v = body.value as Record<string, unknown>;
  const from = typeof v.from === 'string' ? v.from.trim() : '';
  if (!isSolanaAddress(from)) return problem(c, 400, 'invalid_wallet', 'from must be a Solana wallet address', { parameter: 'from' });
  if (from === cfg.wallet) return problem(c, 409, 'operator_wallet', 'The goal wallet cannot contribute to itself.');
  const amount = typeof v.amount === 'number' ? v.amount : Number(v.amount);
  const cents = Math.round(amount * 100);
  if (!Number.isFinite(amount) || cents < 100 || cents > MAX_SHEET_USD * 100) return problem(c, 400, 'invalid_amount', `amount must be between 1 and ${MAX_SHEET_USD} USDC`, { parameter: 'amount' });
  const units = BigInt(cents) * 10_000n;
  try {
    const source = await associatedTokenAccount(fetch, cfg.rpcUrl, from, cfg.usdcMint);
    if (!source) return problem(c, 409, 'no_usdc', 'This wallet holds no USDC on Solana.');
    if (source.amount < units) return problem(c, 409, 'insufficient', `This wallet holds ${usd(source.amount)} USDC.`);
    if ((await lamports(fetch, cfg.rpcUrl, from)) < MIN_LAMPORTS_FOR_FEE) return problem(c, 409, 'no_sol', 'This wallet needs a little SOL to pay the network fee.');
    const { blockhash, lastValidBlockHeight } = await getLatestBlockhash(fetch, cfg.rpcUrl);
    const message = buildTransferMessage({ payer: from, source: source.address, destination: cfg.usdcAccount!, mint: cfg.usdcMint, units, decimals: SOLANA.usdcDecimals, blockhash });
    const baseFee = (await feeForMessage(fetch, cfg.rpcUrl, message).catch(() => null)) ?? 5000;
    console.log('goal tx built', JSON.stringify({ from, units: units.toString(), source: source.address }));
    return c.json({ message: base58Encode(message), from, source: source.address, destination: cfg.usdcAccount, units: units.toString(), usdc: cents / 100, fee_lamports: baseFee + PRIORITY_FEE_LAMPORTS, blockhash, last_valid_block_height: lastValidBlockHeight });
  } catch (err) {
    console.error('goal tx failed', err instanceof Error ? err.message : err);
    return problem(c, 503, 'rpc_unavailable', 'Could not reach Solana right now. Try again in a moment.');
  }
});

/** Verify a submitted transaction on chain and record it right away (the cron would find it within a minute anyway). */
goal.post('/contributions', async (c) => {
  const cfg = siteConfig(c.env).goal;
  if (!cfg.live) return problem(c, 409, 'goal_not_open', 'The community goal is not open.');
  const body = await readJson(c, 2048);
  if (!body.ok) return problem(c, 400, 'invalid_body', body.error);
  const signature = typeof (body.value as Record<string, unknown>).signature === 'string' ? ((body.value as Record<string, unknown>).signature as string).trim() : '';
  if (!isSolanaSignature(signature)) return problem(c, 400, 'invalid_signature', 'signature must be a Solana transaction signature', { parameter: 'signature' });
  const now = new Date();
  try {
    const round = await currentRound(c.env.DB);
    if (await hasContribution(c.env.DB, signature)) return c.json({ status: 'confirmed', signature, counted: round?.status === 'open', round: round?.id ?? null, contributors: round ? (await qualifyingEntries(c.env.DB, round.id, MIN_CONTRIBUTION_UNITS, cfg.excludedWallets)).length : 0 });
    const tx = await getTransaction(fetch, cfg.rpcUrl, signature);
    if (!tx) return c.json({ status: 'pending', signature }, 202);
    if (tx.meta?.err) return problem(c, 409, 'failed', 'The transaction failed on chain.');
    const contribution = parseContribution(tx, cfg.usdcAccount!);
    if (!contribution) return problem(c, 409, 'not_a_contribution', 'This transaction did not send USDC to the pool.');
    const counted = round?.status === 'open';
    await recordContribution(c.env.DB, contribution, counted ? round!.id : null, now);
    console.log('goal contribution (submitted)', JSON.stringify({ signature, wallet: contribution.wallet, units: contribution.units.toString(), round: counted ? round!.id : null }));
    return c.json({ status: 'confirmed', signature, wallet: contribution.wallet, usdc: usd(contribution.units), counted, round: round?.id ?? null, contributors: round ? (await qualifyingEntries(c.env.DB, round.id, MIN_CONTRIBUTION_UNITS, cfg.excludedWallets)).length : 0 });
  } catch (err) {
    console.error('goal contribution check failed', err instanceof Error ? err.message : err);
    return problem(c, 503, 'rpc_unavailable', 'Could not reach Solana right now. Try again in a moment.');
  }
});

// ---------- maintainer actions (Bearer CONTENT_PUBLISH_TOKEN) ----------

export const goalAdmin = new Hono<{ Bindings: Env }>();

goalAdmin.use('*', async (c, next) => {
  c.header('cache-control', 'no-store');
  const token = c.env.CONTENT_PUBLISH_TOKEN;
  if (!token || token.length < 16) return problem(c, 503, 'publish_disabled', 'Publication endpoint is not configured.');
  const header = c.req.header('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!presented || !timingSafeEqual(presented, token)) return problem(c, 401, 'unauthorized', 'Missing or invalid token.');
  await next();
});

/** actions: paid { tx } (record the operator's USDC payout), cancel { note }, tick (run the cron step now), open { title?, targetUsd? } */
goalAdmin.post('/rounds', async (c) => {
  const body = await readJson(c, 8192);
  if (!body.ok) return problem(c, 400, 'invalid_body', body.error);
  const v = body.value as Record<string, unknown>;
  const cfg = siteConfig(c.env).goal;
  const now = new Date();
  try {
    switch (v.action) {
      case 'paid': {
        const round = await currentRound(c.env.DB);
        if (!round) return problem(c, 409, 'no_round', 'No round to mark paid.');
        if (round.status !== 'drawn') return problem(c, 409, 'not_drawn', `Round ${round.id} is ${round.status}; only a drawn round can be paid.`);
        if (typeof v.tx !== 'string' || !isSolanaSignature(v.tx.trim())) return problem(c, 400, 'invalid_tx', 'tx must be the Solana signature of the payout transfer');
        await markPaid(c.env.DB, round.id, v.tx.trim(), now);
        console.log('goal round paid', JSON.stringify({ round: round.id, tx: v.tx.trim(), winner: round.winner_wallet }));
        return c.json({ ok: true, round: round.id, winner: round.winner_wallet, next: 'the next round opens on the next cron tick' });
      }
      case 'cancel': {
        const round = await currentRound(c.env.DB);
        if (!round) return problem(c, 409, 'no_round', 'No round to cancel.');
        await cancelRound(c.env.DB, round.id, typeof v.note === 'string' ? v.note.slice(0, 300) : 'cancelled');
        return c.json({ ok: true, round: round.id, note: 'its contributions roll into the next round' });
      }
      case 'open': {
        if (!cfg.live) return problem(c, 409, 'goal_not_configured', `Goal is not configured: ${cfg.reason}`);
        const title = typeof v.title === 'string' && v.title.trim() ? v.title.trim().slice(0, 120) : DEFAULT_ROUND_TITLE;
        const target = typeof v.targetUsd === 'number' && v.targetUsd > 0 ? Math.round(v.targetUsd) : cfg.targetUsd;
        return c.json({ ok: true, round: await openRound(c.env.DB, title, target, now) });
      }
      case 'tick':
        return c.json({ ok: true, tick: await tickGoal(c.env, fetch, now) });
      default:
        return problem(c, 400, 'invalid_action', 'action must be paid, cancel, open or tick');
    }
  } catch (err) {
    return problem(c, 409, 'round_state', err instanceof Error ? err.message : 'round error');
  }
});
