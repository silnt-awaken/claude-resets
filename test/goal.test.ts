import { beforeEach, describe, expect, it } from 'vitest';
import { goalConfig } from '../src/config';
import type { Env } from '../src/env';
import { base58Decode, base58Encode, bytesToBigInt, isSolanaAddress, isSolanaSignature } from '../src/goal/base58';
import { MIN_CONTRIBUTION_UNITS, currentRound, latestRound, openRound, pickWinnerIndex, qualifyingEntries } from '../src/goal/rounds';
import { PRIORITY_FEE_LAMPORTS, SOLANA, buildTransferMessage, deriveAssociatedTokenAccount, isOnCurve, messageHasAccount, parseContribution, parseSignedTransaction, unsignedTransaction, type ParsedTransaction } from '../src/goal/solana';
import { goalStatus, syncContributions, tickGoal } from '../src/routes/goal';
import { adminInit, clearDb, env, json, request } from './helpers';

// Real mainnet addresses (public), used only as well-formed test data.
const WALLET = '6N9a6TJhFzGGtRLPkekmwF3xq2ncuXh7Yz7XipU6grBv';
const POOL_USDC = 'EuMtJBznvR8Sqt2y3pL1nKWmGhp63PaMqfBFG8kmXNiG';
const USDC = SOLANA.usdcMint;
const A = 'A1zk1P2sZ9UVwL8JoKa4Vhef7rNzQ8s6Y2xJm9pDcaaa';
const B = 'B2qJ1hvL7n5yFgW3Fm6Kz5tQq8pT4X5NwYhRdyt2Mbbb';
const C = 'C3mF9kQm4NsG6d7PxxYqeVb2Xa8cLwd5Mt6JpZ9hTccc';
const LIVE: Partial<Env> = { GOAL_ENABLED: 'true', GOAL_WALLET: WALLET, GOAL_USDC_ACCOUNT: POOL_USDC, GOAL_TARGET_USD: '200' };
const live = () => ({ ...(env as unknown as Env), ...LIVE }) as Env;
const db = () => (env as unknown as Env).DB;

function sig(n: number): string {
  return base58Encode(new Uint8Array(64).map((_, i) => (i === 63 ? n : i === 0 ? 7 : 0)));
}
function hash32(last: number): string {
  return base58Encode(new Uint8Array(32).map((_, i) => (i === 31 ? last : 0)));
}

interface FakeTx {
  signature: string;
  slot: number;
  from: string;
  units: bigint;
  err?: boolean;
  /** Emulate a swap: no parsed transfer to our account, only the balance delta. */
  viaProgram?: boolean;
}

interface FakeChain {
  slotConfirmed: number;
  slotFinalized: number;
  /** finalized blocks: slot → hash (slots not listed are skipped) */
  blocks: Record<number, string>;
  txs: FakeTx[];
  /** token accounts by address: owner, mint and balance (what getAccountInfo returns) */
  accounts: Record<string, { owner: string; mint: string; amount: bigint }>;
  lamports: Record<string, number>;
  calls: string[];
  /** what sendTransaction answers: the signature it reports, or an error message */
  send?: { signature?: string; error?: string };
  sent?: string[];
}

