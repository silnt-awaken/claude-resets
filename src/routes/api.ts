import { Hono } from 'hono';
import { loadContent } from '../domain/content';
import { parseFilters } from '../domain/filters';
import { computeStatus, listResets, parseListOptions } from '../domain/service';
import { siteConfig, type Env } from '../env';
import { clientIp, cachedJson, problem } from '../util/http';
import { rateLimit } from '../util/ratelimit';
import { buildMeta, buildOpenApi, serializeEvent, serializeSource, serializeStats, type ListResponse, type SourcesResponse, type StatusResponse } from './api-schemas';

export const api = new Hono<{ Bindings: Env }>();

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'If-None-Match, Content-Type',
  'access-control-max-age': '86400',
};

api.use('/v1/*', async (c, next) => {
  if (c.req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  const rl = rateLimit(`api:${clientIp(c)}`, 120, 60_000);
  if (!rl.allowed) return problem(c, 429, 'rate_limited', 'Too many requests from this client. Please slow down.', { retryAfter: rl.retryAfterSeconds });
  await next();
  for (const [k, v] of Object.entries(CORS_HEADERS)) c.res.headers.set(k, v);
});

function contentOr503(c: Parameters<typeof problem>[0]) {
  try {
    return { content: loadContent(), response: null };
  } catch (err) {
    console.error('content unavailable', err);
    return { content: null, response: problem(c, 503, 'content_unavailable', 'Reset data is temporarily unavailable.') };
  }
}

api.get('/v1/status', (c) => {
  const { content, response } = contentOr503(c);
  if (!content) return response!;
  const { filters, errors } = parseFilters((k) => c.req.query(k));
  if (errors.length) return problem(c, 400, 'invalid_parameter', errors[0]!.message, { parameter: errors[0]!.parameter });
  const now = new Date();
  const cfg = siteConfig(c.env);
  const status = computeStatus(content, filters, now);
  const body: StatusResponse = {
    data: {
      latest_reset: status.latest ? serializeEvent(status.latest, cfg.siteUrl) : null,
      latest_ambiguous: status.latestAmbiguous ? status.latestAmbiguous.map((e) => serializeEvent(e, cfg.siteUrl)) : null,
      announced_reset: status.announced ? serializeEvent(status.announced, cfg.siteUrl) : null,
      active_watch: null,
      stats: serializeStats(status.stats),
      filters,
    },
    meta: buildMeta(content, now),
  };
  const minute = Math.floor(now.getTime() / 60_000);
  return cachedJson(c, body, `status:${content.revision}:${filters.audience}:${filters.window}:${minute}`, 60);
});

api.get('/v1/resets', (c) => {
  const { content, response } = contentOr503(c);
  if (!content) return response!;
  const { filters, errors } = parseFilters((k) => c.req.query(k));
  const { options, errors: listErrors } = parseListOptions((k) => c.req.query(k));
  const all = [...errors, ...listErrors];
  if (all.length) return problem(c, 400, 'invalid_parameter', all[0]!.message, { parameter: all[0]!.parameter });
  const result = listResets(content, filters, options);
  if (result.error) return problem(c, 400, 'invalid_parameter', result.error.message, { parameter: result.error.parameter });
  const now = new Date();
  const cfg = siteConfig(c.env);
  const body: ListResponse = {
    data: result.items.map((e) => serializeEvent(e, cfg.siteUrl)),
    pagination: { has_more: result.hasMore, next_cursor: result.nextCursor, revision_changed: result.revisionChanged },
    meta: buildMeta(content, now),
  };
  const seed = `resets:${content.revision}:${JSON.stringify({ filters, options })}`;
  return cachedJson(c, body, seed, 60);
});

api.get('/v1/sources', (c) => {
  const { content, response } = contentOr503(c);
  if (!content) return response!;
  const now = new Date();
  const body: SourcesResponse = { data: content.sources.map(serializeSource), meta: buildMeta(content, now) };
  return cachedJson(c, body, `sources:${content.revision}`, 300);
});

api.get('/openapi.json', (c) => {
  const cfg = siteConfig(c.env);
  return cachedJson(c, buildOpenApi(cfg.siteUrl), `openapi:${cfg.siteUrl}:1`, 3600);
});
