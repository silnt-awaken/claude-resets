// npm run token:compile [-- --contract BurnVault] — compiles contracts/<Name>.sol with solc and writes build/<Name>.json
// (abi + bytecode). No network access.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import solc from 'solc';
import { ROOT, flagString, parseArgs } from '../lib';

const NAME = flagString(parseArgs(process.argv.slice(2)).flags, 'contract') ?? 'ResetToken';

const source = readFileSync(path.join(ROOT, 'contracts', `${NAME}.sol`), 'utf8');
const input = {
  language: 'Solidity',
  sources: { [`${NAME}.sol`]: { content: source } },
  settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'metadata'] } } },
};
const output = JSON.parse(solc.compile(JSON.stringify(input))) as { errors?: Array<{ severity: string; formattedMessage: string }>; contracts: Record<string, Record<string, { abi: unknown; evm: { bytecode: { object: string } }; metadata: string }>> };
const errors = (output.errors ?? []).filter((e) => e.severity === 'error');
for (const e of output.errors ?? []) console[e.severity === 'error' ? 'error' : 'warn'](e.formattedMessage);
if (errors.length) process.exit(1);
const contract = output.contracts[`${NAME}.sol`]![NAME]!;
mkdirSync(path.join(ROOT, 'build'), { recursive: true });
writeFileSync(path.join(ROOT, 'build', `${NAME}.json`), JSON.stringify({ abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}`, metadata: contract.metadata, compiledAt: new Date().toISOString() }, null, 2));
console.log(`✔ compiled ${NAME} (${contract.evm.bytecode.object.length / 2} bytes) → build/${NAME}.json`);