function parsedTx(t: FakeTx): ParsedTransaction {
  const source = `${t.from.slice(0, 40)}srcA`;
  return {
    slot: t.slot,
    blockTime: 1_789_000_000 + t.slot,
    meta: {
      err: t.err ? { InstructionError: [0, 'Custom'] } : null,
      preTokenBalances: [{ accountIndex: 2, mint: USDC, uiTokenAmount: { amount: '1000000' } }],
      postTokenBalances: [{ accountIndex: 2, mint: USDC, uiTokenAmount: { amount: (1_000_000n + t.units).toString() } }],
      innerInstructions: [],
    },
    transaction: {
      signatures: [t.signature],
      message: {
        accountKeys: [
          { pubkey: t.from, signer: true },
          { pubkey: source, signer: false },
          { pubkey: POOL_USDC, signer: false },
          { pubkey: SOLANA.tokenProgram, signer: false },
        ],
        instructions: t.viaProgram
          ? [{ programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4' }]
          : [{ program: 'spl-token', programId: SOLANA.tokenProgram, parsed: { type: 'transferChecked', info: { source, destination: POOL_USDC, authority: t.from, mint: USDC } } }],
      },
    },
  };
}

/** A fake Solana JSON-RPC covering exactly the methods the goal uses. */
function fakeRpc(chain: FakeChain): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    const req = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
    chain.calls.push(req.method);
    let result: unknown = null;
    switch (req.method) {
      case 'getSlot':
        result = (req.params[0] as { commitment: string }).commitment === 'finalized' ? chain.slotFinalized : chain.slotConfirmed;
        break;
      case 'getBlocks': {
        const [start, end] = req.params as [number, number];
        result = Object.keys(chain.blocks)
          .map(Number)
          .filter((s) => s >= start && s <= end && s <= chain.slotFinalized)
          .sort((a, b) => a - b);
        break;
      }
      case 'getBlock': {
        const slot = req.params[0] as number;
        result = chain.blocks[slot] ? { blockhash: chain.blocks[slot] } : null;
        break;
      }
      case 'getLatestBlockhash':
        result = { value: { blockhash: hash32(9), lastValidBlockHeight: 123 } };
        break;
      case 'getSignaturesForAddress': {
        const opts = (req.params[1] ?? {}) as { until?: string; before?: string; limit?: number };
        let list = [...chain.txs].sort((a, b) => b.slot - a.slot); // newest first
        if (opts.before) {
          const i = list.findIndex((t) => t.signature === opts.before);
          list = i >= 0 ? list.slice(i + 1) : list;
        }
        if (opts.until) {
          const i = list.findIndex((t) => t.signature === opts.until);
          if (i >= 0) list = list.slice(0, i);
        }
        result = list.slice(0, opts.limit ?? 1000).map((t) => ({ signature: t.signature, slot: t.slot, err: t.err ? { failed: true } : null, blockTime: 1_789_000_000 + t.slot }));
        break;
      }
      case 'getTransaction': {
        const t = chain.txs.find((x) => x.signature === req.params[0]);
        result = t ? parsedTx(t) : null;
        break;
      }
      case 'getAccountInfo': {
        const a = chain.accounts[req.params[0] as string];
        result = { value: a ? { data: { parsed: { type: 'account', info: { owner: a.owner, mint: a.mint, tokenAmount: { amount: a.amount.toString() } } } } } : null };
        break;
      }
      case 'getBalance':
        result = { value: chain.lamports[req.params[0] as string] ?? 0 };
        break;
      case 'getFeeForMessage':
        result = { value: 5000 };
        break;
      case 'sendTransaction': {
        (chain.sent ??= []).push(req.params[0] as string);
        if (chain.send?.error) return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32002, message: chain.send.error } }), { headers: { 'content-type': 'application/json' } });
        result = chain.send?.signature ?? sig(77);
        break;
      }
      default:
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: `unsupported ${req.method}` } }), { headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

function chain(): FakeChain {
  return { slotConfirmed: 1000, slotFinalized: 990, blocks: {}, txs: [{ signature: sig(1), slot: 500, from: C, units: 3_000_000n }], accounts: {}, lamports: {}, calls: [] };
}

beforeEach(async () => {
  await clearDb();
  await db().batch([db().prepare('DELETE FROM goal_contributions'), db().prepare('DELETE FROM goal_rounds'), db().prepare('DELETE FROM goal_sync')]);
});

describe('base58 and addresses', () => {
  it('round-trips real Solana keys and validates addresses and signatures', () => {
    const bytes = base58Decode(WALLET);
    expect(bytes).toHaveLength(32);
    expect(base58Encode(bytes)).toBe(WALLET);
    expect(base58Encode(new Uint8Array([0, 0, 1]))).toBe('112');
    expect(base58Decode('112')).toEqual(new Uint8Array([0, 0, 1]));
    expect(isSolanaAddress(WALLET)).toBe(true);
    expect(isSolanaAddress('0xCA6d06946e498b03112cFE0812C44Ac165dd4747')).toBe(false);
    expect(isSolanaAddress(sig(1))).toBe(false); // 64 bytes is a signature, not an address
    expect(isSolanaSignature(sig(1))).toBe(true);
    expect(isSolanaSignature(WALLET)).toBe(false);
    expect(bytesToBigInt(new Uint8Array([1, 0]))).toBe(256n);
  });

  it('derives the Associated Token Account without an SDK (real mainnet vector)', async () => {
    expect(isOnCurve(base58Decode(WALLET))).toBe(true); // every wallet address is an Ed25519 point
    expect(isOnCurve(base58Decode(SOLANA.tokenProgram))).toBe(true);
    expect(isOnCurve(base58Decode(POOL_USDC))).toBe(false); // a PDA never is
    expect(await deriveAssociatedTokenAccount(WALLET, USDC)).toBe(POOL_USDC);
  });
});

describe('goal configuration', () => {
  it('is off by default and never shows a way to contribute', async () => {
    const { status, body } = await json<{ enabled: boolean; round: unknown; progress: number; pool: { wallet: string | null } }>('/api/v1/goal');
    expect(status).toBe(200);
    expect(body.enabled).toBe(false);
    expect(body.round).toBeNull();
    expect(body.pool.wallet).toBeNull();
    expect(body.progress).toBe(0);
    const html = await (await request('/')).text();
    expect(html).toContain('Not open yet');
    expect(html).not.toContain('data-role="goal-contribute"');
    expect(html).not.toContain('src="/goal.js"');
    const tx = await json<{ code: string }>('/api/v1/goal/tx', { method: 'POST', body: JSON.stringify({ from: A, amount: 5 }), headers: { 'content-type': 'application/json' } });
    expect(tx.status).toBe(409);
    expect(tx.body.code).toBe('goal_not_open');
  });

  it('requires a Solana wallet and its USDC account before going live, and always excludes the operator', () => {
    expect(goalConfig({ GOAL_ENABLED: 'true' }).live).toBe(false);
    expect(goalConfig({ GOAL_ENABLED: 'true', GOAL_WALLET: '0xnotsolana', GOAL_USDC_ACCOUNT: POOL_USDC }).live).toBe(false);
    const ok = goalConfig(LIVE as never);
    expect(ok.live).toBe(true);
    expect(ok.rpcUrl).toBe(SOLANA.rpc);
    expect(goalConfig({ ...LIVE, GOAL_SOLANA_RPC: SOLANA.rpc, GOAL_SOLANA_RPC_PRIVATE: 'https://rpc.example/key' } as never).rpcUrl).toBe(`https://rpc.example/key,${SOLANA.rpc}/`); // the keyed endpoint goes first; URLs are normalized
    expect(ok.usdcMint).toBe(USDC);
    expect(ok.excludedWallets).toEqual([WALLET]);
    expect(goalConfig({ ...LIVE, GOAL_EXCLUDED_WALLETS: `${A}, bogus` } as never).excludedWallets).toEqual([A, WALLET]);
  });
});

describe('transfer message', () => {
  it('serializes a legacy message with compute budget + TransferChecked that Phantom can sign', () => {
    const units = 5_000_000n;
    const msg = buildTransferMessage({ payer: A, source: B, destination: POOL_USDC, mint: USDC, units, decimals: 6, blockhash: hash32(9) });
    expect([msg[0], msg[1], msg[2]]).toEqual([1, 0, 3]); // one writable signer, three readonly unsigned
    expect(msg[3]).toBe(6); // account keys
    const keys = Array.from({ length: 6 }, (_, i) => base58Encode(msg.slice(4 + 32 * i, 36 + 32 * i)));
    expect(keys).toEqual([A, B, POOL_USDC, USDC, SOLANA.tokenProgram, SOLANA.computeBudgetProgram]);
    let o = 4 + 32 * 6;
    expect(base58Encode(msg.slice(o, o + 32))).toBe(hash32(9));
    o += 32;
    expect(msg[o++]).toBe(3); // instructions
    // set compute unit limit
    expect(msg[o]).toBe(5); // program index (compute budget)
    expect(msg[o + 1]).toBe(0); // no accounts
    expect(msg[o + 2]).toBe(5); // data length
    expect(msg[o + 3]).toBe(2); // SetComputeUnitLimit
    o += 3 + 5;
    // set compute unit price
    expect(msg[o]).toBe(5);
    expect(msg[o + 2]).toBe(9);
    expect(msg[o + 3]).toBe(3); // SetComputeUnitPrice
    o += 3 + 9;
    // transfer checked
    expect(msg[o]).toBe(4); // token program index
    expect(msg[o + 1]).toBe(4); // accounts: source, mint, destination, owner
    expect(Array.from(msg.slice(o + 2, o + 6))).toEqual([1, 3, 2, 0]);
    expect(msg[o + 6]).toBe(10); // data: tag + u64 + decimals
    expect(msg[o + 7]).toBe(12); // TransferChecked
    const amount = Array.from(msg.slice(o + 8, o + 16)).reduce((n, b, i) => n + BigInt(b) * (1n << BigInt(8 * i)), 0n);
    expect(amount).toBe(units);
    expect(msg[o + 16]).toBe(6);
    expect(msg).toHaveLength(o + 17);
    expect(PRIORITY_FEE_LAMPORTS).toBe(1000);
  });

  it('reads the sender and amount of a contribution from a parsed transaction, including swaps', () => {
    const direct = parseContribution(parsedTx({ signature: sig(1), slot: 10, from: A, units: 2_500_000n }), POOL_USDC)!;
    expect(direct).toMatchObject({ signature: sig(1), wallet: A, units: 2_500_000n, slot: 10 });
    const swap = parseContribution(parsedTx({ signature: sig(2), slot: 11, from: B, units: 1_000_000n, viaProgram: true }), POOL_USDC)!;
    expect(swap.wallet).toBe(B); // fee payer when no parsed transfer names an authority
    expect(parseContribution(parsedTx({ signature: sig(3), slot: 12, from: A, units: 1_000_000n, err: true }), POOL_USDC)).toBeNull();
    expect(parseContribution(parsedTx({ signature: sig(4), slot: 13, from: A, units: 0n }), POOL_USDC)).toBeNull();
    expect(parseContribution(parsedTx({ signature: sig(5), slot: 14, from: A, units: 1n }), 'SomeOtherAccount1111111111111111111111111111')).toBeNull();
  });
});

describe('rounds', () => {
  it('picks the winner deterministically from the block hash', () => {
    expect(pickWinnerIndex(hash32(11), 10)).toBe(1);
    expect(pickWinnerIndex(hash32(11), 11)).toBe(0);
    expect(() => pickWinnerIndex(hash32(1), 0)).toThrow();
    expect(() => pickWinnerIndex(WALLET.slice(0, 20), 3)).toThrow();
  });

  it('runs a full automatic round: open → sync → freeze at target → draw → paid → next round adopts late contributions', async () => {
    const c = chain();
    const rpc = fakeRpc(c);
    const now = new Date('2026-09-18T12:00:00Z');

    // First tick: the scan starts from the newest existing signature (old transfers never count) and opens round 1.
    const t1 = await tickGoal(live(), rpc, now);
    expect(t1.sync.started).toBe(true);
    expect(t1.action).toBe('opened');
    const r1 = (await currentRound(db()))!;
    expect(r1.status).toBe('open');
    expect(await qualifyingEntries(db(), r1.id)).toEqual([]);

    // Contributions arrive: A twice (one entry), B below the minimum, the operator (excluded), C big.
    c.txs.push(
      { signature: sig(10), slot: 1010, from: A, units: 1_000_000n },
      { signature: sig(11), slot: 1011, from: B, units: 400_000n },
      { signature: sig(12), slot: 1012, from: WALLET, units: 50_000_000n },
      { signature: sig(13), slot: 1013, from: A, units: 4_000_000n },
      { signature: sig(14), slot: 1014, from: 'Zfailed11111111111111111111111111111111111111', units: 9_000_000n, err: true },
    );
    c.slotConfirmed = 1020;
    const t2 = await tickGoal(live(), rpc, now);
    expect(t2.sync).toMatchObject({ scanned: 5, recorded: 4, error: null });
    expect(t2.action).toBe('none');
    const s1 = await goalStatus(live(), now);
    expect(s1.round).toMatchObject({ id: r1.id, status: 'open', raised_usd: 55.4, contributions: 4, contributors: 1 }); // only A qualifies
    expect(s1.progress).toBeCloseTo(0.277, 3);
    const again = await syncContributions(live(), rpc, now);
    expect(again).toMatchObject({ scanned: 0, recorded: 0 }); // cursor advanced; nothing double counted

    // The page shows the sheet and the Phantom fallback while the round is open.
    const html = await (await request('/', {}, LIVE)).text();
    expect(html).toContain('data-role="goal-contribute"');
    expect(html).toContain('id="goal-sheet"');
    expect(html).toContain('data-role="fallback"');
    expect(html).toContain('https://phantom.com/download');
    expect(html).toContain(`data-goal-wallet="${WALLET}"`);
    expect(html).toContain('src="/goal.js"');
    expect(html).toContain('Approve in Phantom'); // handoff strings for goal.js
    expect(html).not.toContain('nacl-fast'); // loaded on demand, only on the phone handoff path
    expect(html).toMatch(/data-role="goal-entries">1<\/span> contributors/);
    expect(html).not.toContain('USDG');
    expect(html).not.toContain('Robinhood');
    expect((await request('/', {}, LIVE)).headers.get('content-security-policy')).toContain("connect-src 'self';");

    // C pushes the round over the target → frozen with a draw slot about a minute ahead.
    c.txs.push({ signature: sig(15), slot: 1030, from: C, units: 150_000_000n });
    c.slotConfirmed = 1040;
    const t3 = await tickGoal(live(), rpc, new Date(now.getTime() + 60_000));
    expect(t3.action).toBe('frozen');
    const frozen = (await currentRound(db()))!;
    expect(frozen.status).toBe('frozen');
    expect(frozen.freeze_slot).toBe(1040);
    expect(frozen.draw_slot).toBe(1040 + SOLANA.drawLeadSlots);
    const frozenHtml = await (await request('/', {}, LIVE)).text();
    expect(frozenHtml).toContain('Entries closed');
    expect(frozenHtml).not.toContain('data-role="goal-contribute"');
    const closedTx = await json<{ code: string }>('/api/v1/goal/tx', { method: 'POST', body: JSON.stringify({ from: A, amount: 5 }), headers: { 'content-type': 'application/json' } }, LIVE);
    expect(closedTx.body.code).toBe('round_closed');

    // A contribution while frozen waits for the next round.
    c.txs.push({ signature: sig(16), slot: 1050, from: B, units: 2_000_000n });
    c.slotFinalized = 1100; // draw slot not finalized yet
    const t4 = await tickGoal(live(), rpc, new Date(now.getTime() + 120_000));
    expect(t4.sync.recorded).toBe(1);
    expect(t4.action).toBe('waiting');
    expect((await db().prepare('SELECT round_id FROM goal_contributions WHERE signature = ?1').bind(sig(16)).first<{ round_id: number | null }>())?.round_id).toBeNull();

    // Draw: the announced slot was skipped; the first finalized block after it decides. hash…01 mod 2 → index 1 → C (A first, C second).
    const drawSlot = frozen.draw_slot!;
    c.blocks[drawSlot + 2] = hash32(1);
    c.blocks[drawSlot + 3] = hash32(200);
    c.slotFinalized = drawSlot + 50;
    const t5 = await tickGoal(live(), rpc, new Date(now.getTime() + 180_000));
    expect(t5.action).toBe('drawn');
    const drawn = (await currentRound(db()))!;
    expect(drawn.status).toBe('drawn');
    expect(drawn.draw_block).toBe(drawSlot + 2);
    expect(drawn.draw_hash).toBe(hash32(1));
    expect(drawn.entries).toBe(2);
    expect(drawn.winner_index).toBe(1);
    expect(drawn.winner_wallet).toBe(C);
    const list = await json<{ contributors: Array<{ index: number; wallet: string; usdc: number }>; winner_index: number }>('/api/v1/goal/contributors', {}, LIVE);
    expect(list.body.contributors).toEqual([
      { index: 0, wallet: A, usdc: 5, first_slot: 1010 },
      { index: 1, wallet: C, usdc: 150, first_slot: 1030 },
    ]);
    expect(list.body.winner_index).toBe(1);
    const t6 = await tickGoal(live(), rpc, new Date(now.getTime() + 240_000));
    expect(t6.action).toBe('awaiting_payout');
    const page = await (await request('/goal', {}, LIVE)).text();
    expect(page).toContain(`Round ${drawn.id} draw`);
    expect(page).toContain(hash32(1));
    expect(page).toContain(`/block/${drawSlot + 2}`);
    expect(page).toContain('id="roadmap"');
    expect(page).toContain('What you are trusting');
    expect(page).not.toContain('tokenomics');

    // Operator pays by hand and records the signature; the next tick opens round 2 with B's waiting contribution.
    const badTx = await json<{ code: string }>('/admin/goal/rounds', adminInit({ action: 'paid', tx: '0xabc' }), LIVE);
    expect(badTx.status).toBe(400);
    const paid = await json<{ ok: boolean; winner: string }>('/admin/goal/rounds', adminInit({ action: 'paid', tx: sig(99) }), LIVE);
    expect(paid.status).toBe(200);
    expect(paid.body.winner).toBe(C);
    expect(await currentRound(db())).toBeNull();
    const t7 = await tickGoal(live(), rpc, new Date(now.getTime() + 300_000));
    expect(t7.action).toBe('opened');
    const r2 = (await currentRound(db()))!;
    expect(r2.id).toBe(drawn.id + 1);
    const s2 = await goalStatus(live(), new Date(now.getTime() + 300_000));
    expect(s2.round).toMatchObject({ id: r2.id, status: 'open', raised_usd: 2, contributors: 1 });
    expect(s2.past_rounds[0]).toMatchObject({ id: drawn.id, status: 'paid', raised_usd: 205.4, winner_wallet: C, payout_tx: sig(99) });
    const home = await (await request('/', {}, LIVE)).text();
    expect(home).toContain('2 of 200 USDC raised');
  });

  it('keeps the cursor on the last processed signature when the RPC fails mid-scan, and reports stale', async () => {
    const c = chain();
    const rpc = fakeRpc(c);
    const now = new Date('2026-09-18T12:00:00Z');
    await tickGoal(live(), rpc, now);
    c.txs.push({ signature: sig(20), slot: 1001, from: A, units: 1_000_000n }, { signature: sig(21), slot: 1002, from: B, units: 1_000_000n });
    let failOn = sig(21);
    const flaky = (async (url: unknown, init?: RequestInit) => {
      const req = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
      if (req.method === 'getTransaction' && req.params[0] === failOn) return new Response('boom', { status: 503 });
      return rpc(url as string, init);
    }) as typeof fetch;
    const s = await syncContributions(live(), flaky, now);
    expect(s.recorded).toBe(1);
    expect(s.error).toMatch(/http 503/);
    const status = await goalStatus(live(), now);
    expect(status.sync.stale).toBe(true);
    failOn = '';
    const s2 = await syncContributions(live(), rpc, new Date(now.getTime() + 60_000));
    expect(s2).toMatchObject({ scanned: 1, recorded: 1, error: null });
    expect((await goalStatus(live(), new Date(now.getTime() + 60_000))).sync.stale).toBe(false);
  });

  it('never ingests history: a failed first run stays a first run, a successful one starts at the newest signature', async () => {
    const c = chain();
    c.txs.push({ signature: sig(50), slot: 600, from: A, units: 40_000_000n }); // an old transfer from before the goal
    const now = new Date('2026-09-18T12:00:00Z');
    const down = (async () => new Response('down', { status: 503 })) as typeof fetch;
    const failed = await syncContributions(live(), down, now);
    expect(failed.error).toMatch(/503/);
    expect(await db().prepare('SELECT COUNT(*) AS n FROM goal_sync').first<{ n: number }>()).toMatchObject({ n: 0 });
    const first = await syncContributions(live(), fakeRpc(c), now);
    expect(first).toMatchObject({ started: true, recorded: 0 });
    expect(c.calls.filter((m) => m === 'getTransaction')).toHaveLength(0);
    const second = await syncContributions(live(), fakeRpc(c), now);
    expect(second).toMatchObject({ started: false, scanned: 0, recorded: 0, error: null });
    expect(await db().prepare('SELECT COUNT(*) AS n FROM goal_contributions').first<{ n: number }>()).toMatchObject({ n: 0 });
  });

  it('cancelling rolls contributions into the next round', async () => {
    const now = new Date('2026-09-18T12:00:00Z');
    const r1 = await openRound(db(), 'r1', 200, now);
    await db().prepare("INSERT INTO goal_contributions (signature, round_id, wallet, amount_units, slot, block_time, created_at) VALUES (?1, ?2, ?3, 1000000, 1, NULL, ?4)").bind(sig(30), r1.id, A, now.toISOString()).run();
    const cancel = await json<{ ok: boolean }>('/admin/goal/rounds', adminInit({ action: 'cancel', note: 'test' }), LIVE);
    expect(cancel.status).toBe(200);
    expect((await latestRound(db()))?.status).toBe('cancelled');
    const r2 = await openRound(db(), 'r2', 200, now);
    expect(await qualifyingEntries(db(), r2.id, MIN_CONTRIBUTION_UNITS)).toHaveLength(1);
  });

  it('refuses admin actions without the token', async () => {
    expect((await request('/admin/goal/rounds', { method: 'POST', body: '{"action":"tick"}', headers: { 'content-type': 'application/json' } })).status).toBe(401);
  });
});

describe('contribution endpoints', () => {
  it('builds a transfer for a wallet that holds USDC and SOL, and refuses otherwise', async () => {
    const c = chain();
    const ataA = await deriveAssociatedTokenAccount(A, USDC);
    const ataC = await deriveAssociatedTokenAccount(C, USDC);
    c.accounts[ataA] = { owner: A, mint: USDC, amount: 20_000_000n };
    c.lamports[A] = 5_000_000;
    c.accounts[ataC] = { owner: C, mint: USDC, amount: 20_000_000n };
    c.lamports[C] = 100;
    // The Worker calls the real `fetch`; route it to the fake for this test.
    const realFetch = globalThis.fetch;
    globalThis.fetch = fakeRpc(c);
    try {
      await openRound(db(), 'r', 200, new Date());
      const post = (body: unknown) => json<Record<string, unknown>>('/api/v1/goal/tx', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }, LIVE);
      const ok = await post({ from: A, amount: 5 });
      expect(ok.status).toBe(200);
      expect(ok.body.source).toBe(ataA); // the contributor's Associated Token Account
      expect(ok.body.destination).toBe(POOL_USDC);
      expect(ok.body.units).toBe('5000000');
      expect(ok.body.fee_lamports).toBe(6000);
      const msg = base58Decode(ok.body.message as string);
      expect(msg[0]).toBe(1);
      expect(base58Encode(msg.slice(4, 36))).toBe(A);
      expect((await post({ from: A, amount: 25 })).body.code).toBe('insufficient');
      expect((await post({ from: A, amount: 0.5 })).body.code).toBe('invalid_amount');
      expect((await post({ from: 'nope', amount: 5 })).body.code).toBe('invalid_wallet');
      expect((await post({ from: B, amount: 5 })).body.code).toBe('no_usdc');
      expect((await post({ from: C, amount: 5 })).body.code).toBe('no_sol');
      expect((await post({ from: WALLET, amount: 5 })).body.code).toBe('operator_wallet');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('relays a signed transaction from the Phantom deeplink handoff and refuses anything that is not a signed transfer to the pool', async () => {
    const c = chain();
    const realFetch = globalThis.fetch;
    globalThis.fetch = fakeRpc(c);
    try {
      await openRound(db(), 'r', 200, new Date());
      const post = (body: unknown) => json<Record<string, unknown>>('/api/v1/goal/submit', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }, LIVE);
      const ataA = await deriveAssociatedTokenAccount(A, USDC);
      const message = buildTransferMessage({ payer: A, source: ataA, destination: POOL_USDC, mint: USDC, units: 5_000_000n, decimals: 6, blockhash: hash32(9) });
      // What the page sends Phantom: one empty signature slot, then the message.
      const unsigned = unsignedTransaction(message);
      expect(unsigned[0]).toBe(1);
      expect(unsigned.slice(1, 65).every((b) => b === 0)).toBe(true);
      expect(parseSignedTransaction(unsigned)).toBeNull(); // unsigned is not relayable
      expect(messageHasAccount(message, POOL_USDC)).toBe(true);
      expect(messageHasAccount(message, B)).toBe(false);
      // What Phantom hands back: the same bytes with the fee payer's signature filled in.
      const signed = new Uint8Array(unsigned);
      signed.set(base58Decode(sig(77)), 1);
      expect(parseSignedTransaction(signed)).toMatchObject({ signature: sig(77) });
      const ok = await post({ transaction: base58Encode(signed) });
      expect(ok.status).toBe(200);
      expect(ok.body.signature).toBe(sig(77));
      expect(c.sent).toHaveLength(1);
      expect(c.sent![0]).toBe(btoa(String.fromCharCode(...signed)));

      expect((await post({ transaction: base58Encode(unsigned) })).body.code).toBe('invalid_transaction');
      expect((await post({ transaction: 'not base58 0OIl' })).body.code).toBe('invalid_transaction');
      expect((await post({})).body.code).toBe('invalid_transaction');
      const elsewhere = buildTransferMessage({ payer: A, source: ataA, destination: `${B.slice(0, 40)}dest`, mint: USDC, units: 5_000_000n, decimals: 6, blockhash: hash32(9) });
      const signedElsewhere = unsignedTransaction(elsewhere);
      signedElsewhere.set(base58Decode(sig(78)), 1);
      expect((await post({ transaction: base58Encode(signedElsewhere) })).body.code).toBe('not_a_contribution');
      expect(c.sent).toHaveLength(1); // nothing else reached the network

      c.send = { error: 'Transaction simulation failed: Blockhash not found' };
      expect((await post({ transaction: base58Encode(signed) })).body.code).toBe('expired');
      c.send = { error: 'Transaction signature verification failure' };
      expect((await post({ transaction: base58Encode(signed) })).body.code).toBe('failed');
      c.send = { error: 'Transaction simulation failed: custom program error: 0x1 insufficient funds' };
      expect((await post({ transaction: base58Encode(signed) })).body.code).toBe('insufficient');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('verifies a submitted signature on chain, records it once, and answers 202 while pending', async () => {
    const c = chain();
    const realFetch = globalThis.fetch;
    globalThis.fetch = fakeRpc(c);
    try {
      const now = new Date('2026-09-18T12:00:00Z');
      const round = await openRound(db(), 'r', 200, now);
      const post = (body: unknown) => json<Record<string, unknown>>('/api/v1/goal/contributions', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }, LIVE);
      expect((await post({ signature: 'nope' })).body.code).toBe('invalid_signature');
      const pending = await post({ signature: sig(40) });
      expect(pending.status).toBe(202);
      expect(pending.body.status).toBe('pending');
      c.txs.push({ signature: sig(40), slot: 1005, from: A, units: 7_000_000n });
      const confirmed = await post({ signature: sig(40) });
      expect(confirmed.status).toBe(200);
      expect(confirmed.body).toMatchObject({ status: 'confirmed', wallet: A, usdc: 7, counted: true, excluded: false, round: round.id, contributors: 1, contributions: 1, raised_usd: 7, target_usd: 200 });
      const twice = await post({ signature: sig(40) });
      expect(twice.body).toMatchObject({ status: 'confirmed', wallet: A, usdc: 7, counted: true, excluded: false, raised_usd: 7, contributors: 1 }); // same figures when already recorded
      // An operator wallet is told so: on the meter, never in the draw.
      c.txs.push({ signature: sig(43), slot: 1006, from: WALLET, units: 3_000_000n });
      expect((await post({ signature: sig(43) })).body).toMatchObject({ status: 'confirmed', wallet: WALLET, excluded: true, raised_usd: 10, contributions: 2, contributors: 1 });
      expect(await qualifyingEntries(db(), round.id, MIN_CONTRIBUTION_UNITS, [WALLET])).toHaveLength(1);
      c.txs.push({ signature: sig(41), slot: 1006, from: B, units: 1_000_000n, err: true });
      expect((await post({ signature: sig(41) })).body.code).toBe('failed');
      // The cron scan later sees the same signature and does not double count.
      await tickGoal(live(), fakeRpc(c), now); // starts the cursor
      c.txs.push({ signature: sig(42), slot: 1007, from: C, units: 1_000_000n });
      const t = await tickGoal(live(), fakeRpc(c), now);
      expect(t.sync.recorded).toBe(1);
      expect((await goalStatus(live(), now)).round).toMatchObject({ contributions: 3, raised_usd: 11 });
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
