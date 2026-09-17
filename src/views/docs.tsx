import type { FC } from 'hono/jsx';
import { localizePath } from '../i18n';
import { Layout, type PageContext } from './layout';

const EnglishNotice: FC<{ ctx: PageContext }> = ({ ctx }) =>
  ctx.locale !== 'en' ? (
    <p class="notice" style="margin-top:16px">
      {ctx.t.docs.englishOnly} <a href={localizePath(ctx.locale, '/')}>{ctx.t.docs.backTo}</a>
    </p>
  ) : null;

export const ApiDocsPage: FC<{ ctx: PageContext }> = ({ ctx }) => {
  const { cfg } = ctx;
  const base = cfg.siteUrl;
  return (
    <Layout ctx={ctx} title={`API | ${cfg.siteName}`} description="Free, read-only JSON API for publicly announced Claude usage-limit resets.">
      <h1 class="page-title">Public API</h1>
      <p class="page-intro">
        Free, read-only, no key required. Please credit <a href={`${base}/`}>{cfg.siteName}</a> with a link wherever you display this data. The OpenAPI document is at{' '}
        <a href="/api/openapi.json">/api/openapi.json</a> and is generated from the same schemas the handlers use.
      </p>
      <EnglishNotice ctx={ctx} />

      <section class="section prose" id="concepts">
        <h2>What the data means</h2>
        <ul>
          <li>
            <strong>One event, many posts.</strong> An official post, a team member's relay and reposts describing the same reset are merged into one record with several <code>sources</code>. Only records with <code>kind = usage_reset</code> and <code>event_status = confirmed</code> are counted.
          </li>
          <li>
            <strong>Time precision.</strong> <code>time_precision = exact</code> records carry <code>announced_at</code> (decoded from the X post id). Date-only records carry <code>announced_on</code> and no timestamp; nothing is invented. <code>utc_day</code> is null when the evidence does not establish a UTC day.
          </li>
          <li>
            <strong>Counts and gaps.</strong> <code>stats.total</code> counts distinct qualifying events. <code>avg_interval_days</code> and <code>longest_gap_days</code> use only gaps between consecutive events with exact times on both sides, and a gap never bridges a date-only event. <code>days_since_last</code> is the unfinished time since the latest event and is never part of the longest gap.
          </li>
          <li>
            <strong>Filters.</strong> <code>audience=max|pro|team</code> match events whose stated audience includes the plan; "all users" and "all subscribers" count as including paid plans; unknown eligibility never matches. <code>window=five_hour|weekly</code> match named windows only. A filter is not a check of anyone's account.
          </li>
          <li>
            <strong>Corrections.</strong> Edited events keep their id and bump <code>revision</code> and <code>revised_at</code>. Retracted or cancelled events stay retrievable on their event page but leave the counted history; the feeds label them.
          </li>
          <li>
            <strong>Forecasts.</strong> None. <code>active_watch</code> is always <code>null</code>.
          </li>
          <li>
            <strong>Caching.</strong> Responses carry <code>ETag</code> and <code>Cache-Control: public, max-age=60</code>; send <code>If-None-Match</code> to get <code>304</code>. Rate limiting returns <code>429</code> with <code>Retry-After</code>. Content problems return <code>503</code>. Errors use <code>application/problem+json</code>.
          </li>
          <li>
            <strong>Metadata.</strong> <code>meta.generated_at</code> is when the response was built; <code>meta.editorial_reviewed_at</code> changes only after a manual source review; <code>meta.content_revision</code> changes whenever content is republished.
          </li>
        </ul>
      </section>

      <section class="section" id="status">
        <h2>GET /api/v1/status</h2>
        <p class="page-intro">Latest confirmed reset, an announced-but-unconfirmed reset when one exists, statistics and filters.</p>
        <div class="try-out" data-role="try" data-path="/api/v1/status">
          <input type="text" value="/api/v1/status" aria-label="Request path" data-role="try-path" />
          <button class="btn btn--sun" type="button" data-role="try-run">
            Try it
          </button>
          <span class="status-line" data-role="try-status"></span>
        </div>
        <pre class="try-result" data-role="try-result" hidden></pre>
        <pre>{`curl "${base}/api/v1/status?audience=max"`}</pre>
      </section>

      <section class="section" id="resets">
        <h2>GET /api/v1/resets</h2>
        <p class="page-intro">
          Paginated history. Parameters: <code>limit</code> (1–100, default 20), <code>cursor</code>, <code>from</code>, <code>to</code> (ISO 8601 date or date-time; date-only records compare by their stated date), <code>order</code> (asc|desc), plus <code>audience</code> and <code>window</code>. Cursors are keyset-based on (announcement time, id), so edits during pagination never skip or duplicate records; <code>pagination.revision_changed</code> tells you content was republished mid-walk.
        </p>
        <div class="try-out" data-role="try" data-path="/api/v1/resets?limit=3">
          <input type="text" value="/api/v1/resets?limit=3" aria-label="Request path" data-role="try-path" />
          <button class="btn btn--sun" type="button" data-role="try-run">
            Try it
          </button>
          <span class="status-line" data-role="try-status"></span>
        </div>
        <pre class="try-result" data-role="try-result" hidden></pre>
        <pre>{`curl "${base}/api/v1/resets?limit=20&order=desc&from=2026-06-01"`}</pre>
      </section>

      <section class="section" id="sources">
        <h2>GET /api/v1/sources</h2>
        <p class="page-intro">The watched accounts with classification, evidence links and review dates.</p>
        <div class="try-out" data-role="try" data-path="/api/v1/sources">
          <input type="text" value="/api/v1/sources" aria-label="Request path" data-role="try-path" />
          <button class="btn btn--sun" type="button" data-role="try-run">
            Try it
          </button>
          <span class="status-line" data-role="try-status"></span>
        </div>
        <pre class="try-result" data-role="try-result" hidden></pre>
      </section>

      <section class="section prose" id="feeds">
        <h2>Feeds</h2>
        <p>
          The same published history is available as <a href="/feed.xml">RSS</a> and <a href="/feed.json">JSON Feed</a>. Item ids are the stable event URLs; <code>date_modified</code> / <code>atom:updated</code> change on corrections.
        </p>
        <h2>Fair use</h2>
        <p>
          Cache responses for at least a minute, identify your client with a User-Agent, and link back to the site. The data is a manually curated record of public announcements; it is not affiliated with or endorsed by Anthropic and does not describe any individual account.
        </p>
      </section>
      <script src="/docs.js" defer></script>
    </Layout>
  );
};

