// Automatic RESET burns. Publishing a confirmed reset (or marking a goal round paid) queues one
// row in `token_burns`; the cron drain signs `burnForReset(eventId)` / `burnForRound(roundId)`
// with the burner wallet (BURNER_PRIVATE_KEY secret) and follows the receipt. The burner wallet
// can only trigger the contract's fixed, once-per-id, rate-limited reserve burns; it holds no
// tokens and cannot move any. Everything here is idempotent: a burn is queued once per id, sent
// once, and the contract itself refuses a second burn for the same id.

import { createPublicClient, createWalletClient, defineChain, encodeFunctionData, http, keccak256, stringToBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { GoalConfig } from '../config';
import { siteConfig, type Env } from '../env';
import { hexToBigInt, rpc, type FetchLike } from './chain';
import { BURN_ADDRESSES, erc20Balance, erc20Decimals } from './chain';
import { RESET_TOKEN_ABI } from './token-abi';

const ERC20_ABI = [
  { type: 'function', name: 'transfer', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
] as const;
const DEAD = BURN_ADDRESSES[0] as `0x${string}`;

export type BurnKind = 'reset' | 'round';
export type BurnStatus = 'queued' | 'sent' | 'confirmed' | 'failed';

export interface TokenBurn {
  id: number;
  kind: BurnKind;
  ref: string;
  status: BurnStatus;
  tx_hash: string | null;
  block: number | null;
  attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
  confirmed_at: string | null;
}

export const MAX_BURN_ATTEMPTS = 12;

/** Queue a burn once per (kind, ref). Returns true when a new row was created. */
export async function queueBurn(db: D1Database, kind: BurnKind, ref: string, now: Date): Promise<boolean> {
  const r = await db.prepare('INSERT OR IGNORE INTO token_burns (kind, ref, status, next_attempt_at, created_at) VALUES (?1, ?2, ?3, ?4, ?4)').bind(kind, ref, 'queued', now.toISOString()).run();
  return (r.meta.changes ?? 0) > 0;
}

export async function listBurns(db: D1Database, limit = 50): Promise<TokenBurn[]> {
  const r = await db.prepare('SELECT * FROM token_burns ORDER BY id DESC LIMIT ?1').bind(limit).all<TokenBurn>();
  return r.results ?? [];
}

export async function burnFor(db: D1Database, kind: BurnKind, ref: string): Promise<TokenBurn | null> {
  return db.prepare('SELECT * FROM token_burns WHERE kind = ?1 AND ref = ?2').bind(kind, ref).first<TokenBurn>();
}

/** Signs and sends the burn transaction. Real implementation uses viem; tests substitute a fake. */
export interface BurnSigner {
  address: string;
  send(kind: BurnKind, ref: string): Promise<string>;
}

export function burnerConfigured(env: Pick<Env, 'BURNER_PRIVATE_KEY'>): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(env.BURNER_PRIVATE_KEY ?? '');
}

export function viemSigner(env: Env, cfg: GoalConfig, fetchFn: FetchLike): BurnSigner | null {
  if (!burnerConfigured(env) || !cfg.tokenAddress) return null;
  const account = privateKeyToAccount(env.BURNER_PRIVATE_KEY as `0x${string}`);
  const chain = defineChain({
    id: cfg.chainId,
    name: 'Robinhood Chain',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
  });
  const transport = http(cfg.rpcUrl, {
    fetchFn: fetchFn as typeof fetch,
    timeout: 15_000,
  });
  const publicClient = createPublicClient({ chain, transport });
  const wallet = createWalletClient({ account, chain, transport });
  const token = cfg.tokenAddress as `0x${string}`;
  return {
    address: account.address,
    async send(kind, ref) {
      if (cfg.burnMode === 'transfer') {
        // Launchpad token: the burner wallet holds the reserve and sends a fixed amount to the dead address.
        const decimals = await erc20Decimals(fetchFn, cfg.rpcUrl, token);
        const amount = BigInt(kind === 'reset' ? cfg.burnPerReset : cfg.burnPerRound) * 10n ** BigInt(decimals);
        const balance = await erc20Balance(fetchFn, cfg.rpcUrl, token, account.address);
        if (balance < amount) throw new Error(`reserve empty: burner holds ${balance / 10n ** BigInt(decimals)} RESET, needs ${amount / 10n ** BigInt(decimals)}`);
        const { request } = await publicClient.simulateContract({ address: token, abi: ERC20_ABI, functionName: 'transfer', args: [DEAD, amount], account });
        return wallet.writeContract(request);
      }
      // Own contract: simulate first so a revert reason ('already burned', 'rate limit', 'not burner') is readable.
      if (kind === 'reset') {
        const { request } = await publicClient.simulateContract({ address: token, abi: RESET_TOKEN_ABI, functionName: 'burnForReset', args: [ref], account });
        return wallet.writeContract(request);
      }
      const { request } = await publicClient.simulateContract({ address: token, abi: RESET_TOKEN_ABI, functionName: 'burnForRound', args: [BigInt(ref)], account });
      return wallet.writeContract(request);
    },
  };
}

/** Read-only: has the contract already burned for this id? (Self-heals after a lost tx hash.) */
export async function alreadyBurnedOnChain(fetchFn: FetchLike, cfg: GoalConfig, kind: BurnKind, ref: string): Promise<boolean> {
  if (!cfg.tokenAddress || cfg.burnMode !== 'contract') return false; // a plain transfer leaves no per-id mark; the D1 row is the guard
  const data =
    kind === 'reset'
      ? encodeFunctionData({
          abi: RESET_TOKEN_ABI,
          functionName: 'resetBurned',
          args: [keccak256(stringToBytes(ref))],
        })
      : encodeFunctionData({
          abi: RESET_TOKEN_ABI,
          functionName: 'roundBurned',
          args: [BigInt(ref)],
        });
  const out = await rpc<string>(fetchFn, cfg.rpcUrl, 'eth_call', [{ to: cfg.tokenAddress, data }, 'latest']);
  return hexToBigInt(out) === 1n;
}

export interface DrainBurnsResult {
  sent: number;
  confirmed: number;
  failed: number;
  retried: number;
  skipped: string | null;
}

function backoffMs(attempts: number): number {
  return Math.min(6 * 60 * 60_000, 2 * 60_000 * 2 ** Math.max(0, attempts - 1)); // 2 min → 6 h
}

/**
 * Cron worker: send queued burns, then follow sent ones until a receipt arrives.
 * Never throws; problems land in `last_error` and the admin burn list.
 */
export async function drainBurns(
  env: Env,
  opts: {
    limit?: number;
    fetchFn?: FetchLike;
    signer?: BurnSigner | null;
    now?: Date;
  } = {},
): Promise<DrainBurnsResult> {
  const result: DrainBurnsResult = {
    sent: 0,
    confirmed: 0,
    failed: 0,
    retried: 0,
    skipped: null,
  };
  const cfg = siteConfig(env).goal;
  const fetchFn = opts.fetchFn ?? fetch;
  const now = opts.now ?? new Date();
  const db = env.DB;
  if (!cfg.tokenAddress) {
    result.skipped = 'RESET_TOKEN_ADDRESS not set';
    return result;
  }
  const signer = opts.signer === undefined ? viemSigner(env, cfg, fetchFn) : opts.signer;

  // 1. follow sent transactions
  const sent = await db
    .prepare("SELECT * FROM token_burns WHERE status = 'sent' ORDER BY id LIMIT ?1")
    .bind(opts.limit ?? 20)
    .all<TokenBurn>();
  for (const b of sent.results ?? []) {
    try {
      const receipt = await rpc<{ status: string; blockNumber: string } | null>(fetchFn, cfg.rpcUrl, 'eth_getTransactionReceipt', [b.tx_hash]).catch((err: unknown) => {
        if (err instanceof Error && /empty result/.test(err.message)) return null;
        throw err;
      });
      if (!receipt) {
        // No receipt yet. After a long wait, re-queue; the on-chain check / contract guard prevents a double burn.
        if (b.sent_at && now.getTime() - Date.parse(b.sent_at) > 30 * 60_000) {
          await db.prepare("UPDATE token_burns SET status = 'queued', last_error = 'no receipt after 30 min; re-sending', next_attempt_at = ?1 WHERE id = ?2").bind(now.toISOString(), b.id).run();
          result.retried++;
        }
        continue;
      }
      if (receipt.status === '0x1') {
        await db
          .prepare("UPDATE token_burns SET status = 'confirmed', block = ?1, confirmed_at = ?2, last_error = NULL WHERE id = ?3")
          .bind(Number(hexToBigInt(receipt.blockNumber)), now.toISOString(), b.id)
          .run();
        result.confirmed++;
      } else {
        await db
          .prepare("UPDATE token_burns SET status = 'failed', last_error = 'transaction reverted', block = ?1 WHERE id = ?2")
          .bind(Number(hexToBigInt(receipt.blockNumber)), b.id)
          .run();
        result.failed++;
      }
    } catch (err) {
      console.error('burn receipt check failed', b.id, err instanceof Error ? err.message : err);
    }
  }

  // 2. send queued burns
  const queued = await db
    .prepare("SELECT * FROM token_burns WHERE status = 'queued' AND next_attempt_at <= ?1 ORDER BY id LIMIT ?2")
    .bind(now.toISOString(), opts.limit ?? 20)
    .all<TokenBurn>();
  const rows = queued.results ?? [];
  if (rows.length && !signer) {
    result.skipped = 'BURNER_PRIVATE_KEY not set; burns stay queued';
    return result;
  }
  for (const b of rows) {
    try {
      if (await alreadyBurnedOnChain(fetchFn, cfg, b.kind, b.ref)) {
        await db.prepare("UPDATE token_burns SET status = 'confirmed', confirmed_at = ?1, last_error = 'burned on chain before this row was sent' WHERE id = ?2").bind(now.toISOString(), b.id).run();
        result.confirmed++;
        continue;
      }
      const hash = await signer!.send(b.kind, b.ref);
      await db.prepare("UPDATE token_burns SET status = 'sent', tx_hash = ?1, sent_at = ?2, attempts = attempts + 1, last_error = NULL WHERE id = ?3").bind(hash, now.toISOString(), b.id).run();
      result.sent++;
    } catch (err) {
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 300);
      const attempts = b.attempts + 1;
      const permanent = /already burned|not burner|reserve empty/i.test(message) || attempts >= MAX_BURN_ATTEMPTS;
      await db
        .prepare('UPDATE token_burns SET status = ?1, attempts = ?2, last_error = ?3, next_attempt_at = ?4 WHERE id = ?5')
        .bind(permanent ? 'failed' : 'queued', attempts, message, new Date(now.getTime() + backoffMs(attempts)).toISOString(), b.id)
        .run();
      if (permanent) result.failed++;
      else result.retried++;
      console.error('burn send failed', b.kind, b.ref, message);
    }
  }
  return result;
}
