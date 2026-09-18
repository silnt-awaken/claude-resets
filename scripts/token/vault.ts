// npm run token:vault -- deploy [--per-reset 250000] [--per-round 500000]   deploy contracts/BurnVault.sol from the burner wallet
// npm run token:vault -- fund                                                move the burner wallet's whole RESETS balance into the vault
// npm run token:vault -- status                                              vault reserve, burns so far, burner gas
//
// Signs with BURNER_PRIVATE_KEY (env var, or .production-secrets.env). The vault can only send tokens to
// 0x…dEaD: no owner, no withdraw. Run `npm run token:compile -- --contract BurnVault` first.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createPublicClient, createWalletClient, defineChain, formatEther, formatUnits, http, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ROOT, fail, flagString, parseArgs, readWranglerVars } from '../lib';

const { flags, positional } = parseArgs(process.argv.slice(2));
const action = positional[0] ?? 'status';
const vars = readWranglerVars();
const rpc = flagString(flags, 'rpc') ?? vars.GOAL_CHAIN_RPC ?? 'https://rpc.mainnet.chain.robinhood.com';
const token = (flagString(flags, 'token') ?? vars.RESET_TOKEN_ADDRESS) as `0x${string}`;
if (!/^0x[0-9a-fA-F]{40}$/.test(token)) fail('RESET_TOKEN_ADDRESS is not set in wrangler.jsonc (or pass --token)');

function burnerKey(): `0x${string}` {
  let key = process.env.BURNER_PRIVATE_KEY;
  const file = path.join(ROOT, '.production-secrets.env');
  if (!key && existsSync(file)) key = readFileSync(file, 'utf8').match(/^BURNER_PRIVATE_KEY=(0x[0-9a-fA-F]{64})/m)?.[1];
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) fail('BURNER_PRIVATE_KEY not found (env or .production-secrets.env)');
  return key as `0x${string}`;
}

const chain = defineChain({ id: 4663, name: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
const publicClient = createPublicClient({ chain, transport: http(rpc) });
const artifact = JSON.parse(readFileSync(path.join(ROOT, 'build', 'BurnVault.json'), 'utf8')) as { abi: readonly unknown[]; bytecode: `0x${string}` };
const ERC20 = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: '', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'transfer', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
] as const;
const VAULT = [
  { type: 'function', name: 'reserve', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'totalBurned', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'burner', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'resetBurnAmount', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'roundBurnAmount', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
] as const;

if (action === 'deploy') {
  const account = privateKeyToAccount(burnerKey());
  const wallet = createWalletClient({ account, chain, transport: http(rpc) });
  const perReset = parseUnits(flagString(flags, 'per-reset') ?? vars.RESET_BURN_PER_RESET ?? '250000', 18);
  const perRound = parseUnits(flagString(flags, 'per-round') ?? vars.RESET_BURN_PER_ROUND ?? '500000', 18);
  const gas = await publicClient.getBalance({ address: account.address });
  console.log(`Burner ${account.address} · gas ${formatEther(gas)} ETH · per reset ${formatUnits(perReset, 18)} · per round ${formatUnits(perRound, 18)}`);
  if (gas === 0n) fail('Burner has no ETH for gas.');
  const hash = await wallet.deployContract({ abi: artifact.abi as never, bytecode: artifact.bytecode, args: [token, account.address, perReset, perRound] } as never);
  console.log(`Deployment sent: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress || receipt.status !== 'success') fail(`Deployment failed: ${receipt.status}`);
  console.log(`✔ BurnVault at ${receipt.contractAddress}`);
  console.log(`Put in wrangler.jsonc: "RESET_VAULT_ADDRESS": "${receipt.contractAddress}", "RESET_BURN_MODE": "vault"`);
  process.exit(0);
}

const vault = (flagString(flags, 'vault') ?? vars.RESET_VAULT_ADDRESS) as `0x${string}`;
if (!/^0x[0-9a-fA-F]{40}$/.test(vault)) fail('RESET_VAULT_ADDRESS is not set in wrangler.jsonc (or pass --vault)');

if (action === 'fund') {
  const account = privateKeyToAccount(burnerKey());
  const wallet = createWalletClient({ account, chain, transport: http(rpc) });
  const bal = await publicClient.readContract({ address: token, abi: ERC20, functionName: 'balanceOf', args: [account.address] });
  if (bal === 0n) fail('Burner holds no RESETS to move.');
  console.log(`Moving ${formatUnits(bal, 18)} RESETS from ${account.address} into the vault ${vault}`);
  const { request } = await publicClient.simulateContract({ address: token, abi: ERC20, functionName: 'transfer', args: [vault, bal], account });
  const hash = await wallet.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`✔ ${receipt.status}: https://robinhoodchain.blockscout.com/tx/${hash}`);
  process.exit(0);
}

if (action === 'status') {
  const [reserve, burned, burner, perReset, perRound] = await Promise.all([
    publicClient.readContract({ address: vault, abi: VAULT, functionName: 'reserve' }),
    publicClient.readContract({ address: vault, abi: VAULT, functionName: 'totalBurned' }),
    publicClient.readContract({ address: vault, abi: VAULT, functionName: 'burner' }),
    publicClient.readContract({ address: vault, abi: VAULT, functionName: 'resetBurnAmount' }),
    publicClient.readContract({ address: vault, abi: VAULT, functionName: 'roundBurnAmount' }),
  ]);
  const gas = await publicClient.getBalance({ address: burner });
  console.log(`Vault     ${vault}`);
  console.log(`Reserve   ${formatUnits(reserve, 18)} RESETS · burned so far ${formatUnits(burned, 18)}`);
  console.log(`Burner    ${burner} (gas ${formatEther(gas)} ETH) · per reset ${formatUnits(perReset, 18)} · per round ${formatUnits(perRound, 18)}`);
  process.exit(0);
}

fail('action must be deploy, fund or status');
