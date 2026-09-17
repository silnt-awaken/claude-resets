# Operations

## Configuration

Public settings live in `wrangler.jsonc` under `vars` and are safe to commit. Secrets go in `.dev.vars` locally (git-ignored) and `npx wrangler secret put <NAME>` in production. `npm run readiness` prints the state of every setting without printing secret values.

| Setting | Kind | Effect |
| --- | --- | --- |
| `SITE_NAME`, `SITE_URL`, `OWNER_NAME` | public | Branding, canonical/hreflang/feed/sitemap URLs, creator credit. `SITE_URL` must be the real https origin before launch; a guessed domain is never assumed. |
| `OWNER_X_URL`, `PROJECT_X_URL` | public, optional | Owner link in the footer credit; project X icon in the header. Must be https or they are ignored. |
| `SUPPORT_URL` | public, required for the coffee feature | Every "Tip for coffee" placement. The provider name is shown only when the host is recognised (Buy Me a Coffee, Ko-fi, GitHub Sponsors, Patreon, PayPal, Liberapay, Open Collective). Unset: honest "not available yet" state. |
| `SUPPORT_CONTACT_EMAIL` | public, optional | `mailto:` in the sponsorship dialog and `/support`. |
| `TELEGRAM_CHANNEL_URL` | public, optional | Telegram pill target. Unset: pill explains it is not set up. No bot posting is implemented; channel posting is manual. |
| `BROWSER_ALERTS_ENABLED`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT` | public | Web Push capability; all three plus the secret must be set for the pill to work. |
| `VAPID_PRIVATE_KEY` | secret | JWK `d` value from `npx tsx scripts/vapid-keys.ts`. |
| `CONTENT_PUBLISH_TOKEN` | secret | Bearer token for `/admin/*`. At least 16 characters; the endpoint is disabled otherwise. |
| `REACTION_SECRET` | secret | Signs the anonymous reaction cookie. Reactions are disabled without it. |
| `ALERTS_PAUSED` | public | `true` pauses delivery without deleting subscriptions or jobs. |
| `REACTION_COOLDOWN_HOURS` | public | Default 24. |
| `ALERT_MAX_AGE_HOURS` | public | Default 72. Older announcements are not alerted unless published with `--late`; pending jobs older than this expire. |

Public capability states on the site come from these settings at request time, never from the mere presence of a button.

## Alerts

Channels: **browser push** (implemented, real Web Push with VAPID via `@block65/webcrypto-web-push`, which uses Web Crypto and runs in the Worker), **Telegram** (link to your channel only; no bot), **feeds** (RSS/JSON; readers poll). Email was left out on purpose: the site stores no personal data.

Pipeline:

1. `content:publish` → `/admin/publish` records the publication (`publications`, unique per event+revision) and, for a first confirmed usage reset, inserts one `alerts` row (unique per event, alertRevision, kind) and fans out `push_jobs` for active subscriptions created at or before the cutoff (`INSERT OR IGNORE … SELECT`, unique per alert+subscription).
2. The cron trigger (`*/2 * * * *`) calls `drainPushJobs`: leases up to 50 due jobs (`UPDATE … RETURNING` with a 5-minute lease so overlapping runs cannot double-send), sends, then marks `sent`, `pending` with exponential backoff (30 s doubling, max 1 h, 6 attempts), `failed`, `skipped` (subscription no longer active or event unpublished) or `expired` (alert older than `ALERT_MAX_AGE_HOURS`). `404`/`410` from the push service deactivates the subscription.
3. `npm run outbox` shows the ledger and job states; `npm run outbox -- --drain` runs one batch by hand. Locally, `wrangler dev --test-scheduled` also exposes `/__scheduled`.

Guarantees and limits: enqueueing is idempotent; delivery is at-least-once (a crash after the push service accepted a message but before the row was marked `sent` is retried). Push services do not provide end-to-end idempotency, so exactly-once is not promised. Subscriber endpoints and keys are never logged.

Pause: set `ALERTS_PAUSED=true` (`npx wrangler deploy` after editing vars, or a Cloudflare dashboard override). Resume by setting it back; queued jobs are delivered unless they have expired.

## Backup and restore

- Content: Git is the history. `npm run content:export -- --env production` also writes a snapshot with the D1 ledger under `exports/`.
- Database: `npx wrangler d1 export claude-resets --remote --output backup.sql` (Cloudflare's export) for subscriptions, reactions and the ledger. Restore with `npx wrangler d1 execute claude-resets --remote --file backup.sql` on a fresh database, or re-run migrations and accept the loss of subscriptions (they re-register on the next visit).
- Practised locally: `npm run content:export`, edit a file, `npm run content:export -- --restore exports/<stamp>`, `git diff`.

## Deployment rollback

`npx wrangler rollback` restores the previous Worker version (content is bundled, so a rollback also restores the previous content). The D1 ledger is append-only and needs no rollback; a publication recorded for content that is rolled back simply stays recorded (its alert, if any, has already been sent).

## Cache and freshness

- HTML: `Cache-Control: public, max-age=60, stale-while-revalidate=300` with a weak ETag derived from the content revision, locale, filters, minute and reaction count. Ages and local times are refreshed client-side every 30 s. New publications change the content revision at deploy, so every surface updates within a minute.
- API: same policy, ETag/304, `429` with `Retry-After`, `503` problem documents if content fails validation at startup (which `npm run content:validate` prevents).
- Feeds: 5 minutes. Docs: 5 minutes. Assets: served by Workers static assets with their own ETags.
- The editorial "last reviewed" timestamp changes only through `npm run sources:review`.
- The service worker caches nothing; it only receives pushes.

## Abuse controls

Per-isolate in-memory sliding windows (best effort, not global): API 120/min per IP, MCP 60/min, push endpoints 30/min, reactions 20/min. Reactions additionally enforce one accepted reaction per signed anonymous cookie per cooldown with a single conditional SQL upsert as the gate. Push subscriptions must use https endpoints on known push-service hosts (Google FCM, Mozilla, Apple, Microsoft WNS, Samsung) with correctly sized keys; private and literal-IP hosts are rejected. Request bodies are capped (8 KB subscriptions, 64 KB MCP, 256 KB admin). Raw IP addresses are not stored.

## Security headers

`Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`, plus `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options` (pages). All scripts are same-origin files; there is no inline JavaScript. `/admin/*` is `Disallow`ed in robots.txt and never linked.

## Cost and limits (Cloudflare free plan, checked September 2026)

- Workers: 100,000 requests per day, 10 ms CPU per request on the free plan. A page render or API call here is well under that. Exceeding the daily request cap returns errors until the next day unless you move to the paid plan (USD 5/month, 10 million requests included).
- D1: 5 million rows read and 100,000 rows written per day, 5 GB storage. Each page view performs one small read (reaction count); each reaction two writes; push fan-out writes one row per subscriber per alert.
- Cron triggers: included. Static assets: included.
- Costs arise only if request volume exceeds the free daily cap or you enable the paid plan; there is no dependency on any other paid service. Verify current numbers at <https://developers.cloudflare.com/workers/platform/limits/> and <https://developers.cloudflare.com/d1/platform/limits/>.

## Local development notes

- `npm install` with npm 10.9.x failed on this machine with `Cannot read properties of null (reading 'edgesOut')` while resolving vitest 4; `npx -y npm@11 install` works and produced the committed lockfile.
- The test runner's bundled workerd supports compatibility dates up to 2026-08-22, so `wrangler.jsonc` pins that date; raise it when the runtime updates.
- `npm run screenshots` requires Playwright's Chromium (`npx playwright install chromium` once) and a running dev server.
