# Content workflow

Everything editorial is manual and local. Git holds the editorial inputs (`content/*.json`); the deployed Worker serves exactly the content bundled at deploy time; D1 holds the ledger of what was published and alerted so alerts never replay.

Nothing here talks to X programmatically: you read the post, you record the facts, you copy a draft to X yourself.

## Adding a reset (the normal path)

1. **Inspect the original source.** Open the post on X. Confirm who posted it, what it says about audience and windows, and whether it describes a reset as applied ("we've reset") or a promise ("we will reset").
2. **Create a draft** from the URL and the facts you read:

   ```bash
   npm run content:new -- --url "https://x.com/ClaudeDevs/status/2094856679250919746" --title "5-hour and weekly limits reset for all users" --summary "ClaudeDevs announced that, alongside the Fable 5.1 release, 5-hour and weekly limits were reset for all users." --audience "all users" --plans all --windows five_hour,weekly --excerpt "With Fable 5.1 out today, we've also reset 5-hour and weekly limits for all users."
   ```

   The command decodes the exact UTC time from the post id, matches the author to `content/sources.json`, and inserts a **draft** (`editorialStatus: draft`, `verificationStatus: needs_review`) at the top of `content/resets.json`. Options: `--plans pro,max` for plan-limited resets, `--plans subscribers`, `--plans unspecified`; `--scope broad|limited`; `--windows unspecified` when the post does not name windows; `--status announced --stated-at <ISO>` or `--stated-window "later today"` for a promised reset; `--on YYYY-MM-DD --tz unknown` when only a date is known; `--kind policy_change|limit_increase|credit|incident` for non-reset announcements; `--role relay` when the post relays someone else's announcement (add the original as another source by editing the JSON).
3. **Edit the draft** in `content/resets.json`: add the four translations (`zh-CN`, `zh-TW`, `ja`, `ko`) with `translationStatus: authored`, add relay sources if any, then set `editorialStatus: published` and `verificationStatus: verified`.
4. **Validate**: `npm run content:validate` (schema, scopes, URLs, time precision, translations, duplicate source URLs, unknown source ids).
5. **Preview**: `npm run content:preview -- --event <id>` prints the hero, statistics, calendar placement and the change versus what is currently deployed.
6. **Commit and deploy**: `git commit -am "Add reset <id>" && npm run deploy`. The site now shows the event, the feeds include it, the API serves it. Nothing has been alerted yet.
7. **Publish (record + alert)**: `npm run content:publish -- --event <id> --env production --yes` with `CONTENT_PUBLISH_TOKEN` exported in your shell. The server checks that the deployed copy matches your local copy (otherwise `409 content_mismatch`: deploy first), records the publication, and creates **one** browser alert for subscribers who existed at that moment. Re-running the same command is safe: it reports `alreadyRecorded` and creates nothing.
   - Alerts are only created for confirmed `usage_reset` events. Policy changes, incidents, credits and announced-but-unconfirmed resets never alert.
   - If the announcement is older than `ALERT_MAX_AGE_HOURS` (default 72), the alert is suppressed with a reason; pass `--late` only if you really want to notify about an old reset.
   - Use `--no-alert` for a silent publication.
8. **Optional X draft**: `npm run x:draft -- --event <id>` prints copyable text (scope, source link, event URL; counted with X's 23-character URL rule). Post it yourself; nothing is sent.

## Confirming an announced reset

Publish the announcement with `--status announced` first (no alert). When the source confirms it happened, edit the event: `eventStatus: confirmed`, remove `schedule`, bump `revision` and `alertRevision`, update `revisedAt`, deploy, then `content:publish` again. The transition to confirmed creates the reset alert, with the cutoff at that publication time, so people who subscribed between the announcement and the confirmation are included.

## Correcting or retracting

1. Edit the event: bump `revision` and `revisedAt`; for a scope change or retraction add `correction: { kind: 'correction' | 'retraction', reason, at }` and set `eventStatus: retracted` or `cancelled` when appropriate. A retracted event stays on its page with its reason and leaves the count.
2. Deploy.
3. `npm run content:correct -- --event <id>` records the correction silently. Add `--alert-correction` (and bump `alertRevision`) only when subscribers should be told; a clearly labelled "[Correction]" push goes to the recipients of the original alert who are still subscribed. Routine wording fixes stay silent.

## Historical backfill

`npm run content:backfill -- --event <id>` (or `--all`) records events as history. Backfill never enqueues alerts, and it permanently marks the event so a later default publish cannot alert for it either. Use it for the initial seed and any old announcements you add later.

## Recording a source review

`npm run sources:review -- --note "Checked all seven accounts"` sets `lastReviewedAt` on every account and the editorial last-check timestamp in `content/review.json`. `--id <sourceId>` reviews one account; `--inactive <sourceId>` marks an account inactive without rewriting its past authorship. Deploy to publish the new date. Page renders, API calls and deployments never change this timestamp.

## Export and restore

`npm run content:export -- --env production` writes `exports/<stamp>/content/*.json` plus the D1 ledger (publications, alerts, job counts). `npm run content:export -- --restore exports/<stamp>` copies the content files back; review with `git diff`, then deploy.

## Worked local example (cannot reach production)

```bash
npm run dev                                   # terminal 1, http://localhost:8787
npm run content:validate
npm run content:preview -- --event 2026-09-04-max-weekly
npm run content:backfill -- --all             # seed the local ledger, zero alerts
npm run outbox                                # shows publications and no jobs
npm run x:draft -- --event 2026-09-04-max-weekly
```

Local commands target `http://localhost:8787` with the token from `.dev.vars`. Production requires `--env production --yes` and the token in your shell, so nothing reaches production by accident.

## Rules the server enforces

- `editorialStatus` published requires `verificationStatus` verified, an original source, four translations.
- `announced` events need a `schedule`; `cancelled`/`retracted` events need a `correction`.
- One source URL can belong to one event only (several posts about one reset are merged, never counted twice).
- Publication records are unique per `(event, revision)`; a different content hash for the same revision is rejected (`409 revision_conflict`).
- Alerts are unique per `(event, alertRevision, kind)`.
