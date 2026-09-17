// Claude Resets — Cloudflare Worker entry point (Hono).

import { Hono } from 'hono';
import type { Context } from 'hono';
import { buildCalendar } from './domain/calendar';
import { findEvent, loadContent, otherAnnouncements, publishedEvents, sortEventsDesc, withdrawnResets } from './domain/content';
import { filtersToQuery, parseFilters } from './domain/filters';
import { computeStatus } from './domain/service';
import { siteConfig, type Env } from './env';
import { isLocale, type Locale } from './i18n';
import { drainPushJobs } from './push/delivery';
import { readCount } from './reactions';
import { admin } from './routes/admin';
import { api } from './routes/api';
import { feeds } from './routes/feeds';
import { mcp } from './routes/mcp';
import { meta } from './routes/meta';
import { push } from './routes/push';
import { reactions } from './routes/reactions';
import { cachedHtml } from './util/http';
import { ApiDocsPage, McpDocsPage } from './views/docs';
import { HomePage, type HomeModel } from './views/home';
import { makeContext, type PageContext } from './views/layout';
import { AboutPage, NotFoundPage, PrivacyPage, ResetPage, SourcesPage, SupportPage } from './views/pages';

type App = Hono<{ Bindings: Env }>;
type Ctx = Context<{ Bindings: Env }>;

const app: App = new Hono<{ Bindings: Env }>({ strict: false });

// ---------- security headers ----------
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

