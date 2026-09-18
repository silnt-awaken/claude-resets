// npm run token:burn -- --event <resetEventId> [--amount <RESET>]   burn for a published Claude reset
// npm run token:burn -- --round <roundId> [--amount <RESET>]        burn for a completed goal round
// Signs with DEPLOYER_PRIVATE_KEY (the contract owner). Defaults: 0.25% of initial supply per reset,
// 0.5% per round, matching docs/goal-and-token.md. Prints the transaction hash to link from the site.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createPublicClient, createWalletClient, defineChain, http, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ROOT, fail, flagString, parseArgs, readContent, readWranglerVars } from '../lib';

const { flags } = parseArgs(process.argv.slice(2));
const vars = readWranglerVars();
const token = flagString(flags, 'token') ?? vars.RESET_TOKEN_ADDRESS;
if (!token || !/^0x[0-9a-fA-F]{40}$/.test(token)) fail('RESET_TOKEN_ADDRESS is not set in wrangler.jsonc (or pass --token)');
const rpc = flagString(flags, 'rpc') ?? vars.GOAL_CHAIN_RPC ?? 'https://rpc.mainnet.chain.robinhood.com';
const key = process.env.DEPLOYER_PRIVATE_KEY;
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) fail('Set DEPLOYER_PRIVATE_KEY in your shell for this command only.');

const eventId = flagString(flags, 'event');
const roundId = flagString(flags, 'round');
if (!eventId && !roundId) fail('Pass --event <id> or --round <id>');
if (eventId) {
  const ev = readContent().events.find((e) => e.id === eventId);
  if (!ev) fail(`Unknown event ${eventId}`);
  if (ev.kind !== 'usage_reset' || ev.eventStatus !== 'confirmed' || ev.editorialStatus !== 'published') fail(`${eventId} is not a published confirmed reset; only real resets burn.`);
}
const INITIAL = parseUnits('1000000000', 18);
const amount = flagString(flags, 'amount') ? parseUnits(flagString(flags, 'amount')!, 18) : eventId ? (INITIAL * 25n) / 10_000n : (INITIAL * 50n) / 10_000n;

const artifact = JSON.parse(readFileSync(path.join(ROOT, 'build', 'ResetToken.json'), 'utf8')) as { abi: readonly unknown[] };
const chain = defineChain({ id: 4663, name: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
const account = privateKeyToAccount(key as `0x${string}`);
const publicClient = createPublicClient({ chain, transport: http(rpc) });
const wallet = createWalletClient({ account, chain, transport: http(rpc) });

const args = eventId ? { functionName: 'burnForReset', args: [eventId, amount] } : { functionName: 'burnForRound', args: [BigInt(roundId!), amount] };
console.log(`Burning ${amount / 10n ** 18n} RESET for ${eventId ? `reset ${eventId}` : `round ${roundId}`} from ${account.address}`);
if (flags['dry-run'] === true) {
  await publicClient.simulateContract({ address: token as `0x${string}`, abi: artifact.abi as never, account: account.address, ...args } as never);
  console.log('Dry run: simulation succeeded, nothing sent.');
  process.exit(0);
}
const hash = await wallet.writeContract({ address: token as `0x${string}`, abi: artifact.abi as never, ...args } as never);
console.log(`Sent ${hash}`);
const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log(`✔ ${receipt.status} in block ${receipt.blockNumber}. Link: https://robinhoodchain.blockscout.com/tx/${hash}`);
if (eventId) console.log(`Add to the event's notes in content/resets.json: "RESET burn: https://robinhoodchain.blockscout.com/tx/${hash}"`);
