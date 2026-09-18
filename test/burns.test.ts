import { keccak256, stringToBytes } from 'viem';
import { beforeEach, describe, expect, it } from 'vitest';
import { __setContentForTests } from '../src/domain/content';
import type { Env } from '../src/env';
import { burnFor, drainBurns, listBurns, queueBurn, type BurnKind, type BurnSigner } from '../src/goal/burns';
import { __clearChainCache } from '../src/goal/chain';
import { freezeRound, openRound, recordDraw, syncContributors } from '../src/goal/rounds';
import { makeEvent, snapshotFor } from './fixtures';
import { adminInit, clearDb, env, json, request } from './helpers';

const POOL = '0x1111111111111111111111111111111111111111';
const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
const TOKEN = '0x2222222222222222222222222222222222222222';
const LIVE: Partial<Env> = { GOAL_ENABLED: 'true', GOAL_POOL_ADDRESS: POOL, GOAL_USDG_ADDRESS: USDG, GOAL_TARGET_USD: '200', RESET_TOKEN_ADDRESS: TOKEN };
const live = () => ({ ...(env as unknown as Env), ...LIVE }) as Env;
const db = () => (env as unknown as Env).DB;

interface ChainState {
  burnedOnChain: Set<string>; // `${kind}:${ref}`
  receipts: Record<string, { status: string; blockNumber: string } | null>;
}

/** Fake RPC: resetBurned/roundBurned views, transaction receipts, and the pool reads goalStatus makes. */
function fakeRpc(state: ChainState): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    const req = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
    let result: unknown = '0x0';
    if (req.method === 'eth_getTransactionReceipt') result = state.receipts[String(req.params[0])] ?? null;
    else if (req.method === 'eth_blockNumber') result = '0x64';
    else if (req.method === 'eth_getBalance') result = '0x0';
    else if (req.method === 'eth_getLogs') result = [];
    else if (req.method === 'eth_call') {
      const { data } = req.params[0] as { data: string };
      const sel = data.slice(0, 10);
      if (sel === '0x313ce567') result = '0x12'; // decimals
      else if (sel === '0x18160ddd') result = `0x${(10n ** 27n).toString(16)}`; // totalSupply
      else if (sel === '0x70a08231') result = '0x0';
      else {
        // resetBurned(bytes32) / roundBurned(uint256): answer from the fake set by matching the encoded argument
        const hit = [...state.burnedOnChain].some((k) => {
          const [kind, ref] = k.split(':') as [BurnKind, string];
          return kind === 'round' ? data.endsWith(BigInt(ref).toString(16).padStart(64, '0')) : data.endsWith(keccak256(stringToBytes(ref)).slice(2));
        });
        result = hit ? `0x${'1'.padStart(64, '0')}` : `0x${'0'.padStart(64, '0')}`;
      }
    }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

function state(): ChainState {
  return { burnedOnChain: new Set(), receipts: {} };
}

function fakeSigner(calls: Array<{ kind: BurnKind; ref: string }>, fail?: string): BurnSigner {
  return {
    address: '0x3333333333333333333333333333333333333333',
    async send(kind, ref) {
      if (fail) throw new Error(fail);
      calls.push({ kind, ref });
      return `0x${calls.length.toString(16).padStart(64, '0')}`;
    },
  };
}

beforeEach(async () => {
  await clearDb();
  await db().batch([db().prepare('DELETE FROM token_burns'), db().prepare('DELETE FROM goal_entries'), db().prepare('DELETE FROM goal_rounds')]);
  __setContentForTests(null);
  __clearChainCache();
});

