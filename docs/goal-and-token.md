# Community goal and the RESET token

The goal ("Max 20x for a reader") and the RESET token run on **Robinhood Chain** (Arbitrum L2, chain id 4663, ETH gas, RPC `https://rpc.mainnet.chain.robinhood.com`, explorer `https://robinhoodchain.blockscout.com`). Everything is built so that the site only *reads* the chain; all money movement is signed by the owner's own wallet.

## Status

Infrastructure is deployed; the goal is **not open** until `GOAL_ENABLED`, `GOAL_POOL_ADDRESS` and (after deployment) `RESET_TOKEN_ADDRESS` are set. In that state the homepage card and `/goal` show an honest "not open yet" and no fake numbers.

## How a round works

1. **Open a round**: `npm run goal:round -- open --env production --yes` (title and `--target` optional; default $200 = one month of Max 20x).
2. **Readers enter free** at `/goal` or the homepage card with a 0x address or an X handle. One entry per identity per round and one per browser (signed cookie). Contributions of USDC to the pool wallet are welcome and buy nothing extra.
3. **Meter**: `/api/v1/goal` reads the pool wallet's USDC balance (and ETH, informational) straight from the chain, cached 60 s per isolate. RPC failure shows "stale", never a made-up figure.
4. **Freeze** when the target is reached: `npm run goal:round -- freeze --env production --yes`. Records the current block and announces `drawBlock = current + 600` (≈1 minute at 100 ms blocks; `--blocks` overrides).
5. **Draw** after the draw block exists: `npm run goal:round -- draw --env production --yes`. Winner index = `uint256(blockhash(drawBlock)) mod entries` over entries ordered by id. The hash, block and index are stored and shown publicly.
6. **Pay** $200 USDC from the pool wallet to the winner (X-handle entrants provide a wallet by DM within 14 days), then `npm run goal:round -- paid --tx 0x… --env production --yes`.
7. **Burn** for the round: `npm run token:burn -- --round <id>` (0.5% of initial supply from the reserve), then open the next round.

`npm run goal:round -- status` prints the public status JSON. `cancel --note "…"` closes a round without a draw.

## RESET token

Contract: `contracts/ResetToken.sol` (no external dependencies, ~5 KB bytecode). Compile with `npm run token:compile`, deploy with `DEPLOYER_PRIVATE_KEY=0x… npm run token:deploy -- --pool <poolWallet>` (use `--dry-run` first). The deployer receives the full supply and distributes it per the table below.

| Item | Value |
| --- | --- |
| Supply | 1,000,000,000 RESET, 18 decimals, minted once in the constructor; no mint function |
| Liquidity | 40% paired with ETH on Uniswap on Robinhood Chain; LP tokens sent to `0x…dEaD` |
| Contributor rewards | 25%, paid per round pro-rata to USDC contributed (rewards only; odds never change) |
| Burn reserve | 15%: 0.25% of initial supply per published Claude reset (`burnForReset(eventId)`), 0.5% per completed round (`burnForRound(roundId)`) |
| Treasury | 20%, released linearly over 12 months (a vesting contract or a published manual schedule) |
| Transfer fee | 1% on non-exempt transfers: 60% burned, 40% to the goal pool. Cap 2%; can only be lowered. LP pair, treasury and pool are exempt (`setFeeExempt`) |
| Ownership | Owner may lower the fee, set exemptions and the pool address, and burn its own balance. `renounceOwnership()` freezes everything |

### Launch sequence

1. Create the pool wallet (a wallet you control; a Safe multisig is recommended) and bridge a little ETH to Robinhood Chain for gas (Arbitrum portal → Robinhood Chain).
2. `npm run token:compile && DEPLOYER_PRIVATE_KEY=0x… npm run token:deploy -- --pool 0xPool`.
3. Verify the source on Blockscout (solc 0.8.x, optimizer 200 runs, evm `paris`).
4. Create the RESET/ETH pool on Uniswap on Robinhood Chain with 40% of supply; send the LP tokens to the burn address; mark the pair address fee-exempt.
5. Move the treasury share to the vesting contract or a separate wallet; mark it fee-exempt.
6. Set `RESET_TOKEN_ADDRESS`, `GOAL_POOL_ADDRESS`, `GOAL_ENABLED: "true"` in `wrangler.jsonc`, `npm run deploy`, then `npm run goal:round -- open --env production --yes`.
7. When done configuring, `renounceOwnership()`, and announce.

### Per reset

After `content:publish` for a confirmed reset: `DEPLOYER_PRIVATE_KEY=0x… npm run token:burn -- --event <id>`, then add the burn transaction link to that event's `notes`. The script refuses to burn for anything that is not a published, confirmed usage reset.

## What is on chain vs. in D1

On chain: contributions, pool balance, token supply, burns, the draw block hash, payouts. In D1: rounds (status, blocks, hash, winner id, payout tx) and free entries (identity, display, browser cookie id). No private keys, no funds, no personal data beyond the entrant's chosen handle or address.

## Verification for readers

`/goal` links the pool wallet, the token contract, the draw block and each payout on Blockscout, and documents the winner formula so anyone can recompute a draw.

## Notes on the USDC address

`GOAL_USDC_ADDRESS` defaults to the canonically bridged USDC on Robinhood Chain (`0x80e0e24718dbfcad49ecaa6f1e6c89a190586ca8`, derived from the L2 gateway router on 2026-09-18 and confirmed to report symbol USDC). Before funding, confirm on the explorer that this is the USDC your contributors will actually hold; if Robinhood lists a native USDC or USDG contract, set that address instead. The pool wallet can hold either; the meter counts only the configured token.
