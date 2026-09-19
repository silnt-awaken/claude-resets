// Solana for the community goal, without a Solana SDK: a thin JSON-RPC client, the legacy
// transaction message for a USDC transfer (Phantom signs it in the browser; the site never holds
// keys), and the parser that turns a confirmed transaction into a contribution. Everything the
// site shows (contributions, the draw block hash) is read from the chain so anyone can check it.

import { base58Decode, base58Encode } from './base58';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const SOLANA = {
  name: 'Solana',
  /** Keyless endpoint that serves Cloudflare Workers (the official public RPC blocks the Worker provider outright). */
  rpc: 'https://solana-rpc.publicnode.com',
  explorer: 'https://solscan.io',
  /** Circle's USDC mint on Solana mainnet (6 decimals). */
  usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  usdcDecimals: 6,
  tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  associatedTokenProgram: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  computeBudgetProgram: 'ComputeBudget111111111111111111111111111111',
  /** ~400 ms per slot: 150 slots is about one minute between the freeze and the draw block. */
  drawLeadSlots: 150,
  /** How far past the draw slot we look for the first finalized block (skipped slots have no block). */
  drawSearchSlots: 64,
} as const;

// Priority fee so a contribution lands quickly under load. 20k CU × 50k microlamports = 0.000001 SOL.
const COMPUTE_UNIT_LIMIT = 20_000;
const COMPUTE_UNIT_PRICE_MICROLAMPORTS = 50_000n;

