# Launch checklist

What the owner still has to supply or do. Everything else is implemented and verified locally (see `docs/acceptance.md`).

## Required before visitors see it

- [ ] **`SUPPORT_URL`** in `wrangler.jsonc` `vars`: your existing https coffee/support page (for example a Buy Me a Coffee or Ko-fi URL). Every "Tip for coffee" link depends on it. Until it is set the CTA leads to `/support`, which says the link is not available yet. After setting it, open the page once from the site and confirm it lands on your page (do not pay).
- [ ] **`SITE_URL`**: the real https origin (your workers.dev subdomain or a custom domain you own). It drives canonical URLs, hreflang, feeds, sitemap, the API's `servers` entry and the X draft links. `claude-resets.com` is **not** ours (a different site already lives there) and must not be used.
- [ ] **Cloudflare account**: `npx wrangler login`, `npx wrangler d1 create claude-resets`, paste the `database_id` into `wrangler.jsonc`, `npm run db:migrate:remote`.
- [ ] **Secrets**: `npx wrangler secret put CONTENT_PUBLISH_TOKEN` (any long random string, at least 16 characters) and `npx wrangler secret put REACTION_SECRET`.
- [ ] `npm run deploy`, then `npm run content:backfill -- --all --env production --yes` with `CONTENT_PUBLISH_TOKEN` exported, so the seed history is recorded as history and can never trigger an alert.
- [ ] `npm run readiness` shows no ✖ items.

## Community goal (USDC on Solana)

- [ ] `GOAL_WALLET` is a Solana wallet you control and `GOAL_USDC_ACCOUNT` is its USDC token account (check on Solscan under the wallet's token accounts). Keep a little SOL in the wallet for the payout fee.
- [ ] `npm run db:migrate:remote` (migration 0006 rebuilds the goal tables), then `npm run deploy`. The first cron tick sets the scan cursor and opens round 1 by itself.
- [ ] Check `https://clauderesets.com/api/v1/goal` shows `enabled: true` and an open round within two minutes.
- [ ] When a round is drawn: send the target in USDC to the winner from the goal wallet, then `npm run goal:round -- paid --tx <signature> --env production --yes`. Details in `docs/goal.md`.

## Advertising (Google AdSense)

Setup completed on October 6, 2026; **identity verification is complete and ad serving is still pending Google's site approval**. A deployed ad loader is not evidence that ads are being served.

- [x] Expanded the existing Google publisher account from AdMob to AdSense and added `clauderesets.com`. Publisher: `ca-pub-6198460375001930` (public).
- [x] Set `ADSENSE_CLIENT` in `wrangler.jsonc` and deployed. Confirmed the live publisher meta tag, ad loader and `/ads.txt`: `google.com, pub-6198460375001930, DIRECT, f08c47fec0942fa0`.
- [x] Google verified site ownership. Submitted **Request review**; the site reports **Getting ready** and **Review requested**.
- [x] Submitted the separate site-onboarding CMP selection: Google's message with **3 choices (Consent, Do not consent, Manage options)** for this site and future sites. The site-detail card now confirms **You've chosen Google's CMP** with a green check. Publishing a custom message alone did not complete this onboarding selection.
- [x] Published Google's European regulations consent message for `clauderesets.com`, with Consent, Do not consent and Manage options. The refusal option is enabled for all message regions. The message links to `https://clauderesets.com/privacy` and supports Google's English, Chinese (zh-CN) and Japanese translations. It is delivered through the AdSense tag; live delivery to a European visitor remains unverified.
- [x] Created **Claude Resets responsive display**, slot `6430168167`, and deployed it as `ADSENSE_SLOT`. Confirmed two live homepage placements, one reset-page placement, one `/perks` placement and no ad loader or placements on `/goal`. Auto ads remain off; this setup uses the site's explicit placements.
- [x] Owner completed Google's identity-verification flow directly with Google. Independently confirmed **Identity Verification: Completed** in AdSense on October 6, 2026. Do not store identity documents, tax identifiers or verification codes in this repository.
- [ ] Google approves the site; then verify a real filled display unit and consent delivery. Approval and ad serving have not yet been confirmed.
- [ ] Before receiving earnings, add a payout method directly in Google. The payments page currently says **Add a payment method to receive your earnings**.

Validation: `npm run check` passed all 135 tests, typechecks, content validation and the Worker build. Test bindings explicitly keep ads off by default so the production publisher/slot settings do not change unrelated test fixtures. Final Worker deployment: `4d4785ee-b817-4840-97a7-e6eb90b00974`.

To disable ads later, empty `ADSENSE_CLIENT` and deploy; this removes ad code and `/ads.txt` and restores the original CSP everywhere.

Ad pages send AdSense's supported strict CSP (a fresh nonce per response, `'strict-dynamic'`, `object-src 'none'`, `base-uri 'none'`), because Google rotates its ad domains and supports no allowlist policy. Every script tag carries the nonce; a script without it will not run on those pages. `/goal` keeps the original `'self'`-only policy. The privacy page gains the advertising disclosure the AdSense program policies require.

## Optional

- [x] **Browser alerts production setup (October 6, 2026)**: enabled `BROWSER_ALERTS_ENABLED`, configured the public P-256 VAPID key and `mailto:silnt.awaken@gmail.com` contact, and installed `VAPID_PRIVATE_KEY` as a Cloudflare secret. The private key is backed up only in the ignored `.production-secrets.env`; never commit or rotate it casually, since existing subscriptions depend on this key pair. Worker version `5d347cfe-cc9e-4cc7-90ad-3decc9b07e95` serves the enabled browser control; the delivery cron runs every minute. All 135 tests, typechecks, content validation and the Worker build passed. Visitors must opt in and allow notifications in their own browser.
- [ ] **Live browser delivery acceptance**: verify a real subscription and an owner-only setup notification. Never publish a fake reset or broadcast a setup test to visitors. The historical local checks remain in `docs/acceptance.md`.
- [ ] **`TELEGRAM_CHANNEL_URL`**: your public channel link. Posting to the channel stays manual.
- [ ] **`PROJECT_X_URL`** / **`OWNER_X_URL`**: header icon and footer credit link.
- [ ] **`SUPPORT_CONTACT_EMAIL`**: enables the sponsorship enquiry `mailto:`. Sponsors are added by hand to `content/sponsors.json` (slug, name, tagline, logo under `public/`, https URL, dates).
- [ ] Custom domain: add it to the Worker in the Cloudflare dashboard, then update `SITE_URL`.

## Before each publish

- [ ] Recheck the tracked accounts on X by hand (the `/sources` page has a prepared search link). Source discovery is manual by design.
- [ ] Follow `docs/content-workflow.md`: inspect → `content:new` → translate → validate → preview → commit + deploy → `content:publish` → optional `x:draft`.

## Not built (by choice)

- Email subscriptions and the `/alerts/confirm` / `/alerts/unsubscribe` flows: no personal data is collected.
- Telegram bot delivery and Stripe sponsorship checkout: manual processes instead.
- Any automated X reading or posting.