app.use('*', async (c, next) => {
  await next();
  const h = c.res.headers;
  if (!h.has('content-security-policy') && (h.get('content-type') ?? '').includes('text/html')) h.set('content-security-policy', CSP);
  h.set('x-content-type-options', 'nosniff');
  h.set('referrer-policy', 'strict-origin-when-cross-origin');
  h.set('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  if (!c.req.path.startsWith('/api/') && !c.req.path.startsWith('/mcp')) h.set('x-frame-options', 'DENY');
});

// ---------- sub-apps ----------
app.route('/api/v1/reactions', reactions);
app.route('/api/v1/push', push);
app.route('/api', api);
app.route('/mcp', mcp);
app.route('/admin', admin);
app.route('/', feeds);
app.route('/', meta);

// ---------- pages ----------
const PREFIXED_LOCALES: Locale[] = ['zh-CN', 'zh-TW', 'ja', 'ko'];

function pageContext(c: Ctx, locale: Locale, path: string, query = ''): PageContext {
  return makeContext({ locale, cfg: siteConfig(c.env), content: loadContent(), path, query, now: new Date() });
}

/** Register a page at its English path and under each locale prefix (explicit routes, no regex ambiguity). */
function page(path: string, handler: (c: Ctx, locale: Locale) => Promise<Response> | Response): void {
  app.get(path, (c) => handler(c, 'en'));
  for (const locale of PREFIXED_LOCALES) {
    app.get(`/${locale}${path === '/' ? '' : path}`, (c) => handler(c, locale));
  }
}

async function safeBegCount(c: Ctx): Promise<number | null> {
  try {
    if (!c.env.DB) return null;
    return await readCount(c.env.DB);
  } catch (err) {
    console.error('beg count unavailable', err);
    return null;
  }
}

page('/', async (c, locale) => {
  const { filters } = parseFilters((k) => c.req.query(k));
  const query = filtersToQuery(filters);
  const ctx = pageContext(c, locale, '/', query);
  const content = ctx.content;
  const status = computeStatus(content, filters, ctx.now);
  const order = { primary: 0, additional: 1, context: 2, optional: 3 } as const;
  const model: HomeModel = {
    filters,
    filtered: status.filtered,
    stats: status.stats,
    calendar: buildCalendar(status.filtered, ctx.now, content.coverageStart),
    announced: status.announced ? [status.announced] : [],
    others: sortEventsDesc(otherAnnouncements(content.events)),
    withdrawn: sortEventsDesc(withdrawnResets(content.events)),
    previewSources: content.sources.filter((s) => s.priority === 'primary' || s.priority === 'additional').sort((a, b) => order[a.priority] - order[b.priority]),
    sourceById: new Map(content.sources.map((s) => [s.id, s])),
    begCount: await safeBegCount(c),
  };
  const html = (<HomePage ctx={ctx} model={model} />).toString();
  const minute = Math.floor(ctx.now.getTime() / 60_000);
  return cachedHtml(c, `<!doctype html>${html}`, `home:${locale}:${content.revision}:${query}:${minute}:${model.begCount}`, 60);
});

page('/sources', (c, locale) => {
  const ctx = pageContext(c, locale, '/sources');
  return cachedHtml(c, `<!doctype html>${(<SourcesPage ctx={ctx} />).toString()}`, `sources:${locale}:${ctx.content.revision}`, 300);
});
page('/support', (c, locale) => {
  const ctx = pageContext(c, locale, '/support');
  return cachedHtml(c, `<!doctype html>${(<SupportPage ctx={ctx} />).toString()}`, `support:${locale}:${ctx.content.revision}:${ctx.cfg.supportUrl}`, 300);
});
page('/about', (c, locale) => {
  const ctx = pageContext(c, locale, '/about');
  return cachedHtml(c, `<!doctype html>${(<AboutPage ctx={ctx} />).toString()}`, `about:${locale}:${ctx.content.revision}`, 300);
});
page('/privacy', (c, locale) => {
  const ctx = pageContext(c, locale, '/privacy');
  return cachedHtml(c, `<!doctype html>${(<PrivacyPage ctx={ctx} />).toString()}`, `privacy:${locale}:${ctx.content.revision}`, 300);
});
page('/resets/:id', (c, locale) => {
  const id = c.req.param('id');
  const content = loadContent();
  const e = id ? findEvent(publishedEvents(content.events), id) : undefined;
  if (!e) return notFound(c, locale);
  const ctx = pageContext(c, locale, `/resets/${e.id}`);
  const related = (e.relatedEventIds ?? []).map((rid) => findEvent(publishedEvents(content.events), rid)).filter((x): x is NonNullable<typeof x> => !!x);
  const sourceById = new Map(content.sources.map((s) => [s.id, s]));
  return cachedHtml(c, `<!doctype html>${(<ResetPage ctx={ctx} e={e} related={related} sourceById={sourceById} />).toString()}`, `reset:${locale}:${e.id}:${content.revision}`, 300);
});
page('/api/docs', (c, locale) => {
  const ctx = pageContext(c, locale, '/api/docs');
  return cachedHtml(c, `<!doctype html>${(<ApiDocsPage ctx={ctx} />).toString()}`, `apidocs:${locale}:${ctx.cfg.siteUrl}`, 300);
});
page('/mcp/docs', (c, locale) => {
  const ctx = pageContext(c, locale, '/mcp/docs');
  return cachedHtml(c, `<!doctype html>${(<McpDocsPage ctx={ctx} />).toString()}`, `mcpdocs:${locale}:${ctx.cfg.siteUrl}`, 300);
});

function notFound(c: Ctx, locale: Locale): Response {
  const ctx = pageContext(c, locale, c.req.path);
  return cachedHtml(c, `<!doctype html>${(<NotFoundPage ctx={ctx} />).toString()}`, 'nf', 0, 404);
}

app.notFound((c) => {
  if (c.req.path.startsWith('/api/') || c.req.path.startsWith('/mcp')) {
    return c.json({ type: 'about:blank', title: 'Not Found', status: 404, code: 'not_found', detail: 'No such endpoint.' }, 404, { 'content-type': 'application/problem+json; charset=utf-8' });
  }
  const m = c.req.path.match(/^\/(zh-CN|zh-TW|ja|ko)(\/|$)/);
  return notFound(c, m && isLocale(m[1]) ? m[1] : 'en');
});

app.onError((err, c) => {
  console.error('unhandled error', err);
  if (c.req.path.startsWith('/api/') || c.req.path.startsWith('/mcp')) {
    return c.json({ type: 'about:blank', title: 'Internal Server Error', status: 500, code: 'internal', detail: 'Something went wrong.' }, 500, { 'content-type': 'application/problem+json; charset=utf-8' });
  }
  return c.html('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Error</title><link rel="stylesheet" href="/styles.css"></head><body><main class="page"><h1>Something went wrong</h1><p><a href="/">Back to the tracker</a></p></main></body></html>', 500);
});

export { app };

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      drainPushJobs(env, { limit: 50 })
        .then((r) => console.log('push drain', JSON.stringify(r)))
        .catch((err) => console.error('push drain failed', err)),
    );
  },
};
