# Community goal and the RESET token

The goal ("Max 20x for a reader") and the RESET token run on **Robinhood Chain** (Arbitrum L2, chain id 4663, ETH gas, RPC `https://rpc.mainnet.chain.robinhood.com`, explorer `https://robinhoodchain.blockscout.com`). Everything is built so that the site only *reads* the chain; all money movement is signed by the owner's own wallet.

## Status

Infrastructure is deployed; the goal is **not open** until `GOAL_ENABLED`, `GOAL_POOL_ADDRESS` and (after deployment) `RESET_TOKEN_ADDRESS` are set. In that state the homepage card and `/goal` show an honest "not open yet" and no fake numbers.

## How a round works

1. **Open a round**: `npm run goal:round -- open --env production --yes` (title and `--target` optional; default $200 = one month of Max 20x).
2. **Readers enter by contributing**: any wallet that sends at least 1 USDG to the pool during the round is one entry, regardless of amount or number of transfers. The open-round contributor count is read live from the USDG transfer log (`eth_getLogs`), cached 60 s.
3. **Meter**: `/api/v1/goal` reads the pool wallet's USDG balance (and ETH, informational) straight from the chain, cached 60 s per isolate. RPC failure shows "stale", never a made-up figure.
4. **Freeze** when the target is reached: `npm run goal:round -- freeze --env production --yes`. Snapshots the contributor set from the chain for `[open_block, current]` into D1, records the current block and announces `drawBlock = current + 600` (≈1 minute at 100 ms blocks; `--blocks` overrides). Refuses if nobody contributed at least the minimum.
5. **Draw** after the draw block exists: `npm run goal:round -- draw --env production --yes`. Winner index = `uint256(blockhash(drawBlock)) mod entries` over entries ordered by id. The hash, block and index are stored and shown publicly.
6. **Pay** $200 USDG from the pool wallet to the winning wallet, then `npm run goal:round -- paid --tx 0x… --env production --yes`.
7. Marking the round paid queues `burnForRound(roundId)` automatically (5,000,000 RESET from the reserve); the cron sends it within two minutes. Then open the next round.

`npm run goal:round -- status` prints the public status JSON. `cancel --note "…"` closes a round without a draw.

## RESET token

Contract: `contracts/ResetToken.sol` (no external dependencies, ~5 KB bytecode). Compile with `npm run token:compile`, deploy with `DEPLOYER_PRIVATE_KEY=0x… npm run token:deploy -- --pool <poolWallet> --burner <burnerWallet>` (use `--dry-run` first). The contract keeps the 15% burn reserve itself; the deployer receives the other 85% and distributes it per the table below.

| Item | Value |
| --- | --- |
| Supply | 1,000,000,000 RESET, 18 decimals, minted once in the constructor; no mint function |
| Liquidity | 40% paired with ETH on Uniswap on Robinhood Chain; LP tokens sent to `0x…dEaD` |
| Contributor rewards | 25%, paid per round pro-rata to USDG contributed (rewards only; odds never change) |
| Burn reserve | 15%, held by the contract. `burnForReset(eventId)` burns 2,500,000 RESET (0.25% of initial supply) per published Claude reset; `burnForRound(roundId)` burns 5,000,000 per completed round. Each id burns once; the burner is rate-limited to one burn per hour. Sizes adjustable by the owner until renounced; anyone can `fundReserve` |
| Treasury | 20%, released linearly over 12 months (a vesting contract or a published manual schedule) |
| Transfer fee | 1% on non-exempt transfers: 60% burned, 40% to the goal pool. Cap 2%; can only be lowered. LP pair, treasury and pool are exempt (`setFeeExempt`) |
| Burner | A separate wallet (`burner`) that may only call the two reserve burns. The site holds its key as the `BURNER_PRIVATE_KEY` secret and needs a little ETH for gas. Worst case if it leaks: the reserve is burned early |
| Ownership | Owner may lower the fee, set exemptions, the pool address, the burner and the burn sizes, and burn its own balance. `renounceOwnership()` freezes everything |

### Launch sequence

1. Create the pool wallet (a wallet you control; a Safe multisig is recommended) and bridge a little ETH to Robinhood Chain for gas.
2. `npm run token:burner -- new` → note the burner address, `npx wrangler secret put BURNER_PRIVATE_KEY` with its key, send it ~$3 of ETH for gas.
3. `npm run token:compile && DEPLOYER_PRIVATE_KEY=0x… npm run token:deploy -- --pool 0xPool --burner 0xBurner`.
4. Verify the source on Blockscout (solc 0.8.x, optimizer 200 runs, evm `paris`).
5. Create the RESET/USDG pool on a DEX on Robinhood Chain with 40% of supply; send the LP tokens to the burn address; mark the pair address fee-exempt.
6. Move the treasury share to the vesting contract or a separate wallet; mark it fee-exempt.
7. Set `RESET_TOKEN_ADDRESS`, `GOAL_POOL_ADDRESS`, `GOAL_ENABLED: "true"` in `wrangler.jsonc`, `npm run deploy`, then `npm run goal:round -- open --env production --yes`. `npm run token:burner -- status` confirms the burner and its gas.
8. When done configuring, `renounceOwnership()`, and announce.

### Per reset (automatic)

`content:publish` of a confirmed usage reset queues one row in `token_burns` (once per event id; backfills and corrections never burn). The `*/2` cron drain signs `burnForReset(eventId)` with the burner wallet, records the transaction hash, follows the receipt, retries with backoff on RPC trouble, and marks the row confirmed. `/goal#burns` shows the log with explorer links, `/api/v1/goal` includes it as `burns`. Without `BURNER_PRIVATE_KEY` the rows simply wait. Maintainer controls: `GET /admin/goal/burns`, `POST /admin/goal/burns` with `{action:'drain'}`, `{action:'queue', eventId}` (a reset published before the token existed) or `{action:'retry', id}`. `npm run token:burn` remains as a manual fallback.

## What is on chain vs. in D1

On chain: contributions, pool balance, token supply, burns, the draw block hash, payouts. In D1: rounds (status, blocks, hash, winner id, payout tx) and the frozen contributor snapshot (wallet, amount, first tx). No private keys, no funds, no personal data beyond public wallet addresses that already appear on chain.

## Verification for readers

`/goal` links the pool wallet, the token contract, the draw block and each payout on Blockscout, and documents the winner formula so anyone can recompute a draw.

## Why USDG

Robinhood Chain's native stablecoin is **USDG (Global Dollar, Paxos)** at `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` (listed in Robinhood's own contract docs; 6 decimals; hundreds of thousands of holders). There is no Circle-native USDC on the chain; the only "USDC" is Arbitrum-bridged with a few hundred dollars in existence, which nobody holds. The explorer also lists many fake tokens named USDG: only the address above counts. `GOAL_USDG_ADDRESS` defaults to it. Contributors bridging from Ethereum/Arbitrum/Base get USDG delivered on Robinhood Chain through the bridge routes (Across, Relay, LI.FI/Jumper) or the canonical Arbitrum bridge.
