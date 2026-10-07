// Claude Resets — Cloudflare Worker entry point (Hono).

import { Hono } from 'hono';
import type { Context } from 'hono';
import { buildCalendar } from './domain/calendar';
import { findEvent, loadContent, openPerks, otherAnnouncements, publishedEvents, sortEventsDesc, withdrawnResets } from './domain/content';
import { filtersToQuery, parseFilters } from './domain/filters';
import { computeStatus } from './domain/service';
import { siteConfig, type Env } from './env';
import { isLocale, stripLocale, type Locale } from './i18n';
import { drainPushJobs } from './push/delivery';
import { readCount } from './reactions';
import { admin } from './routes/admin';
import { api } from './routes/api';
import { feeds } from './routes/feeds';
import { goal, goalAdmin, goalStatus, tickGoal } from './routes/goal';
import { GoalPage } from './views/goal';
import { mcp } from './routes/mcp';
import { meta } from './routes/meta';
import { push } from './routes/push';
import { reactions } from './routes/reactions';
import { cachedHtml } from './util/http';
import { ApiDocsPage, McpDocsPage } from './views/docs';
import { HomePage, type HomeModel } from './views/home';
import { makeContext, type PageContext } from './views/layout';
import { AboutPage, NotFoundPage, PrivacyPage, ResetPage, SourcesPage, SupportPage } from './views/pages';
import { PerksPage } from './views/perks';

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

/**
 * Pages that carry Google ads. AdSense supports only a strict nonce-based policy (its script domains change
 * over time): https://support.google.com/adsense/answer/16283098. 'unsafe-inline' and https: are fallbacks
 * that browsers ignore once a nonce and 'strict-dynamic' are present; nothing else here restricts the ad code.
 */
export function adsCsp(nonce: string): string {
  return [
    "object-src 'none'",
    `script-src 'nonce-${nonce}' 'unsafe-inline' 'unsafe-eval' 'strict-dynamic' https: http:`,
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; ');
}

function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

app.use('*', async (c, next) => {
  await next();
  const h = c.res.headers;
  if (!h.has('content-security-policy') && (h.get('content-type') ?? '').includes('text/html')) h.set('content-security-policy', CSP);
  h.set('x-content-type-options', 'nosniff');
  h.set('referrer-policy', 'strict-origin-when-cross-origin');
  if (c.req.url.startsWith('https://')) h.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
  h.set('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  if (!c.req.path.startsWith('/api/') && !c.req.path.startsWith('/mcp')) h.set('x-frame-options', 'DENY');
});

// ---------- sub-apps ----------
app.route('/api/v1/reactions', reactions);
app.route('/api/v1/push', push);
app.route('/api/v1/goal', goal);
app.route('/admin/goal', goalAdmin);
app.route('/api', api);
app.route('/mcp', mcp);
app.route('/admin', admin);
app.route('/', feeds);
app.route('/', meta);

// ---------- pages ----------
const PREFIXED_LOCALES: Locale[] = ['zh-CN', 'zh-TW', 'ja', 'ko'];

/** Build a page context. Ads (and with them a fresh CSP nonce) are on unless the page opts out. */
function pageContext(c: Ctx, locale: Locale, path: string, query = '', opts: { ads?: boolean } = {}): PageContext {
  const cfg = siteConfig(c.env);
  const ads = (opts.ads ?? true) && cfg.ads.enabled;
  return makeContext({ locale, cfg, content: loadContent(), path, query, now: new Date(), ads, nonce: ads ? newNonce() : null });
}

/**
 * Cached HTML for a page. The ETag seed also covers the ad configuration, so switching ads on or off never
 * serves a stale page. A 200 on an ad page carries the nonce policy matching its body; a 304 carries no
 * policy, so the browser keeps the cached body and the policy it arrived with together.
 */
function htmlPage(c: Ctx, ctx: PageContext, html: string, etagSeed: string, maxAge: number, status = 200): Response {
  const ads = ctx.cfg.ads;
  const seed = `${etagSeed}:${ctx.ads ? `ads:${ads.client}:${ads.slot ?? ''}` : 'noads'}`;
  const res = cachedHtml(c, `<!doctype html>${html}`, seed, maxAge, status);
  if (ctx.nonce && res.status !== 304) res.headers.set('content-security-policy', adsCsp(ctx.nonce));
  return res;
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
    offers: status.offers,
    perks: openPerks(content.perks, ctx.now),
    others: sortEventsDesc(otherAnnouncements(content.events)),
    withdrawn: sortEventsDesc(withdrawnResets(content.events)),
    previewSources: content.sources.filter((s) => s.priority === 'primary' || s.priority === 'additional').sort((a, b) => order[a.priority] - order[b.priority]),
    sourceById: new Map(content.sources.map((s) => [s.id, s])),
    begCount: await safeBegCount(c),
    goal: await goalStatus(c.env, ctx.now),
  };
  const html = (<HomePage ctx={ctx} model={model} />).toString();
  const minute = Math.floor(ctx.now.getTime() / 60_000);
  const goalSeed = model.goal.round ? `${model.goal.round.status}:${model.goal.round.raised_usd}:${model.goal.round.contributions}` : 'none';
  return htmlPage(c, ctx, html, `home:${locale}:${content.revision}:${query}:${minute}:${model.begCount}:${goalSeed}`, model.goal.enabled ? 20 : 60);
});

