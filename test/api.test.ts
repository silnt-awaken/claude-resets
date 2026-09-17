import { afterEach, describe, expect, it } from 'vitest';
import { __setContentForTests, loadContent } from '../src/domain/content';
import { listResponseSchema, sourcesResponseSchema, statusResponseSchema, type ListResponse, type StatusResponse } from '../src/routes/api-schemas';
import { makeEvent, mixedScopeEvents, snapshotFor } from './fixtures';
import { json, request } from './helpers';

afterEach(() => __setContentForTests(null));

describe('GET /api/v1/status', () => {
  it('returns a schema-valid status with cache headers', async () => {
    const res = await request('/api/v1/status');
    expect(res.status).toBe(200);
    expect(res.headers.get('etag')).toMatch(/^W\//);
    expect(res.headers.get('cache-control')).toContain('max-age=60');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const body = (await res.json()) as StatusResponse;
    const parsed = statusResponseSchema.safeParse(body);
    expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
    expect(body.data.active_watch).toBeNull();
    expect(body.data.latest_reset?.id).toBe('2026-09-04-max-weekly');
    expect(body.data.stats.total).toBe(12);
    expect(body.meta.editorial_reviewed_at).toBe(loadContent().review.lastSourceReviewAt);
  });

  it('answers 304 to a matching If-None-Match', async () => {
    const first = await request('/api/v1/status');
    const etag = first.headers.get('etag')!;
    const second = await request('/api/v1/status', { headers: { 'if-none-match': etag } });
    expect(second.status).toBe(304);
  });

  it('rejects unknown filter values with a problem document', async () => {
    const { status, body, headers } = await json<{ code: string; parameter: string }>('/api/v1/status?audience=vip');
    expect(status).toBe(400);
    expect(headers.get('content-type')).toContain('application/problem+json');
    expect(body.code).toBe('invalid_parameter');
    expect(body.parameter).toBe('audience');
  });

  it('applies the Max filter consistently between status and history', async () => {
    __setContentForTests(snapshotFor(mixedScopeEvents()));
    const status = await json<StatusResponse>('/api/v1/status?audience=max');
    const list = await json<ListResponse>('/api/v1/resets?audience=max');
    expect(status.body.data.stats.total).toBe(2);
    expect(status.body.data.latest_reset?.id).toBe('max-only');
    expect(list.body.data.map((e) => e.id)).toEqual(['max-only', 'all-users']);
    const unspecified = await json<StatusResponse>('/api/v1/status?audience=pro');
    expect(unspecified.body.data.stats.total).toBe(1);
  });

  it('represents an announced future reset separately from the confirmed latest', async () => {
    const events = [
      makeEvent({ id: 'confirmed', at: '2026-09-01T00:00:00Z' }),
      makeEvent({ id: 'promise', eventStatus: 'announced', at: '2026-09-10T00:00:00Z', schedule: { statedAt: '2026-09-12T00:00:00Z', statedWindow: null } }),
    ];
    __setContentForTests(snapshotFor(events));
    const { body } = await json<StatusResponse>('/api/v1/status');
    expect(body.data.latest_reset?.id).toBe('confirmed');
    expect(body.data.announced_reset?.id).toBe('promise');
    expect(body.data.stats.total).toBe(1);
  });

  it('reports date-only and ambiguous latest states without inventing timestamps', async () => {
    __setContentForTests(snapshotFor([makeEvent({ id: 'exact-one', at: '2026-06-09T10:00:00Z' }), makeEvent({ id: 'dated-one', on: '2026-06-09', dateTimezone: 'unknown' })]));
    const { body } = await json<StatusResponse>('/api/v1/status');
    expect(body.data.latest_reset).toBeNull();
    expect(body.data.latest_ambiguous?.map((e) => e.id).sort()).toEqual(['dated-one', 'exact-one']);
    expect(body.data.stats.last_reset_at).toBeNull();
    expect(body.data.stats.days_since_last).toBeNull();
    const b = body.data.latest_ambiguous!.find((e) => e.id === 'dated-one')!;
    expect(b.announced_at).toBeNull();
    expect(b.announced_on).toBe('2026-06-09');
    expect(b.utc_day).toBeNull();
  });
});

describe('GET /api/v1/resets', () => {
  it('paginates the full history without skipping or duplicating', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const suffix: string = cursor ? `&cursor=${cursor}` : '';
      const page = await json<ListResponse>(`/api/v1/resets?limit=5${suffix}`);
      expect(page.status).toBe(200);
      expect(listResponseSchema.safeParse(page.body).success).toBe(true);
      seen.push(...page.body.data.map((e) => e.id));
      cursor = page.body.pagination.next_cursor;
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toHaveLength(12);
    expect(seen[0]).toBe('2026-09-04-max-weekly');
  });

  it('supports asc order and inclusive from/to bounds', async () => {
    const { body } = await json<ListResponse>('/api/v1/resets?order=asc&from=2026-06-01&to=2026-06-30');
    expect(body.data.map((e) => e.id)).toEqual(['2026-06-01-pro-max', '2026-06-09-all-users', '2026-06-13-all-users', '2026-06-19-affected-users', '2026-06-20-everyone-all-plans']);
  });

  it('treats date-only records by their stated date in date filters', async () => {
    __setContentForTests(snapshotFor([makeEvent({ id: 'exact', at: '2026-06-05T23:00:00Z' }), makeEvent({ id: 'dated', on: '2026-06-06', dateTimezone: 'unknown' })]));
    const { body } = await json<ListResponse>('/api/v1/resets?from=2026-06-06&to=2026-06-06');
    expect(body.data.map((e) => e.id)).toEqual(['dated']);
  });

  it('rejects malformed parameters', async () => {
    for (const q of ['limit=0', 'limit=101', 'limit=abc', 'cursor=%%%', 'from=yesterday', 'order=sideways', 'window=hourly']) {
      const { status, body } = await json<{ code: string }>(`/api/v1/resets?${q}`);
      expect(status, q).toBe(400);
      expect(body.code).toBe('invalid_parameter');
    }
    const { status } = await json('/api/v1/resets?cursor=bm90LWpzb24');
    expect(status).toBe(400);
  });

  it('flags when content changed since the cursor was issued', async () => {
    const first = await json<ListResponse>('/api/v1/resets?limit=2');
    const cursor = first.body.pagination.next_cursor!;
    __setContentForTests(snapshotFor(mixedScopeEvents()));
    const second = await json<ListResponse>(`/api/v1/resets?limit=2&cursor=${cursor}`);
    expect(second.status).toBe(200);
    expect(second.body.pagination.revision_changed).toBe(true);
  });
});

