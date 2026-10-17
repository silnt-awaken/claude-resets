# Translated tools and Phantom transfer update

## Languages

`/tools` and `/reset-history` now use typed dictionaries for English, Simplified Chinese, Traditional Chinese, Japanese and Korean. Every guide, issue response, planner label, live countdown, history explanation and planner privacy notice is translated. Metadata, canonical/alternate URLs, sitemap entries, form actions and in-site links use the selected locale. Source documents remain at their official URLs.

The planner retains the same opt-in local storage key across language changes, while formatting output in the page's language. Tests ensure every translation has the same interpolation tokens.

## Contribution transaction format

The injected Phantom path previously called the low-level `request` API with a serialized message. It now follows Phantom's recommended `signAndSendTransaction(Transaction)` API, with a full unsigned legacy transaction decoded by the official Solana SDK. The existing `message` response is retained for compatibility; `/api/v1/goal/tx` additionally returns `transaction` with its empty signature slot. The phone deeplink uses the same full transaction bytes.

The codec is built locally from pinned development dependencies into `/vendor/goal-transaction.js`, served from this site, and loaded only after an explicit contribution attempt. `npm run build` and the deployment wrapper rebuild it. The Worker does not import the SDK or receive private keys.

Reference: https://docs.phantom.com/solana/sending-a-transaction

## Acceptance

- `npm run check`: type checking, content validation, real Worker/D1 regression suites and build.
- `node scripts/verify-reader-tools.mjs [base URL]`: all five locales, translated countdown states, local storage, no-JavaScript fallback, locale navigation, desktop/mobile widths and dark mode.
- `npx tsx scripts/verify-goal-transfer.ts [base URL]`: real Solana decoding of unsigned bytes, amount and destination checks, fake provider rejection and successful receipt/confirmation. Network routes stub every signing/contribution response and reject unexpected POSTs. No real wallet, signature, transfer or broadcast is used.

The specific user error was not independently captured inside a live Phantom wallet. The tests establish valid transaction encoding and the provider method contract. A funded transfer still requires the contributor's own approval and was not performed by the agent.
