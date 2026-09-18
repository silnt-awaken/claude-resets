import type { Context } from 'hono';
import { hashString } from '../domain/content';

export interface ProblemBody {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  parameter?: string;
}

const TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

/** RFC 9457 problem response with a stable error shape. */
export function problem(c: Context, status: number, code: string, detail: string, extra: { parameter?: string; retryAfter?: number } = {}): Response {
  const body: ProblemBody = { type: 'about:blank', title: TITLES[status] ?? 'Error', status, code, detail };
  if (extra.parameter) body.parameter = extra.parameter;
  const headers: Record<string, string> = { 'content-type': 'application/problem+json; charset=utf-8', 'cache-control': 'no-store' };
  if (extra.retryAfter != null) headers['retry-after'] = String(Math.max(1, Math.ceil(extra.retryAfter)));
  return new Response(JSON.stringify(body), { status, headers });
}

/** JSON response with ETag / 304 handling and short public caching. */
export function cachedJson(c: Context, body: unknown, etagSeed: string, maxAge = 60): Response {
  const json = JSON.stringify(body);
  const etag = `W/"${hashString(etagSeed)}"`;
  const inm = c.req.header('if-none-match');
  const headers: Record<string, string> = {
    etag,
    'cache-control': `public, max-age=${maxAge}, stale-while-revalidate=${maxAge * 2}`,
    vary: 'Accept-Encoding',
  };
  if (inm && inm.split(',').map((s) => s.trim()).includes(etag)) {
    return new Response(null, { status: 304, headers });
  }
  headers['content-type'] = 'application/json; charset=utf-8';
  return new Response(json, { status: 200, headers });
}

/** HTML response with short public caching and an ETag. */
export function cachedHtml(c: Context, html: string, etagSeed: string, maxAge = 60, status = 200): Response {
  const etag = `W/"${hashString(etagSeed)}"`;
  const inm = c.req.header('if-none-match');
  const headers: Record<string, string> = {
    etag,
    'cache-control': status === 200 ? `public, max-age=${maxAge}, stale-while-revalidate=${maxAge * 2}` : 'no-store',
    vary: 'Accept-Encoding',
  };
  if (status === 200 && inm && inm.split(',').map((s) => s.trim()).includes(etag)) {
    return new Response(null, { status: 304, headers });
  }
  headers['content-type'] = 'text/html; charset=utf-8';
  return new Response(html, { status, headers });
}

export function clientIp(c: Context): string {
  return c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
}

export async function readJson(c: Context, maxBytes = 8192): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  const len = Number(c.req.header('content-length') ?? '0');
  if (len > maxBytes) return { ok: false, error: 'payload too large' };
  const text = await c.req.text();
  if (text.length > maxBytes) return { ok: false, error: 'payload too large' };
  if (!text.trim()) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, error: 'invalid JSON' };
  }
}

export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i]! ^ bb[i]!;
  return diff === 0;
}
