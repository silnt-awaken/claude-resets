// npm run token:compile — compiles contracts/ResetToken.sol with solc and writes build/ResetToken.json
// (abi + bytecode). No network access.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import solc from 'solc';
import { ROOT } from '../lib';

const source = readFileSync(path.join(ROOT, 'contracts', 'ResetToken.sol'), 'utf8');
const input = {
  language: 'Solidity',
  sources: { 'ResetToken.sol': { content: source } },
  settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'metadata'] } } },
};
const output = JSON.parse(solc.compile(JSON.stringify(input))) as { errors?: Array<{ severity: string; formattedMessage: string }>; contracts: Record<string, Record<string, { abi: unknown; evm: { bytecode: { object: string } }; metadata: string }>> };
const errors = (output.errors ?? []).filter((e) => e.severity === 'error');
for (const e of output.errors ?? []) console[e.severity === 'error' ? 'error' : 'warn'](e.formattedMessage);
if (errors.length) process.exit(1);
const contract = output.contracts['ResetToken.sol']!['ResetToken']!;
mkdirSync(path.join(ROOT, 'build'), { recursive: true });
writeFileSync(path.join(ROOT, 'build', 'ResetToken.json'), JSON.stringify({ abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}`, metadata: contract.metadata, compiledAt: new Date().toISOString() }, null, 2));
console.log(`✔ compiled ResetToken (${contract.evm.bytecode.object.length / 2} bytes) → build/ResetToken.json`);
