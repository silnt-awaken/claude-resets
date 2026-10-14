# Telegram updates

The destination is the existing Claude Resets Telegram community. Live release summaries and links to our own X posts use the Telegram Bot API. No X API, login cookies or scraping are involved.

Connected on October 8, 2026: `@ClaudeResetsUpdatesBot` is a regular member of `@clauderesets`. The owner-only webhook was verified with no pending updates or errors. Worker version `be12aedd-eb5f-4844-9a8f-b83f89dc0502` sent the first live release summary once (message 37); repeating `announce` produced no second delivery. All 152 tests passed. Evidence is in `outputs/telegram/live-verification.json` and `outputs/telegram/live-release.jpg`.

October 9, 2026: the Claude Code Projects waitlist notice is live in all five languages on Worker version `7f36c4fe-9c2d-4d9f-a0a6-390acf49aa74`. Release `2026-10-09-claude-code-projects-waitlist` was delivered once as Telegram message 38. The webhook was refreshed and externally verified with zero pending updates and no errors; unauthenticated requests returned 401 and an authenticated empty update returned 200 without sending a message. All 153 tests passed. Desktop and mobile checks found the official label, translations and links correct, with no mobile horizontal overflow. Evidence is in `outputs/projects-2026-10-09/`.

## Releases

Edit `content/release.json` with a new unique ID and concise user-facing changes for a meaningful release. Set `announce: false` for housekeeping. `npm run deploy` deploys, checks `/api/v1/build` on the public domain against the exact Cloudflare version and bundled release ID, then queues the summary. It does not announce failed or unverified deployments. Reusing a release ID suppresses duplicates, including retries and redeploys.

The bot announces only what is written in the release notes; it does not invent a summary from commits. A direct `wrangler deploy` bypasses the announcement hook. `npm run telegram -- announce` can register the current verified live release afterward.

## Our X posts

In a private chat with the bot, the bound owner sends `/share https://x.com/clauderesets/status/<post-id>`. The link is queued for the community. Only the owner can use this command, and only @clauderesets links are accepted. Tracking parameters and x.com/twitter.com variations share the same deduplication key. The maintainer CLI also supports `npm run telegram -- share <URL>`.

Sharing is an explicit link submission, not automatic monitoring of X. The bot does not read or post to X.

## Connection and verification

Production secrets: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_OWNER_USER_ID`. Public variables: `TELEGRAM_ENABLED`, `TELEGRAM_CHAT_ID`, `TELEGRAM_CHANNEL_URL`. Tokens stay in the ignored production secret file and Cloudflare secrets; they must never be pasted into issue text, logs or chat.

Add the bot as a normal member if the destination is a group and normal members may send messages. A broadcast channel requires only its Post Messages admin permission. Register `/telegram/webhook` with a random Telegram `secret_token`, and allow only message updates. Bind the owner's numeric Telegram ID from their explicit private `/start` to this bot before activation.

After deploying the Worker and storing those three production secrets, `npm run telegram:connect` checks the bot and membership, adds the owner-only command menu, and registers and verifies the webhook. It does not send a public test message.

`npm run telegram -- status` shows connection state and the last 20 queued deliveries, without tokens. `drain` processes a batch. The existing cron also processes pending messages once a minute. Explicit rate-limit rejection is retried, up to six attempts. Telegram has no outgoing idempotency key: if the delivery response is lost or a sending lease expires, the record becomes `unknown` and is held for review rather than automatically resent. This avoids blind duplicate announcements; it cannot promise exactly-once delivery. Inspect the destination before resolving an unknown result.
