import { beforeEach, describe, expect, it } from 'vitest';
import { goalConfig } from '../src/config';
import type { Env } from '../src/env';
import { __clearChainCache, formatUnits, readPool, readToken, summarizeContributors, transfersTo } from '../src/goal/chain';
import { MIN_CONTRIBUTION_UNITS, currentRound, freezeRound, markPaid, openRound, pickWinnerIndex, recordDraw, syncContributors } from '../src/goal/rounds';
import { goalStatus } from '../src/routes/goal';
import { adminInit, clearDb, env, json, request } from './helpers';

const POOL = '0x1111111111111111111111111111111111111111';
const USDC = '0x80e0e24718dbfcad49ecaa6f1e6c89a190586ca8';
const TOKEN = '0x2222222222222222222222222222222222222222';
const LIVE: Partial<Env> = { GOAL_ENABLED: 'true', GOAL_POOL_ADDRESS: POOL, GOAL_USDC_ADDRESS: USDC, GOAL_TARGET_USD: '200' };
const A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const C = '0xcccccccccccccccccccccccccccccccccccccccc';

interface FakeState {
  usdcUnits: bigint;
  ethWei: bigint;
  supply: bigint;
  burned: bigint;
  block: number;
  hash: string;
  transfers: Array<{ from: string; units: bigint; block: number; tx: string }>;
}

