// Base58 (Bitcoin/Solana alphabet). Solana addresses, signatures and block hashes are base58 strings;
// Phantom takes the serialized transaction message as base58 too. Small inputs only, so BigInt is fine.

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const INDEX = new Map<string, number>([...ALPHABET].map((ch, i) => [ch, i]));

export function base58Encode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  let n = 0n;
  for (let i = zeros; i < bytes.length; i++) n = (n << 8n) | BigInt(bytes[i]!);
  let out = '';
  while (n > 0n) {
    const rem = Number(n % 58n);
    n /= 58n;
    out = ALPHABET[rem] + out;
  }
  return '1'.repeat(zeros) + out;
}

export function base58Decode(text: string): Uint8Array {
  let zeros = 0;
  while (zeros < text.length && text[zeros] === '1') zeros++;
  let n = 0n;
  for (let i = zeros; i < text.length; i++) {
    const v = INDEX.get(text[i]!);
    if (v === undefined) throw new Error(`invalid base58 character ${JSON.stringify(text[i])}`);
    n = n * 58n + BigInt(v);
  }
  const body: number[] = [];
  while (n > 0n) {
    body.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  return new Uint8Array([...new Array<number>(zeros).fill(0), ...body]);
}

/** A Solana public key / account address: base58 of exactly 32 bytes. */
export function isSolanaAddress(value: string | undefined | null): value is string {
  if (!value || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return false;
  try {
    return base58Decode(value).length === 32;
  } catch {
    return false;
  }
}

/** A transaction signature: base58 of exactly 64 bytes. */
export function isSolanaSignature(value: string | undefined | null): value is string {
  if (!value || !/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(value)) return false;
  try {
    return base58Decode(value).length === 64;
  } catch {
    return false;
  }
}

/** Interpret 32 hash bytes as an unsigned big-endian integer (for `hash mod entries`). */
export function bytesToBigInt(bytes: Uint8Array): bigint {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n;
}
