# Claude Resets

An independent tracker for publicly announced Claude usage-limit resets. Not affiliated with or endorsed by Anthropic.

- Hono + server-rendered JSX on Cloudflare Workers, D1 for reactions / push subscriptions / publication ledger, static assets from `public/`.
- Editorial content is versioned JSON in `content/`; publishing is a local command that talks to a private endpoint.
- Five locales (`/`, `/zh-CN`, `/zh-TW`, `/ja`, `/ko`), public JSON API, RSS + JSON feeds, read-only MCP server, Web Push browser alerts.

Live site: <https://clauderesets.com> · Updates: [@clauderesets on X](https://x.com/clauderesets)

If the tracker helps you, you can [tip for coffee](https://buymeacoffee.com/silntawaken). Tips never change reset access or Anthropic limits.

**Community goal + RESETS token** (Robinhood Chain): readers pool USDG, one contributor wins a month of Claude Max 20x by a verifiable block-hash draw; RESETS supply burns automatically on every published reset (the site's cron signs the burn with a dedicated burner wallet). Contract in `contracts/`, mechanics and launch steps in [docs/goal-and-token.md](docs/goal-and-token.md), roadmap in [docs/roadmap.md](docs/roadmap.md).

## Install and run

```bash
npm install            # Node 20+. If npm 10 fails with "edgesOut", use: npx -y npm@11 install
cp .dev.vars.example .dev.vars   # local secrets (git-ignored)
npm run db:migrate     # local D1 schema
npm run dev            # http://localhost:8787
```

`wrangler dev` serves the site with a local D1 database under `.wrangler/`. No Cloudflare account is needed for local development.

## Check

```bash
npm run typecheck      # Worker + scripts
npm run content:validate
npm test               # vitest inside the Workers runtime with a real local D1
npm run build          # wrangler deploy --dry-run
npm run check          # all of the above
npm run screenshots    # needs npm run dev in another terminal; writes screenshots/
npm run readiness      # what still needs owner configuration
```

## Deploy (Cloudflare)

1. `npx wrangler login`
2. `npx wrangler d1 create claude-resets` and put the returned id in `wrangler.jsonc` (`database_id`).
3. `npm run db:migrate:remote`
4. Set public vars in `wrangler.jsonc` (`SITE_URL` = your real https origin, `SUPPORT_URL`, optional links) and secrets: `npx wrangler secret put CONTENT_PUBLISH_TOKEN`, `npx wrangler secret put REACTION_SECRET`, and for browser alerts `npx wrangler secret put VAPID_PRIVATE_KEY` (generate with `npx tsx scripts/vapid-keys.ts`).
5. `npm run deploy`

The Worker runs on the free tier limits documented in `docs/operations.md`. The cron trigger (`*/2 * * * *`) drains push alerts.

## Editorial commands

| Command | What it does |
| --- | --- |
| `npm run content:new -- --url … --title … --summary … --audience … --plans … --windows …` | Creates a validated draft from a source post and your own reading of it |
| `npm run content:validate` | Validates every content file and cross-file rule |
| `npm run content:preview -- --event <id>` | Prints hero, statistics, calendar placement and the diff versus the deployed site |
| `npm run content:publish -- --event <id> [--env production --yes]` | Records the publication and creates the one-time alert |
| `npm run content:backfill -- --event <id> \| --all` | Imports history; alerts are impossible |
| `npm run content:correct -- --event <id> [--alert-correction]` | Records a correction, silently unless asked |
| `npm run sources:review -- --note "…"` | Records a real manual source review |
| `npm run content:export [-- --restore <dir>]` | Restorable snapshot of content + ledger |
| `npm run x:draft -- --event <id>` | Copyable X post text; nothing is sent |
| `npm run outbox [-- --drain]` | Ledger, alert jobs, optional manual delivery batch |

See `docs/content-workflow.md` for the full workflow, `docs/operations.md` for alerts, backups and limits, and `docs/launch-checklist.md` for what the owner still has to supply.

## Layout

```
content/        resets.json, sources.json, sponsors.json, research-queue.json, review.json
migrations/     D1 schema
public/         styles.css, app.js, theme.js, sw.js, docs.js, fonts/, icons/, manifest
scripts/        editorial and maintenance commands (tsx)
src/domain/     types, schema, content selectors, filters, stats, calendar, service
src/i18n/       five dictionaries (typed against en.ts)
src/push/       subscriptions, alert creation, delivery
src/routes/     api, feeds, mcp, push, reactions, admin, meta
src/views/      layout, home, pages, docs, components, icons (Hono JSX)
test/           vitest (Workers pool) suites and fixtures
docs/           reference audit, source evidence, workflow, operations, acceptance, launch checklist
```
