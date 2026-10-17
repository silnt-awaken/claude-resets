# Confirmed contribution activity

The prior confirmation response updated only progress figures. Wallet aggregates waited for a separate 30-second refresh, and the status API allowed another 30 seconds of public caching. This could show a new total beside an old contributor amount.

The confirmation response now includes the complete goal snapshot. Totals, wallet aggregates and the latest 20 individual receipts are read in one D1 transaction and applied together. The browser rejects older snapshots so an earlier in-flight refresh cannot roll confirmed figures backwards. The live status API and pages carrying donation figures use `no-store`.

Each receipt includes the confirmed amount, public sender, transaction signature and blockchain timestamp. When the chain has no timestamp, the ingestion date is labeled **Recorded**, never presented as the send date. Repeat donations remain individual rows while the wallet list remains aggregated. One wallet still counts as one draw entry. No eligibility, treasury, payout or draw rules changed.

While the network is confirming, the UI shows a pending state and receipt link and disables duplicate sends. A saved public transaction signature lets confirmation resume after a reload. Users can check status manually. Unknown confirmation is not presented as a failure or as confirmed funding.

All added text is translated into the five supported languages. The custody note states that the owner holds the wallet and pays the winner manually; it does not imply escrow or an automatic payout.

Acceptance: `npm run check`; `node scripts/verify-goal-activity.mjs [base URL]`; `npx tsx scripts/verify-goal-transfer.ts [base URL]`. Browser checks stub all POSTs and use no real wallet or funds. Local development needs an existing open round for the contribution sheet. Production verification must inspect actual receipts and dates from `/api/v1/goal` in addition to the simulated pending/confirmation tests.