describe('GET /api/v1/sources and OpenAPI', () => {
  it('lists the seven directory accounts', async () => {
    const { body } = await json('/api/v1/sources');
    const parsed = sourcesResponseSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.data).toHaveLength(7);
      expect(parsed.data.data.map((s) => s.handle).sort()).toEqual(['AnthropicAI', 'ClaudeDevs', 'alexalbert__', 'amorriscode', 'bcherny', 'claudeai', 'lydiahallie']);
      for (const s of parsed.data.data) {
        expect(s.affiliation_evidence_url).toMatch(/^https:\/\//);
        expect(s.last_reviewed_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it('serves an OpenAPI document whose paths all resolve', async () => {
    const { status, body } = await json<{ openapi: string; paths: Record<string, unknown>; components: { schemas: Record<string, unknown> } }>('/api/openapi.json');
    expect(status).toBe(200);
    expect(body.openapi).toBe('3.1.0');
    for (const path of Object.keys(body.paths)) {
      const res = await request(path);
      expect(res.status, path).toBe(200);
    }
    expect(Object.keys(body.components.schemas)).toContain('StatusResponse');
  });

  it('returns problem+json for unknown API routes', async () => {
    const { status, headers } = await json('/api/v1/nothing');
    expect(status).toBe(404);
    expect(headers.get('content-type')).toContain('problem+json');
  });
});
