// npm run token:deploy -- --pool <0xPoolWallet> [--burner <0xBurner>] [--rpc <url>] [--dry-run]
// Deploys RESET to Robinhood Chain from the wallet whose private key is in DEPLOYER_PRIVATE_KEY
// (environment variable only; never stored in this repo). Prints the contract address and the
// exact lines to put in wrangler.jsonc. Run `npm run token:compile` first.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createPublicClient, createWalletClient, defineChain, formatEther, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ROOT, fail, flagString, parseArgs } from '../lib';

const { flags } = parseArgs(process.argv.slice(2));
const pool = flagString(flags, 'pool') ?? fail('--pool <0x address of the goal pool wallet> is required');
if (!/^0x[0-9a-fA-F]{40}$/.test(pool)) fail('--pool must be a 0x address');
const burnerFlag = flagString(flags, 'burner') ?? '0x0000000000000000000000000000000000000000'; // set later with `npm run token:burner -- set`
if (!/^0x[0-9a-fA-F]{40}$/.test(burnerFlag)) fail('--burner must be a 0x address');
const rpc = flagString(flags, 'rpc') ?? 'https://rpc.mainnet.chain.robinhood.com';
const key = process.env.DEPLOYER_PRIVATE_KEY;
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) fail('Set DEPLOYER_PRIVATE_KEY (0x-prefixed, 64 hex chars) in your shell for this command only.');

const artifact = JSON.parse(readFileSync(path.join(ROOT, 'build', 'ResetToken.json'), 'utf8')) as { abi: readonly unknown[]; bytecode: `0x${string}` };
const chain = defineChain({ id: 4663, name: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpc] } }, blockExplorers: { default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' } } });
const account = privateKeyToAccount(key as `0x${string}`);
const publicClient = createPublicClient({ chain, transport: http(rpc) });
const wallet = createWalletClient({ account, chain, transport: http(rpc) });

const chainId = await publicClient.getChainId();
if (chainId !== 4663) fail(`RPC reports chain id ${chainId}, expected 4663 (Robinhood Chain)`);
const balance = await publicClient.getBalance({ address: account.address });
console.log(`Deployer ${account.address} · balance ${formatEther(balance)} ETH on chain ${chainId}`);
const gas = await publicClient.estimateContractGas({ abi: artifact.abi as never, bytecode: artifact.bytecode, args: [pool, burnerFlag], account: account.address } as never).catch(() => null);
console.log(`Estimated deployment gas: ${gas ?? 'unknown'}`);
if (flags['dry-run'] === true) {
  console.log('Dry run: nothing sent.');
  process.exit(0);
}
if (balance === 0n) fail('Deployer has no ETH for gas. Bridge a little ETH to Robinhood Chain first.');

const hash = await wallet.deployContract({ abi: artifact.abi as never, bytecode: artifact.bytecode, args: [pool, burnerFlag] } as never);
console.log(`Deployment sent: ${hash}`);
const receipt = await publicClient.waitForTransactionReceipt({ hash });
if (!receipt.contractAddress) fail('No contract address in receipt');
console.log(`✔ RESET deployed at ${receipt.contractAddress}`);
console.log(`\nPut this in wrangler.jsonc vars and redeploy the site:\n  "RESET_TOKEN_ADDRESS": "${receipt.contractAddress}",\n  "GOAL_POOL_ADDRESS": "${pool}",\n  "GOAL_ENABLED": "true",`);
console.log(`\nThen verify the source on https://robinhoodchain.blockscout.com/address/${receipt.contractAddress} (upload contracts/ResetToken.sol, solc 0.8.x, optimizer 200, evm paris).`);
console.log(`Burner: ${burnerFlag === '0x0000000000000000000000000000000000000000' ? 'not set yet; run `npm run token:burner -- new` then `npm run token:burner -- set --address 0x…`' : burnerFlag}`);
console.log('Next: add liquidity, mark the LP pair and treasury fee-exempt (setFeeExempt), then renounceOwnership when you are done configuring.');