/** `url` may be a comma-separated list; endpoints are tried in order. */
export async function rpc<T = unknown>(fetchFn: FetchLike, url: string, method: string, params: unknown[] = []): Promise<T> {
  const urls = url.split(',').map((u) => u.trim()).filter(Boolean);
  let lastError: unknown = new Error('no rpc url');
  for (const u of urls) {
    try {
      return await rpcOne<T>(fetchFn, u, method, params);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

async function rpcOne<T>(fetchFn: FetchLike, url: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`rpc ${method} http ${res.status}`);
  const body = (await res.json()) as { result?: T; error?: { code: number; message: string } };
  if (body.error) throw new Error(`rpc ${method}: ${body.error.message}`);
  if (body.result === undefined) throw new Error(`rpc ${method}: empty result`);
  return body.result;
}

// ---------- reads ----------

export async function getSlot(fetchFn: FetchLike, url: string, commitment: 'confirmed' | 'finalized'): Promise<number> {
  return rpc<number>(fetchFn, url, 'getSlot', [{ commitment }]);
}

export async function getLatestBlockhash(fetchFn: FetchLike, url: string): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
  const r = await rpc<{ value: { blockhash: string; lastValidBlockHeight: number } }>(fetchFn, url, 'getLatestBlockhash', [{ commitment: 'confirmed' }]);
  return r.value;
}

/** Finalized block hash of the first block at or after `slot` (slots can be skipped). Null while not finalized yet. */
export async function blockHashAtOrAfter(fetchFn: FetchLike, url: string, slot: number, search = SOLANA.drawSearchSlots): Promise<{ slot: number; hash: string } | null> {
  const blocks = await rpc<number[]>(fetchFn, url, 'getBlocks', [slot, slot + search, { commitment: 'finalized' }]);
  const first = blocks.find((b) => b >= slot);
  if (first === undefined) return null;
  const block = await rpc<{ blockhash: string } | null>(fetchFn, url, 'getBlock', [first, { encoding: 'json', transactionDetails: 'none', rewards: false, commitment: 'finalized', maxSupportedTransactionVersion: 0 }]).catch(() => null);
  return block?.blockhash ? { slot: first, hash: block.blockhash } : null;
}

export interface TokenAccount {
  address: string;
  amount: bigint;
}

/**
 * The USDC token account of `owner` that Phantom and every exchange use: the Associated Token Account.
 * Read with getAccountInfo (served by keyless RPCs; the indexed getTokenAccountsByOwner is not).
 * Null when the account does not exist, i.e. the wallet never held the token.
 */
export async function associatedTokenAccount(fetchFn: FetchLike, url: string, owner: string, mint: string): Promise<TokenAccount | null> {
  const address = await deriveAssociatedTokenAccount(owner, mint);
  const r = await rpc<{ value: { data: { parsed?: { type: string; info: { mint: string; owner: string; tokenAmount: { amount: string } } } } } | null }>(fetchFn, url, 'getAccountInfo', [address, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
  const info = r.value?.data.parsed?.info;
  if (!info || info.mint !== mint || info.owner !== owner) return null;
  return { address, amount: BigInt(info.tokenAmount.amount) };
}

// ---------- program derived addresses (no SDK) ----------

const P = (1n << 255n) - 19n;
const ED25519_D = mod(-121665n * modInverse(121666n));

function mod(n: bigint): bigint {
  const r = n % P;
  return r < 0n ? r + P : r;
}

function modPow(base: bigint, exp: bigint): bigint {
  let result = 1n;
  let b = mod(base);
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % P;
    b = (b * b) % P;
    e >>= 1n;
  }
  return result;
}

function modInverse(n: bigint): bigint {
  return modPow(n, P - 2n);
}

/** Can these 32 bytes be decompressed as an Ed25519 point? (A PDA must NOT be on the curve.) */
export function isOnCurve(bytes: Uint8Array): boolean {
  let y = 0n;
  for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(bytes[i]!);
  y = mod(y & ((1n << 255n) - 1n));
  const y2 = (y * y) % P;
  const u = mod(y2 - 1n);
  if (u === 0n) return true;
  const v = mod(ED25519_D * y2 + 1n);
  return modPow(mod(u * modInverse(v)), (P - 1n) / 2n) === 1n;
}

async function sha256(parts: Uint8Array[]): Promise<Uint8Array> {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    buf.set(p, o);
    o += p.length;
  }
  return new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
}

/** findProgramAddress: the first bump (255 downwards) whose hash is not an Ed25519 point. */
export async function findProgramAddress(seeds: Uint8Array[], programId: string): Promise<string> {
  const program = base58Decode(programId);
  const marker = new TextEncoder().encode('ProgramDerivedAddress');
  for (let bump = 255; bump >= 0; bump--) {
    const hash = await sha256([...seeds, new Uint8Array([bump]), program, marker]);
    if (!isOnCurve(hash)) return base58Encode(hash);
  }
  throw new Error('no viable program address');
}

/** Associated Token Account: PDA of [owner, token program, mint] under the associated-token program. */
export async function deriveAssociatedTokenAccount(owner: string, mint: string): Promise<string> {
  return findProgramAddress([base58Decode(owner), base58Decode(SOLANA.tokenProgram), base58Decode(mint)], SOLANA.associatedTokenProgram);
}

export async function lamports(fetchFn: FetchLike, url: string, address: string): Promise<bigint> {
  const r = await rpc<{ value: number }>(fetchFn, url, 'getBalance', [address, { commitment: 'confirmed' }]);
  return BigInt(r.value);
}

export interface SignatureInfo {
  signature: string;
  slot: number;
  err: unknown | null;
  blockTime: number | null;
}

/** Confirmed signatures touching `address`, newest first, newer than `until` (exclusive). Pages through up to `maxPages`. */
export async function signaturesSince(fetchFn: FetchLike, url: string, address: string, until: string | null, maxPages = 5, limit = 200): Promise<SignatureInfo[]> {
  const out: SignatureInfo[] = [];
  let before: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const opts: Record<string, unknown> = { limit, commitment: 'confirmed' };
    if (until) opts.until = until;
    if (before) opts.before = before;
    const batch = await rpc<SignatureInfo[]>(fetchFn, url, 'getSignaturesForAddress', [address, opts]);
    out.push(...batch);
    if (batch.length < limit) break;
    before = batch[batch.length - 1]!.signature;
  }
  return out;
}

/** The parts of a `jsonParsed` transaction we read. */
export interface ParsedTransaction {
  slot: number;
  blockTime: number | null;
  meta: {
    err: unknown | null;
    preTokenBalances?: Array<{ accountIndex: number; mint: string; uiTokenAmount: { amount: string } }>;
    postTokenBalances?: Array<{ accountIndex: number; mint: string; uiTokenAmount: { amount: string } }>;
    innerInstructions?: Array<{ index: number; instructions: ParsedInstruction[] }>;
  } | null;
  transaction: {
    signatures: string[];
    message: { accountKeys: Array<{ pubkey: string; signer: boolean }>; instructions: ParsedInstruction[] };
  };
}

export interface ParsedInstruction {
  program?: string;
  programId: string;
  parsed?: { type: string; info: Record<string, string | undefined> };
}

