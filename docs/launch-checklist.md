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

Off until `ADSENSE_CLIENT` is set; with it empty there is no ad code, no `/ads.txt` and the strict CSP everywhere.

- [ ] Sign up at adsense.google.com with your own Google account and add the site `clauderesets.com`. Copy the publisher id (`ca-pub-` followed by 16 digits; it is public, it appears in every page's source).
- [ ] Put it in `wrangler.jsonc` as `ADSENSE_CLIENT`, `npm run deploy`. The site now serves the `google-adsense-account` meta tag, the ad loader on every page except `/goal` and error pages, and `/ads.txt` (`google.com, pub-…, DIRECT, f08c47fec0942fa0`). Then click "Request review" in AdSense; approval takes days to a few weeks.
- [ ] **Consent (required for EEA, UK and Switzerland visitors)**: in AdSense, Privacy & messaging → European regulations → create and publish Google's consent message. It is served by the same ad code; nothing to deploy. Without it Google serves those visitors limited or no ads.
- [ ] After approval: turn on Auto ads for the site, and/or create one responsive **Display ad** unit and put its numeric `data-ad-slot` id in `ADSENSE_SLOT`, then redeploy. The slot fills two in-page placements on the homepage, one at the end of each reset page and one on `/perks`; units Google leaves unfilled collapse.
- [ ] Check `npm run readiness` shows `ADSENSE ok`, and `https://clauderesets.com/ads.txt` returns the line above.

Ad pages send AdSense's supported strict CSP (a fresh nonce per response, `'strict-dynamic'`, `object-src 'none'`, `base-uri 'none'`), because Google rotates its ad domains and supports no allowlist policy. Every script tag carries the nonce; a script without it will not run on those pages. `/goal` keeps the original `'self'`-only policy. The privacy page gains the advertising disclosure the AdSense program policies require.

## Optional

- [ ] **Browser alerts**: `npx tsx scripts/vapid-keys.ts`, put `VAPID_PUBLIC_KEY` and `VAPID_SUBJECT` (`mailto:` you) in `vars`, set `BROWSER_ALERTS_ENABLED` to `"true"`, `npx wrangler secret put VAPID_PRIVATE_KEY`, redeploy. Then do the live check in `docs/acceptance.md` (subscribe in a supported browser, close the tab, publish a test event on a preview deployment, confirm the notification opens the event page). Until then the pill says alerts are not available yet.
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
