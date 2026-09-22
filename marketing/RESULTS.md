# Verification and optional measurement

September 22, 2026: deployed implementation commit `cfd1e49` as Cloudflare Worker version `f3774621-e28a-476e-826e-a1f3757655d1`. The public homepage was inspected in Chrome and shows the Opus 5.5 saved-reset card with October 22, 2026 expiry.

Public checks returned HTTP 200 and the new event on [the homepage](https://clauderesets.com/), [the detail page](https://clauderesets.com/resets/2026-09-22-opus-5-5-reset), Korean homepage, RSS and JSON feeds. [The status API](https://clauderesets.com/api/v1/status) returned content revision `e484b7b2dab50265`, one reset offer expiring `2026-10-22`, and the unchanged 12 applied resets. Production publication ledger recorded revision 1 with content hash `83b69127142ae20a`; silent publication created no alert jobs.

Validation: `npm run check` passed typechecking, content validation, all 116 tests in 13 files, and the Worker build. Local Chrome checks covered desktop layout, English at 390 pixels wide, and Korean mobile dark mode. The previously date-dependent scheduled-notification test now queues a fresh fixture so it does not expire as the calendar advances.

All three X drafts fit 280 characters with URL shortening: 244, 248 and 247. No X post has been published and no campaign results exist yet.

Hypothesis: useful instructions for finding the saved reset will help Claude subscribers check their own eligibility. Channel: one organic X post. Destination: clauderesets.com. Desired conversion: reading the sourced offer and opening Claude Usage. That action is not instrumented; do not substitute clicks for proven redemptions.

Optional window: 48 hours after publication. Ask for actual impressions, link clicks and relevant replies, with the post URL and capture time. Current values are unavailable, not zero. No tracking was added.

Proposed decision rule: keep the practical update format if users report successfully finding the card; clarify instructions if replies show confusion; correct or stop promoting the offer if Anthropic withdraws it or the expiry passes. No performance or acquisition claim is established by shipping this update.