/** A fake JSON-RPC covering balanceOf/totalSupply/decimals, eth_getBalance, eth_blockNumber, eth_getBlockByNumber and eth_getLogs. */
function fakeRpc(state: FakeState): typeof fetch {
  const pad = (a: string) => `0x${a.replace(/^0x/, '').toLowerCase().padStart(64, '0')}`;
  return (async (_url: unknown, init?: RequestInit) => {
    const req = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
    let result: unknown;
    if (req.method === 'eth_blockNumber') result = `0x${state.block.toString(16)}`;
    else if (req.method === 'eth_getBalance') result = `0x${state.ethWei.toString(16)}`;
    else if (req.method === 'eth_getBlockByNumber') result = { hash: state.hash };
    else if (req.method === 'eth_getLogs') {
      const f = req.params[0] as { fromBlock: string; toBlock: string };
      const from = Number(BigInt(f.fromBlock));
      const to = Number(BigInt(f.toBlock));
      result = state.transfers.filter((t) => t.block >= from && t.block <= to).map((t) => ({ topics: ['0xddf252ad', pad(t.from), pad(POOL)], data: `0x${t.units.toString(16)}`, transactionHash: t.tx, blockNumber: `0x${t.block.toString(16)}` }));
    } else if (req.method === 'eth_call') {
      const { to, data } = req.params[0] as { to: string; data: string };
      const sel = data.slice(0, 10);
      const owner = `0x${data.slice(34)}`;
      if (sel === '0x70a08231') result = to.toLowerCase() === USDC ? `0x${state.usdcUnits.toString(16)}` : owner.endsWith('dead') ? `0x${state.burned.toString(16)}` : '0x0';
      else if (sel === '0x18160ddd') result = `0x${state.supply.toString(16)}`;
      else if (sel === '0x313ce567') result = '0x12';
      else result = '0x';
    }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

const base = (): FakeState => ({ usdcUnits: 0n, ethWei: 0n, supply: 990_000_000n * 10n ** 18n, burned: 10_000_000n * 10n ** 18n, block: 100, hash: `0x${'00'.repeat(31)}01`, transfers: [] });

beforeEach(async () => {
  await clearDb();
  const db = (env as unknown as Env).DB;
  await db.batch([db.prepare('DELETE FROM goal_entries'), db.prepare('DELETE FROM goal_rounds')]);
  __clearChainCache();
});

describe('goal configuration', () => {
  it('is off by default and never shows a fake balance or a way to contribute', async () => {
    const { status, body } = await json<{ enabled: boolean; pool: { usdc: number | null }; progress: number }>('/api/v1/goal');
    expect(status).toBe(200);
    expect(body.enabled).toBe(false);
    expect(body.pool.usdc).toBeNull();
    expect(body.progress).toBe(0);
    const html = await (await request('/')).text();
    expect(html).toContain('Not open yet');
    expect(html).not.toContain('data-role="goal-contribute"');
    const open = await json<{ code: string }>('/admin/goal/rounds', adminInit({ action: 'open' }));
    expect(open.status).toBe(409);
    expect(open.body.code).toBe('goal_not_configured');
  });

  it('requires a valid pool and USDC address before going live', () => {
    expect(goalConfig({ GOAL_ENABLED: 'true' }).live).toBe(false);
    expect(goalConfig({ GOAL_ENABLED: 'true', GOAL_POOL_ADDRESS: 'not-an-address', GOAL_USDC_ADDRESS: USDC }).live).toBe(false);
    const ok = goalConfig(LIVE as never);
    expect(ok.live).toBe(true);
    expect(ok.chainId).toBe(4663);
    expect(ok.rpcUrl).toBe('https://rpc.mainnet.chain.robinhood.com');
  });
});

describe('chain reads', () => {
  it('reads the pool, the token and the contributor log through JSON-RPC', async () => {
    const cfg = goalConfig({ ...LIVE, RESET_TOKEN_ADDRESS: TOKEN } as never);
    const state = base();
    state.usdcUnits = 123_450_000n;
    state.ethWei = 10n ** 18n / 2n;
    state.transfers = [
      { from: A, units: 5_000_000n, block: 10, tx: '0xa1' },
      { from: B, units: 500_000n, block: 11, tx: '0xb1' }, // below the 1 USDC minimum
      { from: A, units: 1_000_000n, block: 12, tx: '0xa2' },
      { from: C, units: 1_000_000n, block: 13, tx: '0xc1' },
    ];
    const rpc = fakeRpc(state);
    const pool = await readPool(cfg, rpc);
    expect(pool.usd).toBeCloseTo(123.45, 6);
    const token = await readToken(cfg, rpc);
    expect(formatUnits(token.totalSupply, 18, 0)).toBe('990,000,000');
    expect(formatUnits(pool.ethWei, 18, 4)).toBe('0.5');
    const transfers = await transfersTo(rpc, cfg.rpcUrl, USDC, POOL, 1, 100);
    expect(transfers).toHaveLength(4);
    const contributors = summarizeContributors(transfers, MIN_CONTRIBUTION_UNITS);
    expect(contributors.map((c) => c.address)).toEqual([A, C]); // B's dust does not count; A counted once
    expect(contributors[0]!.units).toBe(6_000_000n);
  });

  it('reports a stale pool instead of a fake number when the RPC fails', async () => {
    const failing = (async () => new Response('down', { status: 503 })) as typeof fetch;
    const s = await goalStatus({ ...(env as unknown as Env), ...LIVE } as Env, failing);
    expect(s.enabled).toBe(true);
    expect(s.pool.stale).toBe(true);
    expect(s.pool.usdc).toBeNull();
  });
});

describe('rounds', () => {
  it('picks the winner deterministically from the draw hash', () => {
    const hash = `0x${'00'.repeat(31)}0b`; // 11
    expect(pickWinnerIndex(hash, 10)).toBe(1);
    expect(pickWinnerIndex(hash, 11)).toBe(0);
    expect(() => pickWinnerIndex(hash, 0)).toThrow();
    expect(() => pickWinnerIndex('0x1234', 3)).toThrow();
  });

  it('runs a full round: open → contributions on chain → freeze snapshot → draw → paid', async () => {
    const live = { ...(env as unknown as Env), ...LIVE } as Env;
    const db = live.DB;
    const state = base();
    const rpc = fakeRpc(state);
    const round = await openRound(db, 'One month of Max 20x', 200, 100, new Date());
    // Contributions arrive on chain; the open-round status counts unique contributors live.
    state.transfers = [
      { from: A, units: 150_000_000n, block: 120, tx: '0xa1' },
      { from: B, units: 1_000_000n, block: 130, tx: '0xb1' },
      { from: A, units: 49_000_000n, block: 140, tx: '0xa2' },
    ];
    state.usdcUnits = 200_000_000n;
    state.block = 150;
    const s1 = await goalStatus(live, rpc);
    expect(s1.round?.status).toBe('open');
    expect(s1.round?.contributors).toBe(2);
    expect(s1.progress).toBe(1);
    const html = await (await request('/', {}, LIVE)).text();
    expect(html).toContain('data-role="goal-contribute"');
    expect(html).toContain(POOL);

    // Freeze: snapshot contributors from the chain into the entry list (equal odds regardless of amount).
    const transfers = await transfersTo(rpc, 'x', USDC, POOL, round.open_block!, 150);
    await syncContributors(db, round.id, summarizeContributors(transfers, MIN_CONTRIBUTION_UNITS), new Date());
    await freezeRound(db, round.id, 150, 750, new Date());
    const draw = await recordDraw(db, round.id, `0x${'00'.repeat(31)}01`); // 1 mod 2 → index 1 → B, the 1 USDC contributor
    expect(draw.entries).toBe(2);
    expect(draw.winner.identity).toBe(B);
    await markPaid(db, round.id, `0x${'cd'.repeat(32)}`, new Date());
    __clearChainCache();
    const after = await goalStatus(live, rpc);
    expect(after.round?.status).toBe('paid');
    expect(after.round?.winner).toBe('0xbbbb…bbbb');
    expect(after.past_rounds[0]?.payout_tx).toBe(`0x${'cd'.repeat(32)}`);
    expect(await currentRound(db)).toBeNull();
    const page = await (await request('/goal', {}, LIVE)).text();
    expect(page).toContain('Past rounds');
    expect(page).toContain('0xbbbb…bbbb');
  });

  it('refuses admin actions without the token', async () => {
    expect((await request('/admin/goal/rounds', { method: 'POST', body: '{"action":"open"}', headers: { 'content-type': 'application/json' } })).status).toBe(401);
  });
});