page('/goal', async (c, locale) => {
  // No ads where readers send money.
  const ctx = pageContext(c, locale, '/goal', '', { ads: false });
  const status = await goalStatus(c.env, ctx.now);
  return htmlPage(c, ctx, (<GoalPage ctx={ctx} status={status} />).toString(), `goal:${locale}:${JSON.stringify(status)}`, 30);
});
page('/perks', (c, locale) => {
  const ctx = pageContext(c, locale, '/perks');
  // Countdowns are rendered server-side, so the ETag moves with the minute like the homepage.
  const minute = Math.floor(ctx.now.getTime() / 60_000);
  return htmlPage(c, ctx, (<PerksPage ctx={ctx} />).toString(), `perks:${locale}:${ctx.content.revision}:${minute}`, 60);
});
page('/sources', (c, locale) => {
  const ctx = pageContext(c, locale, '/sources');
  return htmlPage(c, ctx, (<SourcesPage ctx={ctx} />).toString(), `sources:${locale}:${ctx.content.revision}`, 300);
});
page('/support', (c, locale) => {
  const ctx = pageContext(c, locale, '/support');
  return htmlPage(c, ctx, (<SupportPage ctx={ctx} />).toString(), `support:${locale}:${ctx.content.revision}:${ctx.cfg.supportUrl}`, 300);
});
page('/about', (c, locale) => {
  const ctx = pageContext(c, locale, '/about');
  return htmlPage(c, ctx, (<AboutPage ctx={ctx} />).toString(), `about:${locale}:${ctx.content.revision}`, 300);
});
page('/privacy', (c, locale) => {
  const ctx = pageContext(c, locale, '/privacy');
  return htmlPage(c, ctx, (<PrivacyPage ctx={ctx} />).toString(), `privacy:${locale}:${ctx.content.revision}`, 300);
});
page('/resets/:id', (c, locale) => {
  const id = c.req.param('id');
  const content = loadContent();
  const e = id ? findEvent(publishedEvents(content.events), id) : undefined;
  if (!e) return notFound(c, locale);
  const ctx = pageContext(c, locale, `/resets/${e.id}`);
  const related = (e.relatedEventIds ?? []).map((rid) => findEvent(publishedEvents(content.events), rid)).filter((x): x is NonNullable<typeof x> => !!x);
  const sourceById = new Map(content.sources.map((s) => [s.id, s]));
  return htmlPage(c, ctx, (<ResetPage ctx={ctx} e={e} related={related} sourceById={sourceById} />).toString(), `reset:${locale}:${e.id}:${content.revision}:${ctx.now.toISOString().slice(0, 10)}`, 300);
});
page('/api/docs', (c, locale) => {
  const ctx = pageContext(c, locale, '/api/docs');
  return htmlPage(c, ctx, (<ApiDocsPage ctx={ctx} />).toString(), `apidocs:${locale}:${ctx.cfg.siteUrl}`, 300);
});
page('/mcp/docs', (c, locale) => {
  const ctx = pageContext(c, locale, '/mcp/docs');
  return htmlPage(c, ctx, (<McpDocsPage ctx={ctx} />).toString(), `mcpdocs:${locale}:${ctx.cfg.siteUrl}`, 300);
});

function notFound(c: Ctx, locale: Locale): Response {
  const ctx = pageContext(c, locale, stripLocale(c.req.path).path, '', { ads: false });
  return htmlPage(c, ctx, (<NotFoundPage ctx={ctx} />).toString(), 'nf', 0, 404);
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
    ctx.waitUntil(
      tickGoal(env)
        .then((r) => console.log('goal tick', JSON.stringify(r)))
        .catch((err) => console.error('goal tick failed', err)),
    );
  },
};
