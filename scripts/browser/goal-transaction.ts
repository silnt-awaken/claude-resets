// Browser-only, loaded on an explicit contribution attempt. No keys, wallet access or network calls.
import { Transaction } from '@solana/web3.js';
import { base58Decode } from '../../src/goal/base58';

export function fromBase58(encoded: string): Transaction {
  const bytes = base58Decode(encoded);
  // The server builds a legacy transfer with one empty fee-payer signature slot.
  if (bytes.length <= 65 || bytes[0] !== 1 || bytes.slice(1, 65).some((byte) => byte !== 0)) throw new Error('Invalid unsigned transfer');
  const tx = Transaction.from(bytes);
  if (tx.signatures.length !== 1 || tx.signatures[0]?.signature !== null) throw new Error('Invalid unsigned transfer');
  return tx;
}

Object.assign(globalThis, { ClaudeGoalTransaction: { fromBase58 } });
