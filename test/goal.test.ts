import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { __clearChainCache, formatUnits, readPool, readToken } from '../src/goal/chain';
import { parseEntry, pickWinnerIndex } from '../src/goal/rounds';
import { goalStatus } from '../src/routes/goal';
import { goalConfig } from '../src/config';
import { adminInit, clearDb, env, json, request } from './helpers';

const POOL = '0x1111111111111111111111111111111111111111';
const USDC = '0x80e0e24718dbfcad49ecaa6f1e6c89a190586ca8';
const TOKEN = '0x2222222222222222222222222222222222222222';
const LIVE: Partial<Env> = { GOAL_ENABLED: 'true', GOAL_POOL_ADDRESS: POOL, GOAL_USDC_ADDRESS: USDC, GOAL_TARGET_USD: '200' };

/** A fake JSON-RPC that answers balanceOf/totalSupply/eth_getBalance/eth_blockNumber/eth_getBlockByNumber. */
function fakeRpc(state: { usdcUnits: bigint; ethWei: bigint; supply: bigint; burned: bigint; block: number; hash: string }): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    const req = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
    let result: unknown;
    if (req.method === 'eth_blockNumber') result = `0x${state.block.toString(16)}`;
    else if (req.method === 'eth_getBalance') result = `0x${state.ethWei.toString(16)}`;
    else if (req.method === 'eth_getBlockByNumber') result = { hash: state.hash };
    else if (req.method === 'eth_call') {
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

beforeEach(async () => {
  await clearDb();
  await (env as unknown as Env).DB.batch([(env as unknown as Env).DB.prepare('DELETE FROM goal_entries'), (env as unknown as Env).DB.prepare('DELETE FROM goal_rounds')]);
  __clearChainCache();
});

describe('goal configuration', () => {
  it('is off by default and never shows a fake balance', async () => {
    const { status, body } = await json<{ enabled: boolean; pool: { usdc: number | null }; progress: number }>('/api/v1/goal');
    expect(status).toBe(200);
    expect(body.enabled).toBe(false);
    expect(body.pool.usdc).toBeNull();
    expect(body.progress).toBe(0);
    const html = await (await request('/')).text();
    expect(html).toContain('Not open yet');
    expect(html).not.toContain('data-role="goal-entry"');
    const entry = await request('/api/v1/goal/entries', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: '@someone' }) });
    expect(entry.status).toBe(503);
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
  it('reads the pool and token through JSON-RPC and formats units', async () => {
    const cfg = goalConfig({ ...LIVE, RESET_TOKEN_ADDRESS: TOKEN } as never);
    const rpc = fakeRpc({ usdcUnits: 123_450_000n, ethWei: 10n ** 18n / 2n, supply: 990_000_000n * 10n ** 18n, burned: 10_000_000n * 10n ** 18n, block: 66_000_000, hash: `0x${'ab'.repeat(32)}` });
    const pool = await readPool(cfg, rpc);
    expect(pool.usd).toBeCloseTo(123.45, 6);
    expect(pool.block).toBe(66_000_000);
    const token = await readToken(cfg, rpc);
    expect(token.decimals).toBe(18);
    expect(formatUnits(token.totalSupply, 18, 0)).toBe('990,000,000');
    expect(formatUnits(token.burned, 18, 0)).toBe('10,000,000');
    expect(formatUnits(pool.ethWei, 18, 4)).toBe('0.5');
  });

  it('reports a stale pool instead of a fake number when the RPC fails', async () => {
    const failing = (async () => new Response('down', { status: 503 })) as typeof fetch;
    const s = await goalStatus({ ...(env as unknown as Env), ...LIVE } as Env, failing);
    expect(s.enabled).toBe(true);
    expect(s.pool.stale).toBe(true);
    expect(s.pool.usdc).toBeNull();
  });
});

