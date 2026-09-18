import { Hono } from 'hono';
import { siteConfig, type Env } from '../env';
import { blockHash, blockNumber, cached, formatUnits, readPool, readToken, summarizeContributors, transfersTo, type ContributorSummary, type FetchLike, type PoolSnapshot, type TokenSnapshot } from '../goal/chain';
import { MIN_CONTRIBUTION_UNITS, cancelRound, countEntries, currentRound, freezeRound, latestRound, markPaid, openRound, pastRounds, recordDraw, syncContributors, winnerOf, type GoalRound } from '../goal/rounds';
import { problem, readJson, timingSafeEqual } from '../util/http';

export const goal = new Hono<{ Bindings: Env }>();

export interface GoalStatus {
  enabled: boolean;
  chain: { id: number; name: string; explorer: string };
  target_usd: number;
  min_contribution_usd: number;
  pool: { address: string | null; usdc: number | null; eth: string | null; block: number | null; read_at: string | null; stale: boolean };
  round: null | {
    id: number;
    title: string;
    status: GoalRound['status'];
    opened_at: string;
    open_block: number | null;
    contributors: number;
    frozen_at: string | null;
    draw_block: number | null;
    draw_hash: string | null;
    winner: string | null;
    payout_tx: string | null;
  };
  past_rounds: Array<{ id: number; title: string; status: string; winner: string | null; payout_tx: string | null; paid_at: string | null }>;
  token: null | { address: string; total_supply: string; burned: string; circulating: string; decimals: number; read_at: string };
  progress: number; // 0..1
}

