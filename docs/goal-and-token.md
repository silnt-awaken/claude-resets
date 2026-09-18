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
7. Marking the round paid queues the round burn automatically (`RESET_BURN_PER_ROUND` from the burner wallet); the cron sends it within two minutes. Then open the next round.

`npm run goal:round -- status` prints the public status JSON. `cancel --note "…"` closes a round without a draw.

## RESET token

RESET is launched on the **pons launchpad** (ponsfamily.com) on Robinhood Chain: a fair-launch bonding curve paired with **ETH**, graduating once the curve has raised 4.2 ETH, after which the launchpad locks the liquidity. The token contract is pons' standard ERC-20; we have no admin power over it. The site's only lever is the **burner wallet**, which holds the burn reserve and sends fixed amounts to `0x000…dEaD`.

| Item | Value |
| --- | --- |
| Launch | pons launchpad, ETH pair, no presale, no team allocation, no mint function |
| Liquidity | Locked by the launchpad at graduation (4.2 ETH raised) |
| Trade fee | 3% per trade (launchpad setting); the 2% creator share is routed to RESET holders by the launchpad (permanent "holder fee sharing"). The goal pool is funded by contributions only |
| Burn reserve | Bought on the curve at launch (the "developer buy") and transferred to the burner wallet, whose address is published (`RESET_BURNER_ADDRESS`) |
| Burn schedule | `RESET_BURN_PER_RESET` (default 2,500,000) per published confirmed reset; `RESET_BURN_PER_ROUND` (default 5,000,000) per paid round. Automatic, once per event id |
| Control | None over the token. The burner wallet's balance is public and only shrinks |

### Launch sequence (pons)

1. `npm run token:burner -- new` → burner address + key. `npx wrangler secret put BURNER_PRIVATE_KEY` with the key; send the burner ~$3 of ETH on Robinhood Chain for gas.
2. On pons: name `Reset`, ticker `RESET`, paired asset ETH, description without links, X profile `clauderesets`, holder fee sharing on. Set a developer buy in ETH: that is the burn reserve. Launch.
3. Transfer the developer-buy RESET from the launching wallet to the burner wallet.
4. In `wrangler.jsonc`: `RESET_TOKEN_ADDRESS` (from pons / Blockscout), `RESET_BURNER_ADDRESS`, `GOAL_POOL_ADDRESS`, `GOAL_ENABLED: "true"`; adjust `RESET_BURN_PER_RESET` / `RESET_BURN_PER_ROUND` to the supply pons minted (defaults assume 1B). `npm run deploy`, then `npm run goal:round -- open --env production --yes`.
5. `npm run token:burner -- status` shows the burner's gas and RESET balance. `npm run readiness -- --env production` should show BURNER_PRIVATE_KEY and RESET_BURNER_ADDRESS ok.

### Per reset (automatic)

`content:publish` of a confirmed usage reset queues one row in `token_burns` (once per event id; backfills and corrections never burn). The `*/2` cron drain sends the burn from the burner wallet, records the transaction hash, follows the receipt, retries with backoff on RPC trouble, and marks the row confirmed. In transfer mode the burn is a plain ERC-20 `transfer(0xdEaD, amount)`; the site's log links it to the event. `/goal#burns` shows the log, `/api/v1/goal` includes it as `burns`. Without `BURNER_PRIVATE_KEY` the rows wait. If the burner runs out of RESET the row fails with "reserve empty"; top the wallet up and `POST /admin/goal/burns {action:'retry', id}`. Other maintainer actions: `{action:'drain'}`, `{action:'queue', eventId}` (a reset published before launch).

### Fallback: self-deployed contract

`contracts/ResetToken.sol` is kept for the case where the launchpad is not used: fixed 1B supply, 1% transfer fee (60% burned / 40% to the pool), a 15% reserve held by the contract, and a burner role that can only call `burnForReset(eventId)` / `burnForRound(roundId)`. Compile with `npm run token:compile`, deploy with `DEPLOYER_PRIVATE_KEY=0x… npm run token:deploy -- --pool 0xPool --burner 0xBurner`, set `RESET_BURN_MODE: "contract"`, and `npm run token:burner -- set --address 0xBurner` if the burner changes. Burn sizes then come from the contract, not the vars.

## What is on chain vs. in D1

On chain: contributions, pool balance, token supply, burns, the draw block hash, payouts. In D1: rounds (status, blocks, hash, winner id, payout tx) and the frozen contributor snapshot (wallet, amount, first tx). No private keys, no funds, no personal data beyond public wallet addresses that already appear on chain.

## Verification for readers

`/goal` links the pool wallet, the token contract, the draw block and each payout on Blockscout, and documents the winner formula so anyone can recompute a draw.

## Why USDG

Robinhood Chain's native stablecoin is **USDG (Global Dollar, Paxos)** at `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` (listed in Robinhood's own contract docs; 6 decimals; hundreds of thousands of holders). There is no Circle-native USDC on the chain; the only "USDC" is Arbitrum-bridged with a few hundred dollars in existence, which nobody holds. The explorer also lists many fake tokens named USDG: only the address above counts. `GOAL_USDG_ADDRESS` defaults to it. Contributors bridging from Ethereum/Arbitrum/Base get USDG delivered on Robinhood Chain through the bridge routes (Across, Relay, LI.FI/Jumper) or the canonical Arbitrum bridge.