describe('automatic burns', () => {
  it('queues a burn once when a confirmed reset is first published, never for backfills or corrections', async () => {
    const fresh = makeEvent({ id: 'fresh-burn', at: new Date(Date.now() - 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z') });
    __setContentForTests(snapshotFor([fresh]));
    const off = await json<{ burn: { queued: boolean; reason: string } }>('/admin/publish', adminInit({ eventId: fresh.id, mode: 'publish', event: fresh }));
    expect(off.status).toBe(200);
    expect(off.body.burn.queued).toBe(false); // no token configured
    await clearDb();
    const first = await json<{ burn: { queued: boolean; reason: string } }>('/admin/publish', adminInit({ eventId: fresh.id, mode: 'publish', event: fresh }), LIVE);
    expect(first.body.burn.queued).toBe(true);
    const again = await json<{ burn: { queued: boolean } }>('/admin/publish', adminInit({ eventId: fresh.id, mode: 'publish', event: fresh }), LIVE);
    expect(again.body.burn.queued).toBe(false);
    expect(await listBurns(db())).toHaveLength(1);

    const history = makeEvent({ id: 'old-burn', at: '2026-05-01T00:00:00Z' });
    __setContentForTests(snapshotFor([fresh, history]));
    const backfill = await json<{ burn: { queued: boolean; reason: string } }>('/admin/publish', adminInit({ eventId: history.id, mode: 'backfill', alertPolicy: 'none', event: history }), LIVE);
    expect(backfill.body.burn.queued).toBe(false);
    expect(backfill.body.burn.reason).toMatch(/backfill/);
    expect(await listBurns(db())).toHaveLength(1);
  });

  it('sends queued burns with the burner, follows the receipt, and confirms', async () => {
    const now = new Date('2026-09-18T12:00:00Z');
    expect(await queueBurn(db(), 'reset', 'ev-1', now)).toBe(true);
    expect(await queueBurn(db(), 'reset', 'ev-1', now)).toBe(false);
    const s = state();
    const calls: Array<{ kind: BurnKind; ref: string }> = [];

    // no burner configured: rows wait
    const waiting = await drainBurns(live(), { fetchFn: fakeRpc(s), signer: null, now });
    expect(waiting.skipped).toMatch(/BURNER_PRIVATE_KEY/);
    expect((await burnFor(db(), 'reset', 'ev-1'))?.status).toBe('queued');

    // send
    const sent = await drainBurns(live(), { fetchFn: fakeRpc(s), signer: fakeSigner(calls), now });
    expect(sent.sent).toBe(1);
    expect(calls).toEqual([{ kind: 'reset', ref: 'ev-1' }]);
    const row = (await burnFor(db(), 'reset', 'ev-1'))!;
    expect(row.status).toBe('sent');
    expect(row.tx_hash).toMatch(/^0x[0-9a-f]{64}$/);

    // receipt pending → unchanged; receipt mined → confirmed with block
    const pending = await drainBurns(live(), { fetchFn: fakeRpc(s), signer: fakeSigner(calls), now: new Date(now.getTime() + 60_000) });
    expect(pending.confirmed).toBe(0);
    s.receipts[row.tx_hash!] = { status: '0x1', blockNumber: '0x2a' };
    const done = await drainBurns(live(), { fetchFn: fakeRpc(s), signer: fakeSigner(calls), now: new Date(now.getTime() + 120_000) });
    expect(done.confirmed).toBe(1);
    const final = (await burnFor(db(), 'reset', 'ev-1'))!;
    expect(final.status).toBe('confirmed');
    expect(final.block).toBe(42);
    expect(calls).toHaveLength(1); // never re-sent

    // public status carries the log; the goal page renders it
    const status = await json<{ burns: Array<{ kind: string; ref: string; status: string; tx: string }> }>('/api/v1/goal', {}, LIVE);
    expect(status.body.burns[0]).toMatchObject({ kind: 'reset', ref: 'ev-1', status: 'confirmed', tx: row.tx_hash });
    const page = await (await request('/goal', {}, LIVE)).text();
    expect(page).toContain('Burn log');
    expect(page).toContain(`/tx/${row.tx_hash}`);
  });

  it('retries transient failures with backoff and gives up on contract refusals', async () => {
    const now = new Date('2026-09-18T12:00:00Z');
    await queueBurn(db(), 'reset', 'ev-2', now);
    const s = state();
    const transient = await drainBurns(live(), { fetchFn: fakeRpc(s), signer: fakeSigner([], 'rpc timeout'), now });
    expect(transient.retried).toBe(1);
    let row = (await burnFor(db(), 'reset', 'ev-2'))!;
    expect(row.status).toBe('queued');
    expect(row.attempts).toBe(1);
    expect(Date.parse(row.next_attempt_at)).toBeGreaterThan(now.getTime());
    // not due yet → nothing happens
    const early = await drainBurns(live(), { fetchFn: fakeRpc(s), signer: fakeSigner([], 'rpc timeout'), now: new Date(now.getTime() + 30_000) });
    expect(early.retried + early.sent).toBe(0);
    // due, and the contract says it was already burned → permanent failure, no more attempts
    const refused = await drainBurns(live(), { fetchFn: fakeRpc(s), signer: fakeSigner([], 'execution reverted: already burned'), now: new Date(now.getTime() + 10 * 60_000) });
    expect(refused.failed).toBe(1);
    row = (await burnFor(db(), 'reset', 'ev-2'))!;
    expect(row.status).toBe('failed');
    expect(row.last_error).toMatch(/already burned/);
    // maintainer retry puts it back in the queue
    const retry = await json<{ retried: boolean }>('/admin/goal/burns', adminInit({ action: 'retry', id: row.id }), LIVE);
    expect(retry.body.retried).toBe(true);
    expect((await burnFor(db(), 'reset', 'ev-2'))?.status).toBe('queued');
  });

  it('self-heals when the chain already shows the burn, and queues a round burn when a round is paid', async () => {
    const now = new Date('2026-09-18T12:00:00Z');
    const s = state();
    // A round paid through the admin endpoint queues burnForRound(roundId)
    const round = await openRound(db(), 'r', 200, 100, now);
    await syncContributors(db(), round.id, [{ address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', units: 1_000_000n, firstTx: '0xa1' }], now);
    await freezeRound(db(), round.id, 150, 750, now);
    await recordDraw(db(), round.id, `0x${'00'.repeat(31)}01`);
    const paid = await json<{ ok: boolean; burn: string }>('/admin/goal/rounds', adminInit({ action: 'paid', tx: `0x${'cd'.repeat(32)}` }), LIVE);
    expect(paid.status).toBe(200);
    expect(paid.body.burn).toMatch(/queued/);
    expect((await burnFor(db(), 'round', String(round.id)))?.status).toBe('queued');

    // The chain already has this round burned (e.g. done manually) → confirmed without sending
    s.burnedOnChain.add(`round:${round.id}`);
    const calls: Array<{ kind: BurnKind; ref: string }> = [];
    const healed = await drainBurns(live(), { fetchFn: fakeRpc(s), signer: fakeSigner(calls), now: new Date(Date.now() + 1000) }); // the admin route queued it at real time
    expect(healed.confirmed).toBe(1);
    expect(calls).toHaveLength(0);
    expect((await burnFor(db(), 'round', String(round.id)))?.status).toBe('confirmed');

    // Maintainer can queue a reset that was published before the token existed, but only a real one
    const bad = await json<{ code: string }>('/admin/goal/burns', adminInit({ action: 'queue', eventId: 'nope' }), LIVE);
    expect(bad.status).toBe(409);
    const good = await json<{ queued: boolean }>('/admin/goal/burns', adminInit({ action: 'queue', eventId: '2026-09-04-max-weekly' }), LIVE);
    expect(good.status).toBe(200);
    expect(good.body.queued).toBe(true);
    const list = await json<{ burner: boolean; burns: unknown[] }>('/admin/goal/burns', { headers: adminInit({}).headers }, LIVE);
    expect(list.body.burner).toBe(false);
    expect(list.body.burns).toHaveLength(2);
  });

  it('is a no-op without a token address and stays off the public status', async () => {
    await queueBurn(db(), 'reset', 'ev-3', new Date());
    const r = await drainBurns(env as unknown as Env, { signer: null });
    expect(r.skipped).toMatch(/RESET_TOKEN_ADDRESS/);
    const status = await json<{ burns: unknown[] }>('/api/v1/goal');
    expect(status.body.burns).toEqual([]);
  });
});
