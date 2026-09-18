// npm run token:burner -- new                 generate a fresh burner wallet (prints address + private key once)
// npm run token:burner -- set --address 0x…  point the deployed contract at that burner (signs with DEPLOYER_PRIVATE_KEY)
// npm run token:burner -- status             show the contract's burner, reserve and burn sizes
//
// The burner wallet is what the site uses to trigger reset burns automatically. It can only call
// burnForReset / burnForRound (fixed amounts, once per id, rate-limited); it never holds RESET.
// Store its key as a Worker secret:  npx wrangler secret put BURNER_PRIVATE_KEY
// and send it a little ETH on Robinhood Chain for gas (a few dollars lasts years at L2 fees).

import { createPublicClient, createWalletClient, defineChain, formatEther, formatUnits, http } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { fail, flagString, parseArgs, readWranglerVars } from '../lib';

const ABI = [
  { type: 'function', name: 'burner', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'burnReserve', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'resetBurnAmount', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'roundBurnAmount', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'minBurnInterval', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'setBurner', stateMutability: 'nonpayable', inputs: [{ name: 'newBurner', type: 'address' }], outputs: [] },
] as const;

const { flags, positional } = parseArgs(process.argv.slice(2));
const action = positional[0] ?? 'status';
const vars = readWranglerVars();
const rpc = flagString(flags, 'rpc') ?? vars.GOAL_CHAIN_RPC ?? 'https://rpc.mainnet.chain.robinhood.com';
const chain = defineChain({ id: 4663, name: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
const publicClient = createPublicClient({ chain, transport: http(rpc) });

if (action === 'new') {
  const key = generatePrivateKey();
  const account = privateKeyToAccount(key);
  console.log(`Burner address: ${account.address}`);
  console.log(`Private key:    ${key}`);
  console.log('\nThis key is shown once and stored nowhere. Next:');
  console.log('  1. npx wrangler secret put BURNER_PRIVATE_KEY      (paste the key)');
  console.log(`  2. send ~$3 of ETH on Robinhood Chain to ${account.address} for gas`);
  console.log(`  3. npm run token:burner -- set --address ${account.address}   (after the token is deployed; or pass --burner at deploy)`);
  process.exit(0);
}

const token = flagString(flags, 'token') ?? vars.RESET_TOKEN_ADDRESS;
if (!token || !/^0x[0-9a-fA-F]{40}$/.test(token)) fail('RESET_TOKEN_ADDRESS is not set in wrangler.jsonc (or pass --token)');
const addr = token as `0x${string}`;

if (action === 'status') {
  const [burner, owner, reserve, perReset, perRound, interval] = await Promise.all([
    publicClient.readContract({ address: addr, abi: ABI, functionName: 'burner' }),
    publicClient.readContract({ address: addr, abi: ABI, functionName: 'owner' }),
    publicClient.readContract({ address: addr, abi: ABI, functionName: 'burnReserve' }),
    publicClient.readContract({ address: addr, abi: ABI, functionName: 'resetBurnAmount' }),
    publicClient.readContract({ address: addr, abi: ABI, functionName: 'roundBurnAmount' }),
    publicClient.readContract({ address: addr, abi: ABI, functionName: 'minBurnInterval' }),
  ]);
  const gas = burner !== '0x0000000000000000000000000000000000000000' ? await publicClient.getBalance({ address: burner }) : 0n;
  console.log(`Token      ${addr}`);
  console.log(`Owner      ${owner}`);
  console.log(`Burner     ${burner} (gas: ${formatEther(gas)} ETH)`);
  console.log(`Reserve    ${formatUnits(reserve, 18)} RESET`);
  console.log(`Per reset  ${formatUnits(perReset, 18)} RESET · per round ${formatUnits(perRound, 18)} RESET · min interval ${Number(interval) / 3600} h`);
  process.exit(0);
}

if (action === 'set') {
  const burner = flagString(flags, 'address') ?? fail('--address 0x… is required');
  if (!/^0x[0-9a-fA-F]{40}$/.test(burner)) fail('--address must be a 0x address');
  const key = process.env.DEPLOYER_PRIVATE_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) fail('Set DEPLOYER_PRIVATE_KEY (the contract owner) in your shell for this command only.');
  const account = privateKeyToAccount(key as `0x${string}`);
  const wallet = createWalletClient({ account, chain, transport: http(rpc) });
  const { request } = await publicClient.simulateContract({ address: addr, abi: ABI, functionName: 'setBurner', args: [burner as `0x${string}`], account });
  const hash = await wallet.writeContract(request);
  console.log(`Sent ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`✔ ${receipt.status}: burner is now ${burner}. Link: https://robinhoodchain.blockscout.com/tx/${hash}`);
  process.exit(0);
}

fail('action must be new, set or status');
