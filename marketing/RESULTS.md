# Verification and optional measurement

September 22, 2026: deployed implementation commit `cfd1e49` as Cloudflare Worker version `f3774621-e28a-476e-826e-a1f3757655d1`. The public homepage was inspected in Chrome and shows the Opus 5.5 saved-reset card with October 22, 2026 expiry.

Public checks returned HTTP 200 and the new event on [the homepage](https://clauderesets.com/), [the detail page](https://clauderesets.com/resets/2026-09-22-opus-5-5-reset), Korean homepage, RSS and JSON feeds. [The status API](https://clauderesets.com/api/v1/status) returned content revision `e484b7b2dab50265`, one reset offer expiring `2026-10-22`, and the unchanged 12 applied resets. Production publication ledger recorded revision 1 with content hash `83b69127142ae20a`; silent publication created no alert jobs.

Validation: `npm run check` passed typechecking, content validation, all 116 tests in 13 files, and the Worker build. Local Chrome checks covered desktop layout, English at 390 pixels wide, and Korean mobile dark mode. The previously date-dependent scheduled-notification test now queues a fresh fixture so it does not expire as the calendar advances.

All three X drafts fit 280 characters with URL shortening: 244, 248 and 247. No X post has been published and no campaign results exist yet.

Hypothesis: useful instructions for finding the saved reset will help Claude subscribers check their own eligibility. Channel: one organic X post. Destination: clauderesets.com. Desired conversion: reading the sourced offer and opening Claude Usage. That action is not instrumented; do not substitute clicks for proven redemptions.

Optional window: 48 hours after publication. Ask for actual impressions, link clicks and relevant replies, with the post URL and capture time. Current values are unavailable, not zero. No tracking was added.

Proposed decision rule: keep the practical update format if users report successfully finding the card; clarify instructions if replies show confusion; correct or stop promoting the offer if Anthropic withdraws it or the expiry passes. No performance or acquisition claim is established by shipping this update.

## October 8, 2026: per-reset beg totals

The live reaction API showed 18 on the board before the change. The old counter was site-wide, so those 18 are carried forward on the current banked reset rather than claimed as historically timestamped reactions since September 22. The existing SQL counter remains in place and is mapped to that event; subsequent reset IDs get separate counters and cooldowns.

Migration 0007 and Worker version `eda4ac71-afa9-4176-94d9-58510cb25c44` are live. The public API returns the current event ID, count 18, and its saved total. The homepage archive and detail page display 18 begs. All 138 tests passed, including rollover, stale-page rejection, preserved history, correction and backfill stability, and concurrent-click protection. New-reset rollover was verified with local fixtures; no fake reset or test reaction was published to production.

The October 8 X copy remains DRAFTED. Hypothesis: explaining the banked reset and its visible community counter encourages readers to participate. A later counter increase measures accepted reactions, not unique people or attributed X conversions. If Mike shares a post URL and results after 48 hours, compare real clicks, replies and counter changes; no follow-up or tracking is scheduled.