describe('entries and rounds', () => {
  it('parses wallets and X handles, rejecting garbage', () => {
    expect(parseEntry('0xAbCdEF0000000000000000000000000000001234')).toMatchObject({ ok: true, kind: 'wallet', identity: '0xabcdef0000000000000000000000000000001234' });
    expect(parseEntry('@Clauderesets')).toMatchObject({ ok: true, kind: 'x', identity: 'clauderesets', display: '@Clauderesets' });
    expect(parseEntry('https://x.com/someone?s=1')).toMatchObject({ ok: true, kind: 'x', identity: 'someone' });
    expect(parseEntry('0x123').ok).toBe(false);
    expect(parseEntry('way too long handle name here').ok).toBe(false);
    expect(parseEntry(42).ok).toBe(false);
  });

  it('picks the winner deterministically from the draw hash', () => {
    const hash = `0x${'00'.repeat(31)}0b`; // 11
    expect(pickWinnerIndex(hash, 10)).toBe(1);
    expect(pickWinnerIndex(hash, 11)).toBe(0);
    expect(() => pickWinnerIndex(hash, 0)).toThrow();
    expect(() => pickWinnerIndex('0x1234', 3)).toThrow();
  });

  it('runs a full round: open → free entries (deduped) → freeze → draw → paid', async () => {
    const live = { ...(env as unknown as Env), ...LIVE } as Env;
    const open = await json<{ round: { id: number } }>('/admin/goal/rounds', adminInit({ action: 'open', targetUsd: 200 }), LIVE);
    expect(open.status).toBe(200);
    // Same identity twice counts once; a second identity from the same browser is refused.
    const first = await request('/api/v1/goal/entries', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: '@alice' }) }, LIVE);
    expect(first.status).toBe(201);
    const cookie = (first.headers.get('set-cookie') ?? '').split(';')[0]!;
    const again = await request('/api/v1/goal/entries', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ identity: 'alice' }) }, LIVE);
    expect(again.status).toBe(200);
    const other = await request('/api/v1/goal/entries', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ identity: '@bob' }) }, LIVE);
    expect(other.status).toBe(429);
    const bob = await request('/api/v1/goal/entries', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: '0x2222222222222222222222222222222222222222' }) }, LIVE);
    expect(bob.status).toBe(201);
    const bad = await request('/api/v1/goal/entries', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: 'nope nope' }) }, LIVE);
    expect(bad.status).toBe(400);

    const status = await goalStatus(live, fakeRpc({ usdcUnits: 200_000_000n, ethWei: 0n, supply: 0n, burned: 0n, block: 100, hash: `0x${'00'.repeat(31)}01` }));
    expect(status.round?.entries).toBe(2);
    expect(status.progress).toBe(1);

    const html = await (await request('/', {}, LIVE)).text();
    expect(html).toContain('data-role="goal-entry"');
    expect(html).toContain(`/address/${POOL}`);

    // The admin freeze/draw endpoints read the real RPC; drive the state machine directly with the fake instead.
    const { freezeRound, recordDraw, markPaid, currentRound } = await import('../src/goal/rounds');
    const round = (await currentRound(live.DB))!;
    await freezeRound(live.DB, round.id, 100, 700, new Date());
    expect((await request('/api/v1/goal/entries', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: '@late' }) }, LIVE)).status).toBe(409);
    const draw = await recordDraw(live.DB, round.id, `0x${'00'.repeat(31)}01`); // 1 mod 2 = index 1 → bob
    expect(draw.index).toBe(1);
    expect(draw.winner.display).toBe('0x2222…2222');
    await markPaid(live.DB, round.id, `0x${'cd'.repeat(32)}`, new Date());
    const after = await goalStatus(live, fakeRpc({ usdcUnits: 0n, ethWei: 0n, supply: 0n, burned: 0n, block: 800, hash: '0x' + '00'.repeat(32) }));
    expect(after.round?.status).toBe('paid');
    expect(after.round?.winner).toBe('0x2222…2222');
    expect(after.past_rounds[0]?.payout_tx).toBe(`0x${'cd'.repeat(32)}`);
    const page = await (await request('/goal', {}, LIVE)).text();
    expect(page).toContain('Past rounds');
    expect(page).toContain('0x2222…2222');
  });

  it('refuses admin actions without the token', async () => {
    expect((await request('/admin/goal/rounds', { method: 'POST', body: '{"action":"open"}', headers: { 'content-type': 'application/json' } })).status).toBe(401);
  });
});