export async function getTransaction(fetchFn: FetchLike, url: string, signature: string): Promise<ParsedTransaction | null> {
  return rpc<ParsedTransaction | null>(fetchFn, url, 'getTransaction', [signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]).catch((err: unknown) => {
    if (err instanceof Error && /empty result/.test(err.message)) return null;
    throw err;
  });
}

export interface Contribution {
  signature: string;
  wallet: string; // sender (the owner who signed the transfer, or the fee payer as a fallback)
  units: bigint; // USDC base units (6 decimals) received by the pool's token account
  slot: number;
  blockTime: number | null;
}

/**
 * A contribution is a successful transaction that increased the pool's USDC account balance.
 * The amount comes from pre/post token balances (so swaps and multi-transfer transactions count
 * correctly); the sender is the authority of the SPL transfer into our account, or the fee payer.
 */
export function parseContribution(tx: ParsedTransaction, usdcAccount: string): Contribution | null {
  if (!tx.meta || tx.meta.err) return null;
  const keys = tx.transaction.message.accountKeys;
  const index = keys.findIndex((k) => k.pubkey === usdcAccount);
  if (index < 0) return null;
  const pre = tx.meta.preTokenBalances?.find((b) => b.accountIndex === index)?.uiTokenAmount.amount ?? '0';
  const post = tx.meta.postTokenBalances?.find((b) => b.accountIndex === index)?.uiTokenAmount.amount ?? '0';
  const units = BigInt(post) - BigInt(pre);
  if (units <= 0n) return null;
  const all = [...tx.transaction.message.instructions, ...(tx.meta.innerInstructions ?? []).flatMap((i) => i.instructions)];
  const transfer = all.find((i) => i.program === 'spl-token' && (i.parsed?.type === 'transfer' || i.parsed?.type === 'transferChecked') && i.parsed.info.destination === usdcAccount);
  const wallet = transfer?.parsed?.info.authority ?? transfer?.parsed?.info.multisigAuthority ?? keys.find((k) => k.signer)?.pubkey ?? keys[0]?.pubkey;
  if (!wallet) return null;
  return { signature: tx.transaction.signatures[0]!, wallet, units, slot: tx.slot, blockTime: tx.blockTime ?? null };
}

// ---------- the transfer message Phantom signs ----------

function compactU16(n: number): number[] {
  if (n < 0x80) return [n];
  if (n < 0x4000) return [(n & 0x7f) | 0x80, n >> 7];
  return [(n & 0x7f) | 0x80, ((n >> 7) & 0x7f) | 0x80, n >> 14];
}

function u32le(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
}

function u64le(n: bigint): number[] {
  const out: number[] = [];
  for (let i = 0; i < 8; i++) out.push(Number((n >> BigInt(8 * i)) & 0xffn));
  return out;
}

export interface TransferMessageInput {
  payer: string; // the contributor's wallet: fee payer and owner of the source token account
  source: string; // the contributor's USDC token account
  destination: string; // the pool's USDC token account
  mint: string;
  units: bigint;
  decimals: number;
  blockhash: string;
}

/**
 * Legacy Solana message: ComputeBudget limit + price, then SPL Token `TransferChecked`.
 * Account order follows the runtime's rule (writable signers, readonly signers, writable, readonly).
 */
export function buildTransferMessage(input: TransferMessageInput): Uint8Array {
  const keys = [input.payer, input.source, input.destination, input.mint, SOLANA.tokenProgram, SOLANA.computeBudgetProgram];
  const idx = (k: string) => keys.indexOf(k);
  const instructions: Array<{ program: number; accounts: number[]; data: number[] }> = [
    { program: idx(SOLANA.computeBudgetProgram), accounts: [], data: [2, ...u32le(COMPUTE_UNIT_LIMIT)] },
    { program: idx(SOLANA.computeBudgetProgram), accounts: [], data: [3, ...u64le(COMPUTE_UNIT_PRICE_MICROLAMPORTS)] },
    { program: idx(SOLANA.tokenProgram), accounts: [idx(input.source), idx(input.mint), idx(input.destination), idx(input.payer)], data: [12, ...u64le(input.units), input.decimals] },
  ];
  const bytes: number[] = [1, 0, 3]; // 1 signer (payer, writable); 0 readonly signers; 3 readonly unsigned (mint, two programs)
  bytes.push(...compactU16(keys.length));
  for (const k of keys) {
    const b = base58Decode(k);
    if (b.length !== 32) throw new Error(`not a 32-byte key: ${k}`);
    bytes.push(...b);
  }
  const bh = base58Decode(input.blockhash);
  if (bh.length !== 32) throw new Error('blockhash must be 32 bytes');
  bytes.push(...bh);
  bytes.push(...compactU16(instructions.length));
  for (const ix of instructions) {
    bytes.push(ix.program, ...compactU16(ix.accounts.length), ...ix.accounts, ...compactU16(ix.data.length), ...ix.data);
  }
  return new Uint8Array(bytes);
}

