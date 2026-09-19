# Community goal ("Max 20x for a reader")

Readers send **USDC on Solana** to a dedicated treasury wallet the operator controls (never the operator's personal wallet). When a round reaches its target, one contributor is drawn automatically by a finalized Solana block hash and the operator pays them one month of Claude Max 20x in USDC. There is no token, no smart contract and no other crypto feature; the site only *reads* the chain.

## What the site does and does not do

- Reads: incoming USDC transfers to the goal wallet's token account, the current slot, finalized block hashes. Public RPC, no key.
- Builds (but never signs) the USDC transfer that Phantom shows a contributor for approval.
- Never holds a key and cannot move money. The payout is a manual transfer from the operator's wallet.
- Stores in D1: rounds, contributions (signature, wallet, amount, slot), and the scan cursor. No personal data beyond public wallet addresses.

## Configuration (`wrangler.jsonc` vars)

| Var | Meaning |
| --- | --- |
| `GOAL_ENABLED` | `"true"` opens the goal. Anything else shows an honest "not open yet". |
| `GOAL_WALLET` | The treasury wallet (base58). Shown publicly; contributors send here. Keep it separate from any personal wallet. |
| `GOAL_USDC_ACCOUNT` | That wallet's USDC token account. Transfers actually land here; the scan watches it. Derive it with `getTokenAccountsByOwner(GOAL_WALLET, {mint: USDC})` or on Solscan under the wallet's token accounts. It must exist before the first contribution: the transfer message the site builds does not create it, so send a small USDC amount to a fresh treasury once (Phantom adds the create-account instruction). |
| `GOAL_USDC_MINT` | Circle's USDC mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` (default). |
| `GOAL_SOLANA_RPC` | Comma-separated JSON-RPC endpoints, tried in order. Default `https://solana-rpc.publicnode.com`, which serves Cloudflare Workers without a key. `api.mainnet-beta.solana.com` does **not**: Workers send a `Cf-Worker` header and that endpoint answers "Your IP or provider is blocked". |
| `GOAL_SOLANA_RPC_PRIVATE` (secret) | Optional keyed endpoint (Helius, QuickNode, Triton… free tiers), tried before the public ones. Set with `npx wrangler secret put GOAL_SOLANA_RPC_PRIVATE`; the key lives in the URL, so never put it in `vars`. |
| `GOAL_EXPLORER_URL` | Default `https://solscan.io`. |
| `GOAL_TARGET_USD` | Default 200 (one month of Max 20x). |
| `GOAL_EXCLUDED_WALLETS` | Extra operator wallets that never win (list the personal wallets too). The goal/treasury wallet itself is always excluded. |

`npm run readiness` prints the state of these settings.

## How a round runs (all automatic except the payout)

The cron (`* * * * *`) calls `tickGoal` every minute (`src/routes/goal.ts`):

1. **Sync.** `getSignaturesForAddress` on the USDC account, newer than the stored cursor; each new transaction is read with `getTransaction` (`jsonParsed`). A successful transaction that increased the account's USDC balance is a contribution: amount = balance delta, sender = the authority of the SPL transfer into the account (fee payer as a fallback, e.g. for swaps). Stored once per signature. The very first run only records the newest signature as the cursor, so transfers from before the goal never count.
2. **Open.** If no round is open/frozen/drawn, a new one opens with the default title and `GOAL_TARGET_USD`, adopting contributions that arrived while no round was open.
3. **Freeze.** When the open round's contributions reach the target and at least one wallet qualifies (≥ 1 USDC total, not an operator wallet), the round records the confirmed slot and announces a draw slot 150 slots later (about a minute). Entries are fixed here; later contributions wait for the next round.
4. **Draw.** Once the finalized slot passes the draw slot, the first finalized block at or after it (slots can be skipped) provides the hash. Winner index = `bytesToBigInt(base58decode(hash)) mod entries`, entries ordered by first contribution slot then wallet. Recorded with block, hash, index and count.
5. **Payout (manual).** `npm run goal:round -- status` shows the winner. Send the target amount in USDC from the goal wallet to the winner, then `npm run goal:round -- paid --tx <signature> --env production --yes`. The next tick opens the next round.

Other commands: `npm run goal:round -- tick` (run a cron step now), `cancel --note "…"` (contributions roll into the next round), `open [--title … --target …]` (manual open; the cron does this itself).

## Contribution flow in the browser

`public/goal.js`, Phantom only (extension or the Phantom app's in-app browser):

1. Contribute → sheet → amount → pay.
2. `window.phantom.solana.connect()` → wallet address.
3. `POST /api/v1/goal/tx { from, amount }` → the server derives the wallet's USDC Associated Token Account (PDA derivation with the Ed25519 on-curve check, no SDK), reads it and the SOL balance, fetches a recent blockhash and returns a base58 legacy message (compute budget limit/price + SPL `TransferChecked` to the goal's USDC account). Wallets that keep USDC only in a non-associated account see "no USDC" and can send by hand.
4. `provider.request({ method: 'signAndSendTransaction', params: { message } })` → signature.
5. `POST /api/v1/goal/contributions { signature }` until it stops answering 202; the server verifies the transaction on chain and records it immediately (the cron would find it within a minute anyway).

Without Phantom the sheet shows the wallet address to copy, an install link, and on phones an "open in the Phantom app" deep link. Any wallet or exchange withdrawal of USDC on Solana counts; the scan sees it.

## Public API

- `GET /api/v1/goal`: enabled, network, target, pool (wallet, USDC account), current/latest round (status, raised, contributors, draw slot/block/hash, winner, payout), past rounds, sync state, progress.
- `GET /api/v1/goal/contributors`: the draw list in draw order with the winner index, so anyone can recompute the result.

## Verification for readers

`/goal` links the wallet and its USDC account on Solscan, the draw block, and each payout, and documents the formula. The contributor list and the hash are enough to recompute a draw.

## Trust model, stated plainly

The money sits in one person's wallet. The draw needs no trust (public inputs, network-produced hash), the payout does. `/goal#trust` says so to readers.