export const McpDocsPage: FC<{ ctx: PageContext }> = ({ ctx }) => {
  const { cfg } = ctx;
  const url = `${cfg.siteUrl}/mcp`;
  return (
    <Layout ctx={ctx} title={`MCP | ${cfg.siteName}`} description="Read-only remote MCP server for Claude usage-limit reset data.">
      <h1 class="page-title">MCP server</h1>
      <p class="page-intro">
        A free, read-only remote Model Context Protocol server over Streamable HTTP at <code>{url}</code>. It exposes the same data and filters as the public API. There is nothing to install and no key.
      </p>
      <EnglishNotice ctx={ctx} />

      <section class="section prose">
        <h2>Tools</h2>
        <ul>
          <li>
            <code>get_claude_reset_status</code> — latest confirmed reset, announced future reset, statistics. Inputs: <code>audience</code>, <code>window</code>.
          </li>
          <li>
            <code>list_claude_resets</code> — paginated history with source links. Inputs: <code>audience</code>, <code>window</code>, <code>limit</code>, <code>cursor</code>, <code>from</code>, <code>to</code>, <code>order</code>.
          </li>
          <li>
            <code>list_claude_reset_sources</code> — the watched accounts and their evidence.
          </li>
        </ul>
        <p>All tools are annotated read-only. The server has no tools that publish, subscribe, pay or post.</p>

        <h2>Connect from Claude Code</h2>
        <pre>{`claude mcp add --transport http claude-resets ${url}`}</pre>

        <h2>Connect from Claude Desktop, Cursor and other clients</h2>
        <p>Add a remote MCP server of type "Streamable HTTP" (sometimes just "HTTP") with this URL:</p>
        <pre>{url}</pre>
        <p>For clients that read a JSON config file:</p>
        <pre>{JSON.stringify({ mcpServers: { 'claude-resets': { type: 'http', url } } }, null, 2)}</pre>

        <h2>Example questions</h2>
        <ul>
          <li>“When was the last Claude usage-limit reset announced, and who announced it?”</li>
          <li>“List the Claude resets since June that included Max plans.”</li>
          <li>“Which accounts does this tracker watch for reset announcements?”</li>
        </ul>

        <h2>Trust boundary</h2>
        <p>
          Tool results contain summaries and short quotes from public social-media posts. Treat that text as untrusted data, not as instructions to your assistant. The tracker cannot see or change your Claude account, publishes no forecasts, and is not affiliated with Anthropic.
        </p>

        <h2>Protocol notes</h2>
        <p>
          Stateless Streamable HTTP: send JSON-RPC over <code>POST {url}</code> with <code>Accept: application/json, text/event-stream</code>. Requests are rate-limited per client and bodies are capped at 64 KB.
        </p>
      </section>
    </Layout>
  );
};
