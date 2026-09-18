// Read-only access to Robinhood Chain (any EVM JSON-RPC). No keys, no writes.
// The site never signs anything; all state that matters (pool balance, token supply,
// burns, the draw block hash) is read from the chain so visitors can verify it themselves.

import type { GoalConfig } from '../config';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const SEL = {
  balanceOf: '0x70a08231',
  totalSupply: '0x18160ddd',
  decimals: '0x313ce567',
  symbol: '0x95d89b41',
} as const;

export const BURN_ADDRESSES = ['0x000000000000000000000000000000000000dEaD', '0x0000000000000000000000000000000000000000'] as const;

function pad32(hexNo0x: string): string {
  return hexNo0x.toLowerCase().padStart(64, '0');
}

export async function rpc<T = string>(fetchFn: FetchLike, url: string, method: string, params: unknown[] = []): Promise<T> {
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`rpc ${method} http ${res.status}`);
  const body = (await res.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(`rpc ${method}: ${body.error.message}`);
  if (body.result === undefined) throw new Error(`rpc ${method}: empty result`);
  return body.result;
}

export async function ethCall(fetchFn: FetchLike, url: string, to: string, data: string): Promise<string> {
  return rpc<string>(fetchFn, url, 'eth_call', [{ to, data }, 'latest']);
}

export function hexToBigInt(hex: string): bigint {
  return hex && hex !== '0x' ? BigInt(hex) : 0n;
}

export async function erc20Balance(fetchFn: FetchLike, url: string, token: string, owner: string): Promise<bigint> {
  return hexToBigInt(await ethCall(fetchFn, url, token, SEL.balanceOf + pad32(owner.replace(/^0x/, ''))));
}

export async function erc20TotalSupply(fetchFn: FetchLike, url: string, token: string): Promise<bigint> {
  return hexToBigInt(await ethCall(fetchFn, url, token, SEL.totalSupply));
}

export async function erc20Decimals(fetchFn: FetchLike, url: string, token: string): Promise<number> {
  return Number(hexToBigInt(await ethCall(fetchFn, url, token, SEL.decimals)));
}

export async function blockNumber(fetchFn: FetchLike, url: string): Promise<number> {
  return Number(hexToBigInt(await rpc<string>(fetchFn, url, 'eth_blockNumber')));
}

export async function blockHash(fetchFn: FetchLike, url: string, block: number): Promise<string | null> {
  const b = await rpc<{ hash: string } | null>(fetchFn, url, 'eth_getBlockByNumber', [`0x${block.toString(16)}`, false]);
  return b?.hash ?? null;
}

export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export interface Contribution {
  from: string; // lowercase
  units: bigint; // token base units
  tx: string;
  block: number;
}

/** All ERC-20 transfers INTO `to` between two blocks (inclusive), oldest first. Chunked so public RPCs accept it. */
export async function transfersTo(fetchFn: FetchLike, url: string, token: string, to: string, fromBlock: number, toBlock: number, chunk = 5000): Promise<Contribution[]> {
  const out: Contribution[] = [];
  const topicTo = `0x${pad32(to.replace(/^0x/, ''))}`;
  for (let start = fromBlock; start <= toBlock; start += chunk) {
    const end = Math.min(toBlock, start + chunk - 1);
    const logs = await rpc<Array<{ topics: string[]; data: string; transactionHash: string; blockNumber: string }>>(fetchFn, url, 'eth_getLogs', [
      { address: token, fromBlock: `0x${start.toString(16)}`, toBlock: `0x${end.toString(16)}`, topics: [TRANSFER_TOPIC, null, topicTo] },
    ]);
    for (const l of logs) {
      const from = `0x${(l.topics[1] ?? '').slice(26)}`.toLowerCase();
      out.push({ from, units: hexToBigInt(l.data), tx: l.transactionHash, block: Number(hexToBigInt(l.blockNumber)) });
    }
  }
  return out;
}

export interface ContributorSummary {
  address: string;
  units: bigint;
  firstTx: string;
}

/** Group transfers by sender, keeping only senders at or above the minimum. */
export function summarizeContributors(transfers: Contribution[], minUnits: bigint): ContributorSummary[] {
  const map = new Map<string, ContributorSummary>();
  for (const t of transfers) {
    const prev = map.get(t.from);
    if (prev) prev.units += t.units;
    else map.set(t.from, { address: t.from, units: t.units, firstTx: t.tx });
  }
  return [...map.values()].filter((c) => c.units >= minUnits);
}

export interface PoolSnapshot {
  usdgUnits: bigint; // 6-decimal units
  usd: number;
  ethWei: bigint;
  block: number;
  readAt: string;
}

export async function readPool(cfg: GoalConfig, fetchFn: FetchLike): Promise<PoolSnapshot> {
  if (!cfg.poolAddress || !cfg.usdgAddress) throw new Error('goal pool not configured');
  const [usdgUnits, ethHex, block] = await Promise.all([
    erc20Balance(fetchFn, cfg.rpcUrl, cfg.usdgAddress, cfg.poolAddress),
    rpc<string>(fetchFn, cfg.rpcUrl, 'eth_getBalance', [cfg.poolAddress, 'latest']),
    blockNumber(fetchFn, cfg.rpcUrl),
  ]);
  return { usdgUnits, usd: Number(usdgUnits) / 1e6, ethWei: hexToBigInt(ethHex), block, readAt: new Date().toISOString() };
}

export interface TokenSnapshot {
  address: string;
  decimals: number;
  totalSupply: bigint;
  burned: bigint; // held by burn addresses
  circulating: bigint; // totalSupply - burned
  reserve: bigint | null; // held by the burner wallet, waiting for resets
  readAt: string;
}

export async function readToken(cfg: GoalConfig, fetchFn: FetchLike): Promise<TokenSnapshot> {
  if (!cfg.tokenAddress) throw new Error('token not configured');
  const [decimals, totalSupply, reserve, ...burns] = await Promise.all([
    erc20Decimals(fetchFn, cfg.rpcUrl, cfg.tokenAddress),
    erc20TotalSupply(fetchFn, cfg.rpcUrl, cfg.tokenAddress),
    cfg.vaultAddress ?? cfg.burnerAddress ? erc20Balance(fetchFn, cfg.rpcUrl, cfg.tokenAddress, (cfg.vaultAddress ?? cfg.burnerAddress)!) : Promise.resolve(null),
    ...BURN_ADDRESSES.map((a) => erc20Balance(fetchFn, cfg.rpcUrl, cfg.tokenAddress!, a)),
  ]);
  const burned = burns.reduce((s, b) => s + b, 0n);
  return { address: cfg.tokenAddress, decimals, totalSupply, burned, circulating: totalSupply - burned, reserve, readAt: new Date().toISOString() };
}

/** Format a bigint token amount with the given decimals, at most 2 fractional digits. */
export function formatUnits(value: bigint, decimals: number, fraction = 2): string {
  const neg = value < 0n;
  const v = neg ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const rem = v % base;
  const frac = fraction > 0 ? rem.toString().padStart(decimals, '0').slice(0, fraction).replace(/0+$/, '') : '';
  return `${neg ? '-' : ''}${whole.toLocaleString('en-US')}${frac ? `.${frac}` : ''}`;
}

// ---------- tiny per-isolate cache so pages never hammer the RPC ----------
const cache = new Map<string, { at: number; value: unknown }>();
export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < ttlMs) return hit.value as T;
  const value = await load();
  cache.set(key, { at: now, value });
  return value;
}
export function __clearChainCache(): void {
  cache.clear();
}
