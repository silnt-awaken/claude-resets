# Acceptance evidence

Recorded on 2026-09-17 against the local build (`wrangler dev`, local D1). Each row states what was actually run. **Passed** means the check ran and succeeded here. **Blocked** means the check needs an external account, credential or device that was not available; nothing blocked is claimed as live.

## Basic operation

| Check | Result | Evidence |
| --- | --- | --- |
| Clean install | Passed | `npx -y npm@11 install` (npm 10.9.2 crashed with `edgesOut` while resolving vitest 4; documented in `docs/operations.md`). Lockfile committed. |
| Local migration | Passed | `npm run db:migrate` → `0001_init.sql ✅` |
| Application start | Passed | `npm run dev` on :8787; every route below returned the expected status and content type. |
| Production build | Passed | `npm run build` (`wrangler deploy --dry-run --outdir dist`) succeeds with the D1 and assets bindings. |
| Worker-runtime integration | Passed | `npm test` runs all 89 tests inside workerd (`@cloudflare/vitest-pool-workers`) with a real local D1: 11 files, 89 tests, 0 failures. |
| Type checking | Passed | `npm run typecheck` (Worker + scripts) clean. |
| Content validation | Passed | `npm run content:validate` → 13 events (12 resets + 1 policy change), 7 sources. |
| Direct-route refresh and 404s | Passed | Smoke: `/`, `/zh-CN`, `/ja/sources`, `/resets/2026-09-04-max-weekly`, `/api/docs`, `/mcp/docs`, feeds, robots, sitemap, manifest, icons, font → 200; `/nope`, `/fr`, `/ja/resets/does-not-exist` → real 404 with a localized way back (`pages.test.ts`). |

## Reference parity and layout

| Check | Result | Evidence |
| --- | --- | --- |
| Section/route/control mapping | Passed | `docs/reference-audit.md`. |
| Five widths × two themes, translated and long content | Passed | `npm run screenshots` wrote 58 PNGs to `screenshots/` (360, 390, 768, 1280, 1440 × light/dark; English, Japanese, zh-CN sources, Korean event page, support, API docs). The script measures `scrollWidth - clientWidth` on every capture: no horizontal document overflow anywhere. Visual review: hierarchy preserved, pills wrap on phones, stats stack on phones, sponsor invitation moves in-flow below 1240px, calendar scrolls internally and starts on the newest columns. |
| In-browser interaction walk-through | Passed | Scripted in the session browser at 1024px: theme toggle (saves `dark`/`light`, applied before paint on reload), language menu (opens, focuses first item, Escape closes and restores focus), archive expand/collapse (labels switch, state remembered), Read more/less, calendar day activation (details panel with event link, Escape closes, keyboard role/aria-expanded), beg (count 1→2, "Counted!" status), unavailable browser-alert and Telegram hints, sponsorship dialog open/close, filter selects auto-submit. Console: no errors. |
| Reference screenshots | Partly blocked | Reference captured in the session browser (light/dark, expanded controls) but session screenshots are not persisted to disk. Measured tokens are recorded in `docs/reference-audit.md`. |

## Source identity and event scope

| Check | Result | Evidence |
| --- | --- | --- |
| Seven watchlist records with links, classification, evidence, review dates | Passed | `content/sources.json`; `api.test.ts` asserts all seven handles, https evidence URLs and review dates. `docs/source-evidence.md` lists the evidence. |
| Handles resolve to the intended identities | Passed (as far as public data allows) | oEmbed author names for five accounts; linking pages (GitHub, anthropic.com, claude.com) for the rest. Role claims carry limitations text where public evidence is thin. |
| Max-weekly, all-user two-window, unspecified, targeted, promotion, incident, future, retracted cases | Passed | `content.test.ts` classification fixtures; the real content includes Max-weekly (Sep 4), all-user two-window (Sep 1 etc.), targeted (Jun 19), Pro+Max (Jun 1), windows-unspecified (Apr 23) and a policy change. |
| Deduplication | Passed | Jun 9 and Apr 23 each merge an original and a relay into one event; `validateContent` rejects a source URL used by two events (`content.test.ts`). |

## Statistics, calendar, filters

| Check | Result | Evidence |
| --- | --- | --- |
| Empty / one / many, precise vs partial timestamps, completed-gap math, same-day events, ambiguity, clock skew | Passed | `stats.test.ts` (10 cases), including exact → date-only → exact proving no bridging, partial-sample disclosure, unfinished time excluded from longest gap, negative age clamped. |
| Calendar boundaries | Passed | `calendar.test.ts`: 53 Sunday–Saturday columns ending in the current UTC week, future blank, outside-coverage distinct from no-reset, July 16 03:58 UTC lands on July 16, multiple events per day, unresolved date-only records unplaced but reported, leap day / year boundary, month labels. |
| Filters consistent across hero, stats, calendar, archive, API, MCP | Passed | `filters.test.ts`; `api.test.ts` and `mcp.test.ts` compare status, history and MCP results on the mixed-scope fixture (all-user, Max-only, unspecified): Max matches the first two only; `pages.test.ts` verifies the URL-persisted filter changes the hero and the archive count and survives language switching. |
| Unavailable-data states | Passed | `pages.test.ts`: zero-event, date-only latest, pending (announced) reset, unplaced-day note; em dash + explanation in stat tiles when no precise gap exists. |

## Editorial workflow and backfill