/** Priority fee in lamports added by the compute budget instructions above. */
export const PRIORITY_FEE_LAMPORTS = Number((BigInt(COMPUTE_UNIT_LIMIT) * COMPUTE_UNIT_PRICE_MICROLAMPORTS) / 1_000_000n);

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/** Base fee the network charges for the message (null when the RPC cannot price it, e.g. blockhash expired). */
export async function feeForMessage(fetchFn: FetchLike, url: string, message: Uint8Array): Promise<number | null> {
  const r = await rpc<{ value: number | null }>(fetchFn, url, 'getFeeForMessage', [toBase64(message), { commitment: 'confirmed' }]);
  return r.value;
}

// ---------- signed transactions (the Phantom deeplink handoff on phones) ----------

/**
 * A legacy transaction with one empty signature slot in front of the message: what the Phantom
 * `signTransaction` deeplink expects (`transaction.serialize({ requireAllSignatures: false })`).
 */
export function unsignedTransaction(message: Uint8Array): Uint8Array {
  const out = new Uint8Array(1 + 64 + message.length);
  out[0] = 1;
  out.set(message, 65);
  return out;
}

export interface SignedTransaction {
  signature: string; // base58 of the first (fee payer) signature
  message: Uint8Array;
}

/** Split a serialized legacy transaction into its first signature and message; null when it is not one signer plus a message. */
export function parseSignedTransaction(bytes: Uint8Array): SignedTransaction | null {
  if (bytes.length < 1 + 64 + 3 + 1 + 32 + 32 || bytes[0] !== 1) return null;
  const signature = bytes.slice(1, 65);
  if (signature.every((b) => b === 0)) return null;
  return { signature: base58Encode(signature), message: bytes.slice(65) };
}

/** Does the serialized message reference `address` among its account keys? (Every account key is a full 32-byte entry after the 3-byte header and the key count.) */
export function messageHasAccount(message: Uint8Array, address: string): boolean {
  const key = base58Decode(address);
  if (key.length !== 32 || message.length < 4) return false;
  const count = message[3]!;
  if (count >= 0x80) return false; // more than 127 keys is never one of ours
  for (let i = 0; i < count; i++) {
    const at = 4 + i * 32;
    if (at + 32 > message.length) return false;
    let same = true;
    for (let j = 0; j < 32; j++) if (message[at + j] !== key[j]) { same = false; break; }
    if (same) return true;
  }
  return false;
}

/** Broadcast a signed transaction; resolves to its signature as the RPC reports it. */
export async function sendRawTransaction(fetchFn: FetchLike, url: string, bytes: Uint8Array): Promise<string> {
  return rpc<string>(fetchFn, url, 'sendTransaction', [toBase64(bytes), { encoding: 'base64', preflightCommitment: 'confirmed', maxRetries: 3 }]);
}

export { base58Encode, base58Decode };

/** "5.00 USDC" style: base units → decimal string with up to `fraction` digits. */
export function formatUsdc(units: bigint | number, fraction = 2): string {
  const v = BigInt(units);
  const neg = v < 0n;
  const a = neg ? -v : v;
  const whole = a / 1_000_000n;
  const rem = a % 1_000_000n;
  const frac = fraction > 0 ? rem.toString().padStart(6, '0').slice(0, fraction).replace(/0+$/, '') : '';
  return `${neg ? '-' : ''}${whole.toLocaleString('en-US')}${frac ? `.${frac}` : ''}`;
}

/** Shorten an address for display: 6N9a…grBv */
export function shortAddress(a: string): string {
  return a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a;
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
export function __clearSolanaCache(): void {
  cache.clear();
}