/** Contributors of the open round, read from the chain (unique senders ≥ minimum), cached 60 s. */
async function liveContributors(env: Env, round: GoalRound, fetchFn: FetchLike): Promise<ContributorSummary[] | null> {
  const cfg = siteConfig(env).goal;
  if (!cfg.live || round.open_block == null) return null;
  try {
    return await cached<ContributorSummary[]>(`contrib:${cfg.poolAddress}:${round.id}:${round.freeze_block ?? 'open'}`, 60_000, async () => {
      const end = round.freeze_block ?? (await blockNumber(fetchFn, cfg.rpcUrl));
      const transfers = await transfersTo(fetchFn, cfg.rpcUrl, cfg.usdcAddress!, cfg.poolAddress!, round.open_block!, end);
      return summarizeContributors(transfers, MIN_CONTRIBUTION_UNITS);
    });
  } catch (err) {
    console.error('contributor read failed', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Shared by the API and the page renderer. Chain reads are cached per isolate for 60 s and never throw. */
export async function goalStatus(env: Env, fetchFn: FetchLike = fetch): Promise<GoalStatus> {
  const cfg = siteConfig(env).goal;
  const status: GoalStatus = {
    enabled: cfg.live,
    chain: { id: cfg.chainId, name: 'Robinhood Chain', explorer: cfg.explorerUrl },
    target_usd: cfg.targetUsd,
    min_contribution_usd: Number(MIN_CONTRIBUTION_UNITS) / 1e6,
    pool: { address: cfg.poolAddress, usdc: null, eth: null, block: null, read_at: null, stale: false },
    round: null,
    past_rounds: [],
    token: null,
    progress: 0,
  };
  if (cfg.live) {
    try {
      const pool = await cached<PoolSnapshot>(`pool:${cfg.poolAddress}`, 60_000, () => readPool(cfg, fetchFn));
      status.pool = { address: cfg.poolAddress, usdc: pool.usd, eth: formatUnits(pool.ethWei, 18, 4), block: pool.block, read_at: pool.readAt, stale: false };
      status.progress = Math.min(1, pool.usd / cfg.targetUsd);
    } catch (err) {
      console.error('goal pool read failed', err instanceof Error ? err.message : err);
      status.pool.stale = true;
    }
  }
  if (cfg.tokenAddress) {
    try {
      const t = await cached<TokenSnapshot>(`token:${cfg.tokenAddress}`, 60_000, () => readToken(cfg, fetchFn));
      status.token = { address: t.address, total_supply: t.totalSupply.toString(), burned: t.burned.toString(), circulating: t.circulating.toString(), decimals: t.decimals, read_at: t.readAt };
    } catch (err) {
      console.error('token read failed', err instanceof Error ? err.message : err);
    }
  }
  try {
    const round = (await currentRound(env.DB)) ?? (await latestRound(env.DB));
    if (round) {
      const winner = await winnerOf(env.DB, round);
      const live = round.status === 'open' ? await liveContributors(env, round, fetchFn) : null;
      status.round = {
        id: round.id,
        title: round.title,
        status: round.status,
        opened_at: round.opened_at,
        open_block: round.open_block,
        contributors: live ? live.length : await countEntries(env.DB, round.id),
        frozen_at: round.frozen_at,
        draw_block: round.draw_block,
        draw_hash: round.draw_hash,
        winner: winner?.display ?? null,
        payout_tx: round.payout_tx,
      };
    }
    const past = await pastRounds(env.DB, 10);
    for (const r of past) {
      const w = await winnerOf(env.DB, r);
      status.past_rounds.push({ id: r.id, title: r.title, status: r.status, winner: w?.display ?? null, payout_tx: r.payout_tx, paid_at: r.paid_at });
    }
  } catch (err) {
    console.error('goal rounds unavailable', err instanceof Error ? err.message : err);
  }
  return status;
}

goal.get('/', async (c) => {
  const body = await goalStatus(c.env);
  return c.json(body, 200, { 'cache-control': 'public, max-age=30', 'access-control-allow-origin': '*' });
});

/** Public contributor list for the current round (addresses shortened), so draws can be verified. */
goal.get('/contributors', async (c) => {
  const round = await currentRound(c.env.DB);
  if (!round) return c.json({ round: null, contributors: [] }, 200, { 'cache-control': 'public, max-age=30' });
  const cfg = siteConfig(c.env).goal;
  let list: Array<{ index: number; address: string; usdc: number }> = [];
  if (round.status === 'open') {
    const live = await liveContributors(c.env, round, fetch);
    list = (live ?? []).map((x, i) => ({ index: i, address: x.address, usdc: Number(x.units) / 1e6 }));
  } else {
    const { listEntries } = await import('../goal/rounds');
    list = (await listEntries(c.env.DB, round.id)).map((e, i) => ({ index: i, address: e.identity, usdc: e.amount_units / 1e6 }));
  }
  return c.json({ round: round.id, status: round.status, min_contribution_usd: Number(MIN_CONTRIBUTION_UNITS) / 1e6, explorer: cfg.explorerUrl, contributors: list }, 200, { 'cache-control': 'public, max-age=30', 'access-control-allow-origin': '*' });
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

goalAdmin.post('/rounds', async (c) => {
  const body = await readJson(c, 8192);
  if (!body.ok) return problem(c, 400, 'invalid_body', body.error);
  const v = body.value as Record<string, unknown>;
  const cfg = siteConfig(c.env).goal;
  const now = new Date();
  try {
    switch (v.action) {
      case 'open': {
        if (!cfg.live) return problem(c, 409, 'goal_not_configured', `Goal is not configured: ${cfg.reason}`);
        const title = typeof v.title === 'string' && v.title.trim() ? v.title.trim().slice(0, 120) : 'One month of Claude Max 20x for a contributor';
        const target = typeof v.targetUsd === 'number' && v.targetUsd > 0 ? Math.round(v.targetUsd) : cfg.targetUsd;
        const openBlock = typeof v.openBlock === 'number' ? Math.floor(v.openBlock) : await blockNumber(fetch, cfg.rpcUrl);
        return c.json({ ok: true, round: await openRound(c.env.DB, title, target, openBlock, now) });
      }
      case 'freeze': {
        const round = await currentRound(c.env.DB);
        if (!round || round.status !== 'open') return problem(c, 409, 'no_round', 'No open round.');
        const current = await blockNumber(fetch, cfg.rpcUrl);
        const lead = typeof v.blocksAhead === 'number' && v.blocksAhead >= 10 ? Math.floor(v.blocksAhead) : 600; // ~1 minute at 100 ms blocks
        // Snapshot the contributor set from the chain for [open_block, current] and store it as the entry list.
        const transfers = await transfersTo(fetch, cfg.rpcUrl, cfg.usdcAddress!, cfg.poolAddress!, round.open_block ?? current, current);
        const contributors = summarizeContributors(transfers, MIN_CONTRIBUTION_UNITS);
        if (contributors.length === 0) return problem(c, 409, 'no_contributors', 'No contributions at or above the minimum yet; nothing to draw from.');
        await syncContributors(c.env.DB, round.id, contributors, now);
        await freezeRound(c.env.DB, round.id, current, current + lead, now);
        return c.json({ ok: true, round: round.id, freezeBlock: current, drawBlock: current + lead, contributors: contributors.length });
      }
      case 'draw': {
        const round = await currentRound(c.env.DB);
        if (!round || round.status !== 'frozen' || !round.draw_block) return problem(c, 409, 'not_frozen', 'Freeze the round first.');
        const current = await blockNumber(fetch, cfg.rpcUrl);
        if (current < round.draw_block) return problem(c, 409, 'too_early', `Draw block ${round.draw_block} not reached yet (current ${current}).`);
        const hash = await blockHash(fetch, cfg.rpcUrl, round.draw_block);
        if (!hash) return problem(c, 503, 'block_unavailable', 'Could not read the draw block yet.');
        const result = await recordDraw(c.env.DB, round.id, hash);
        return c.json({ ok: true, round: round.id, drawBlock: round.draw_block, drawHash: hash, index: result.index, entries: result.entries, winner: result.winner.display, winnerAddress: result.winner.identity });
      }
      case 'paid': {
        const round = await currentRound(c.env.DB);
        if (!round) return problem(c, 409, 'no_round', 'No round to mark paid.');
        if (typeof v.tx !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(v.tx)) return problem(c, 400, 'invalid_tx', 'tx must be a transaction hash');
        await markPaid(c.env.DB, round.id, v.tx, now);
        return c.json({ ok: true, round: round.id });
      }
      case 'cancel': {
        const round = await currentRound(c.env.DB);
        if (!round) return problem(c, 409, 'no_round', 'No round to cancel.');
        await cancelRound(c.env.DB, round.id, typeof v.note === 'string' ? v.note.slice(0, 300) : 'cancelled');
        return c.json({ ok: true, round: round.id });
      }
      default:
        return problem(c, 400, 'invalid_action', 'action must be open, freeze, draw, paid or cancel');
    }
  } catch (err) {
    return problem(c, 409, 'round_state', err instanceof Error ? err.message : 'round error');
  }
});
