# Reference audit

How the observed reference (codex-resets.com, inspected 2026-09-17 in the built-in browser, light and dark, plus its OpenAPI document and locale pages) maps to this implementation, and where we deliberately differ.

## Inspection limits

- The reference was inspected as a rendered site; its source repository was not used. All presentation code and assets here are project-owned. The Baloo 2 font is used under the SIL Open Font License (self-hosted from Google Fonts).
- Its payment flow (Stripe sponsorship), email delivery, Telegram channel and browser-permission flows were **not** exercised; only their visible UI and public API/OpenAPI were observed.
- Its MCP listing page (mcpservers.org) was behind a JavaScript challenge and could not be read; the MCP surface here follows the MCP specification rather than that listing.
- Screenshots of the reference were captured in the session browser (not persisted to disk). Our own screenshot matrix is under `screenshots/` after `npm run screenshots`.

## Observed design tokens (measured from the reference's computed styles)

| Token | Reference (light) | Reference (dark) | Ours |
| --- | --- | --- | --- |
| Paper / ink | `#fff4dd` / `#26201a` | `oklch(18% .012 70)` / `oklch(93% .025 80)` | same |
| Accent (reset), sun, rose, sky, peach | `#ff5c2b`, `#ffd84d`, `#ffb9cc`, `#a5dcff`, `#ffb07a` | toned oklch variants | same values |
| Card surface, empty calendar cell | `#fffdf7`, `#f1e3c4` | `oklch(24% …)`, `oklch(35% …)` | same |
| Border / shadows / radius | 2px ink; 4px 4px (cards), 6px 6px (hero), 3px 3px (pills); 14px | shadow ink `oklch(8% …)` | same |
| Display font | Baloo 2, 800; h1 36px, h2 24px | | same |
| Body / mono | system-ui stack; ui-monospace for labels | | same, with CJK fallbacks added |
| Main column | ~824px centered, sponsor rails either side at wide widths | | 824px, rails fixed at ≥1240px, in-flow below |
| Calendar cell | 22px, 6px radius, 1px border, 1.5px shadow | | same |
| Tilts | hero −0.4°, stat tiles −1°/+0.8°/−0.6° | | same |

## Section-by-section mapping

| Reference | Ours | Difference |
| --- | --- | --- |
| Masthead: avatar of the watched person + "Codex Resets", language menu, project X link, theme toggle | Original circular reset mark + "Claude Resets", language menu, project X link (only when `PROJECT_X_URL` is set), theme toggle | No staff portrait as brand. Theme defaults to light when nothing is saved (reference follows the system). |
| Explainer "We watch @thsottiaux…" | "I check public Claude and Anthropic announcements … by hand" + link to `/sources` | Several watched accounts rather than one. |
| Action pills: browser, telegram, email | browser, telegram, feed, **Tip for coffee** | Email removed (no personal data collected). RSS/JSON feed pill added. Unavailable Telegram/browser states show a plain-language hint instead of pretending. |
| Hero card: label, giant yellow elapsed time, absolute time, beg button with count | Same, plus event title, audience/window chips, source line, "View announcement" and "Check usage in Claude" (claude.ai Settings › Usage), and a note that the age is measured from the announcement | Date-only, ambiguous and empty states rendered honestly. |
| Pending/scheduled reset (reference: `scheduled_reset`) | "Announced, not yet confirmed" notice with stated timing and "confirmation pending" once the time passes | Never replaces the confirmed hero. |
| AI "active watch" forecast | none; `active_watch` is always `null` in the API | Deliberate. |
| Three stat tiles: resets, avg interval, longest wait | Same colours and layout; em dash + explanation when no precise gap exists; scope/coverage note and link to `/about` | Plus an audience/window filter persisted in the URL. |
| Calendar: regular / banked / no reset | broad / limited scope / no reset, plus outside-coverage and future states, UTC label | No "banked" category (no Claude evidence). Cells are keyboard-activatable links; details panel by click/tap, not hover. |
| Archive: 3 bubbles then "Show all N resets" | Same, with title, summary, labelled verbatim excerpt, chips, View on X, relay links, event page link; "Show fewer"; long text clamped with Read more | Non-reset announcements listed separately ("Other limit announcements"); retracted events in their own section. |
| (none) | Accounts to follow preview + `/sources` directory | Added. |
| (none) | Support card + `/support`; footer coffee link | Added; all placements use `SUPPORT_URL`. |
| Footer: languages, data credit, MCP + API links, creator credit | Same shape, independent-project statement, sources/about/support/privacy/feed links, sources-last-reviewed date, design credit | Creator credit uses `OWNER_NAME` (and `OWNER_X_URL` when set). |
| Sponsor rails with advertisers; sponsorship dialog with visitors, price, slots, Stripe | Rails driven by `content/sponsors.json`; with none active, one invitation card; dialog explains placement and links a `mailto:` when `SUPPORT_CONTACT_EMAIL` is set | No traffic/price/slot figures, no Stripe. Manual approval only. |
| Locale routes `/zh-CN`, `/zh-TW`, `/ja`, `/ko` | Same prefixes for every content page, reset page and 404 | API/MCP docs stay English with a notice and a way back. |
| `/api/docs` (Swagger UI from CDN) | Self-contained docs page with "Try it" panels (same origin, no CDN) | CSP is `script-src 'self'`. |
| `/api/openapi.json` with `Reset`, `StatusResponse`, `ResetListResponse`, `Problem` | Generated from zod schemas: `ResetSummary`, `Stats`, `StatusResponse`, `ResetListResponse`, `SourcesResponse`, `Problem` | Explicit scope fields, time precision, corrections, `revision_changed`. |
| `/api/v1/status`, `/api/v1/resets` (limit/cursor/from/to/order) | Same endpoints and parameters plus `audience`/`window` filters and `/api/v1/sources` | ETag/304, 429 with Retry-After, 503 problem documents. |
| MCP listing (external) | `/mcp` (Streamable HTTP, stateless) + `/mcp/docs` | Three read-only tools. |
| Analytics scripts (two third-party + Cloudflare beacon) | none | Deliberate. |
| Markdown alternate (`/index.md`) | none | Not required by the specification. |

## Interaction states reproduced

Theme toggle (saved, applied before paint), language menu (button + popover-style menu, Escape closes), archive expand/collapse (state remembered per browser), calendar day details (click/tap/keyboard, arrow-key navigation between occupied days, Escape closes), beg (optimistic update with rollback, cooldown message, reduced-motion respected), browser alert states (unsupported, unavailable, denied, prompt, granted-but-unsubscribed, subscribed, revoked, error, iOS install hint), sponsorship dialog (native `<dialog>`, focus restored on close).