| Check | Result | Evidence |
| --- | --- | --- |
| Draft → validate → preview → publish → correct → export/restore | Passed (local) | Commands exist and typecheck; `admin.test.ts` exercises publish, idempotent retry, mismatch/revision-conflict rejection, correction (silent and explicit), announced→confirmed transition with a mid-way subscriber, stale suppression and `late`. Preview/export/x-draft run against the local server. |
| Historical import yields zero delivery jobs with existing subscribers | Passed | `admin.test.ts` "historical import never enqueues alerts…" (subscriber present, backfill → 0 jobs; a later default publish is also blocked). |
| No automated X ingestion or posting | Passed | Repository search: the only `x.com`/`twitter` references are content URLs, oEmbed documentation, the docs, and the copyable draft; no X API client, OAuth or scraping code exists. |

## Delivery and browser push

| Check | Result | Evidence |
| --- | --- | --- |
| Idempotent enqueue, cutoff, bounded fan-out, concurrent drains, retry/backoff, permanent failure, gone subscriptions, unsubscribe during retry, expiry, pause/disabled, scheduled invocation | Passed | `push.test.ts` (10 cases) with a captured fake transport; the scheduled-handler test invokes `worker.scheduled` with a real `ScheduledController`. |
| Subscription validation | Passed | `push.test.ts`: https only, known push-service hosts only, private/IP/credential hosts rejected, 65-byte p256dh and 16-byte auth enforced, oversized bodies 413. |
| Real VAPID/aes128gcm encryption in the Worker runtime | Passed | `@block65/webcrypto-web-push` builds a payload against a real P-256 key pair in the test env (the scheduled-handler test exercises the real transport; the fake endpoint fails and the job is retried, proving the encrypt/sign path runs in workerd). |
| Notification-click opens the right event | Passed (unit) / Blocked (live) | `public/sw.js` only opens same-origin paths from the payload; delivery to a real browser with the tab closed needs configured VAPID keys, a deployed https origin and a device. Not performed. |
| iOS/installation requirement | Passed | Hint text shown on iOS when not installed; no promise of universal support. |

## Reactions

| Check | Result | Evidence |
| --- | --- | --- |
| Zero start, cooldown, duplicate/concurrent requests, atomic increments, refresh persistence, forged cookie, unavailable state | Passed | `reactions.test.ts` (5 cases), plus the live beg in the browser. Reduced-motion and non-live counter verified by reading `public/app.js`/CSS. |

## API, feeds, MCP

| Check | Result | Evidence |
| --- | --- | --- |
| Schema-valid status/history/sources, pagination walk, filters, 400s, ETag/304, CORS, problem+json 404 | Passed | `api.test.ts` (12 cases). |
| OpenAPI generated from the handler schemas; every documented path resolves | Passed | `api.test.ts` "serves an OpenAPI document whose paths all resolve". |
| RSS and JSON Feed parse, stable ids, attribution, corrections | Passed | `feeds.test.ts`; `curl` confirmed content types. |
| Real MCP client: initialize, list tools, call each, matching public data, no mutation tools | Passed | `mcp.test.ts` uses the official SDK client over Streamable HTTP; `curl` initialize against the dev server returned the server info. |

## Localization, accessibility, security, privacy

| Check | Result | Evidence |
| --- | --- | --- |
| Five languages, no raw keys, preserved scope and source links | Passed | Locale files are typed against the English dictionary (missing keys fail `tsc`); `pages.test.ts` renders every page in every locale and scans for uninterpolated placeholders and `undefined`. |
| Keyboard walk-through | Passed (scripted) | Skip link, buttons with labels, calendar arrow-key navigation, dialog focus containment via native `<dialog>`, Escape handling. |
| Automated accessibility scan | Not run | No axe integration; manual review of landmarks, labels, contrast tokens (ink on paper ≈ 12.9:1; ink on sun ≈ 11:1; card outlines 2px ink). |
| User-input escaping, no client secrets or subscriber data | Passed | `pages.test.ts` XSS and secret-leak checks; JSON embeds escape `<`. |
| Privacy wording vs behaviour | Passed | `/privacy` describes exactly: push endpoint/keys, signed anonymous cookie, local storage preferences, Cloudflare processing, no analytics. |
| Security headers | Passed | CSP `script-src 'self'` etc. asserted on every HTML response. |

## Configuration states

| Check | Result | Evidence |
| --- | --- | --- |
| No optional credentials | Passed | Default `wrangler.jsonc`: browser alerts and Telegram show honest unavailable states; support CTA leads to `/support` with "not available yet". |
| Each channel configured | Passed | Tests run with push enabled; `pages.test.ts` checks Telegram link and push key exposure when configured. |
| Deliberately invalid configuration | Passed | `pages.test.ts`: `http://` support URL is ignored and never rendered; `npm run readiness` flags invalid values without printing secrets. |

## Recovery

| Check | Result | Evidence |
| --- | --- | --- |
| Content export/restore practised | Passed (local) | `npm run content:export` then `--restore`. |
| Deployment rollback and alert pause documented | Passed | `docs/operations.md`. |

## Blocked or not performed (honest list)

- Live browser push delivery with the tab closed, and tapping the notification: needs VAPID keys, an https deployment and a device.
- Live support-link check: `SUPPORT_URL` is not yet supplied.
- Cloudflare deployment: no account/session available here; `wrangler deploy --dry-run` passes.
- Automated accessibility scanner and a physical screen-reader pass.
- Reference screenshots were not persisted to disk.
