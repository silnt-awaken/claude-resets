// Public API response schemas. The OpenAPI document is generated from these, and the
// contract tests validate real responses against them, so the two cannot drift apart.

import { z } from 'zod';
import type { ContentSnapshot } from '../domain/content';
import { eventUtcDay } from '../domain/content';
import { AUDIENCE_FILTERS, WINDOW_FILTERS } from '../domain/filters';
import { roundDays, type Stats } from '../domain/stats';
import type { ResetEvent, SourceAccount } from '../domain/types';

const planEnum = z.enum(['free', 'pro', 'max', 'team', 'enterprise']);

export const resetSummarySchema = z
  .object({
    id: z.string().describe('Stable event id (also the slug of the event page).'),
    kind: z.enum(['usage_reset', 'limit_increase', 'credit', 'policy_change', 'incident']),
    event_status: z.enum(['announced', 'confirmed', 'cancelled', 'retracted']),
    title: z.string(),
    summary: z.string().describe('Editorial summary in English. Not a verbatim quote.'),
    time_precision: z.enum(['exact', 'date']),
    announced_at: z.string().nullable().describe('ISO 8601 UTC when the announcement time is exact; otherwise null.'),
    announced_on: z.string().nullable().describe('YYYY-MM-DD when only the date is established; otherwise null.'),
    utc_day: z.string().nullable().describe('UTC calendar day the event is placed on, or null when the evidence does not establish it.'),
    effective_at: z.string().nullable(),
    effective_note: z.string().nullable(),
    allocation: z.enum(['subscription_usage', 'api', 'unspecified']),
    audience: z.object({
      scope: z.enum(['broad', 'limited', 'unspecified']),
      statement: z.string().describe('Audience wording used by the source.'),
      plans: z.union([z.literal('all'), z.literal('subscribers'), z.literal('unspecified'), z.array(planEnum)]),
      exclusions: z.string().nullable(),
    }),
    windows: z.array(z.enum(['five_hour', 'weekly', 'other', 'unspecified'])),
    sources: z.array(
      z.object({
        url: z.string(),
        handle: z.string(),
        display_name: z.string(),
        role: z.enum(['original', 'relay']),
        kind: z.enum(['x_post', 'web_page', 'status_page']),
        posted_at: z.string().nullable(),
        excerpt: z.string().nullable().describe('Short verbatim quote from the source, if recorded.'),
      }),
    ),
    url: z.string().describe('Stable event page on this site.'),
    first_published_at: z.string(),
    revised_at: z.string(),
    revision: z.number().int(),
    correction: z.object({ kind: z.enum(['correction', 'retraction']), reason: z.string(), at: z.string() }).nullable(),
    related_event_ids: z.array(z.string()),
  })
  .describe('One real-world event. Several source posts about the same reset are merged into one record.');

export const statsSchema = z.object({
  total: z.number().int().min(0).describe('Number of qualifying events matching the filters.'),
  last_reset_at: z.string().nullable().describe('Exact time of the latest event, or null when the latest is date-only or ambiguous.'),
  last_reset_on: z.string().nullable().describe('Date of the latest event when only a date is established.'),
  days_since_last: z.number().nullable().describe('Unfinished time since the latest exact event, in days. Never included in longest_gap_days.'),
  avg_interval_days: z.number().nullable().describe('Mean of eligible completed gaps. Null when no gap is measurable.'),
  longest_gap_days: z.number().nullable().describe('Longest eligible completed gap.'),
  eligible_gaps: z.number().int().min(0),
  total_gaps: z.number().int().min(0),
  exact_count: z.number().int().min(0),
  partial_sample: z.boolean().describe('True when at least one gap could not be measured precisely.'),
});

export const metaSchema = z.object({
  api_version: z.literal('v1'),
  generated_at: z.string().describe('When this response was generated. Not an editorial timestamp.'),
  content_revision: z.string().describe('Hash of the published content set.'),
  editorial_reviewed_at: z.string().describe('When sources were last manually reviewed. Changes only on an explicit review.'),
  coverage_start: z.string().describe('First UTC date covered by the collection.'),
});

export const filtersSchema = z.object({ audience: z.enum(AUDIENCE_FILTERS), window: z.enum(WINDOW_FILTERS) });

export const statusResponseSchema = z.object({
  data: z.object({
    latest_reset: resetSummarySchema.nullable(),
    latest_ambiguous: z.array(resetSummarySchema).nullable().describe('Set instead of latest_reset when the newest announcements share a date and cannot be ordered.'),
    announced_reset: resetSummarySchema.nullable().describe('An explicitly announced future reset awaiting confirmation. A passed stated time does not imply completion.'),
    active_watch: z.null().describe('Always null. This tracker publishes no forecasts.'),
    stats: statsSchema,
    filters: filtersSchema,
  }),
  meta: metaSchema,
});

export const paginationSchema = z.object({
  has_more: z.boolean(),
  next_cursor: z.string().nullable(),
  revision_changed: z.boolean().describe('True when content was republished since the cursor was issued.'),
});

export const listResponseSchema = z.object({ data: z.array(resetSummarySchema), pagination: paginationSchema, meta: metaSchema });

export const sourceSchema = z.object({
  id: z.string(),
  handle: z.string(),
  display_name: z.string(),
  profile_url: z.string(),
  classification: z.enum(['official', 'team_member', 'relay']),
  priority: z.enum(['primary', 'additional', 'context', 'optional']),
  relevance: z.string(),
  affiliation_evidence_url: z.string(),
  affiliation_evidence_note: z.string(),
  reset_evidence_urls: z.array(z.string()),
  verification_method: z.string(),
  last_reviewed_at: z.string(),
  active: z.boolean(),
  limitations: z.string().nullable(),
});

export const sourcesResponseSchema = z.object({ data: z.array(sourceSchema), meta: metaSchema });

export const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.string(),
  detail: z.string(),
  parameter: z.string().optional(),
});

export type ResetSummary = z.infer<typeof resetSummarySchema>;
export type StatusResponse = z.infer<typeof statusResponseSchema>;
export type ListResponse = z.infer<typeof listResponseSchema>;
export type SourcesResponse = z.infer<typeof sourcesResponseSchema>;
export type Problem = z.infer<typeof problemSchema>;

export function serializeEvent(e: ResetEvent, siteUrl: string): ResetSummary {
  return {
    id: e.id,
    kind: e.kind,
    event_status: e.eventStatus,
    title: e.title,
    summary: e.summary,
    time_precision: e.time.precision,
    announced_at: e.time.precision === 'exact' ? (e.time.announcedAt ?? null) : null,
    announced_on: e.time.precision === 'date' ? (e.time.announcedOn ?? null) : null,
    utc_day: eventUtcDay(e),
    effective_at: e.effectiveAt ?? null,
    effective_note: e.effectiveNote ?? null,
    allocation: e.allocation,
    audience: { scope: e.audience.scope, statement: e.audience.statement, plans: e.audience.plans, exclusions: e.audience.exclusions ?? null },
    windows: e.windows,
    sources: e.sources.map((s) => ({ url: s.url, handle: s.handle, display_name: s.displayName, role: s.role, kind: s.kind, posted_at: s.postedAt ?? null, excerpt: s.excerpt ?? null })),
    url: `${siteUrl}/resets/${e.id}`,
    first_published_at: e.firstPublishedAt,
    revised_at: e.revisedAt,
    revision: e.revision,
    correction: e.correction ? { kind: e.correction.kind, reason: e.correction.reason, at: e.correction.at } : null,
    related_event_ids: e.relatedEventIds ?? [],
  };
}

export function serializeStats(stats: Stats): z.infer<typeof statsSchema> {
  const latest = stats.latest;
  return {
    total: stats.total,
    last_reset_at: latest.kind === 'exact' ? (latest.event.time.announcedAt ?? null) : null,
    last_reset_on: latest.kind === 'date' ? latest.day : latest.kind === 'ambiguous' ? latest.day : null,
    days_since_last: stats.sinceLatestMs == null ? null : roundDays(stats.sinceLatestMs / 86_400_000),
    avg_interval_days: roundDays(stats.averageIntervalDays),
    longest_gap_days: roundDays(stats.longestGapDays),
    eligible_gaps: stats.eligibleGaps,
    total_gaps: stats.totalGaps,
    exact_count: stats.exactCount,
    partial_sample: stats.partialSample,
  };
}

export function serializeSource(s: SourceAccount): z.infer<typeof sourceSchema> {
  return {
    id: s.id,
    handle: s.handle,
    display_name: s.displayName,
    profile_url: s.profileUrl,
    classification: s.classification,
    priority: s.priority,
    relevance: s.relevance,
    affiliation_evidence_url: s.affiliationEvidenceUrl,
    affiliation_evidence_note: s.affiliationEvidenceNote,
    reset_evidence_urls: s.resetEvidenceUrls,
    verification_method: s.verificationMethod,
    last_reviewed_at: s.lastReviewedAt,
    active: s.active,
    limitations: s.limitations ?? null,
  };
}

export function buildMeta(content: ContentSnapshot, now: Date): z.infer<typeof metaSchema> {
  return {
    api_version: 'v1',
    generated_at: now.toISOString(),
    content_revision: content.revision,
    editorial_reviewed_at: content.review.lastSourceReviewAt,
    coverage_start: content.coverageStart,
  };
}

/** OpenAPI 3.1 document generated from the zod schemas above. */
export function buildOpenApi(siteUrl: string): Record<string, unknown> {
  const toSchema = (schema: z.ZodType) => z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'output' });
  const filterParams = [
    { name: 'audience', in: 'query', required: false, schema: { type: 'string', enum: [...AUDIENCE_FILTERS], default: 'all' }, description: 'Audience filter. "max"/"pro"/"team" match events whose stated audience includes that plan ("all users" and "all subscribers" count as including paid plans). Unknown eligibility never matches.' },
    { name: 'window', in: 'query', required: false, schema: { type: 'string', enum: [...WINDOW_FILTERS], default: 'any' }, description: 'Reset window filter. Events with an unspecified window never match a named window.' },
  ];
  const problemResponse = (description: string) => ({ description, content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } });
  const cacheHeaders = {
    ETag: { description: 'Entity tag for conditional requests.', schema: { type: 'string' } },
    'Cache-Control': { description: 'Short public caching; stale-while-revalidate keeps responses fast while new publications propagate.', schema: { type: 'string' } },
  };
  return {
    openapi: '3.1.0',
    info: {
      title: 'Claude Resets Public API',
      version: '1.0.0',
      description:
        'Read-only access to publicly announced Claude usage-limit resets tracked by Claude Resets, an independent project not affiliated with Anthropic. Free to use without a key; please link back to the site when you display this data. No forecasts are published: active_watch is always null.',
    },
    servers: [{ url: siteUrl }],
    components: {
      schemas: {
        ResetSummary: toSchema(resetSummarySchema),
        Stats: toSchema(statsSchema),
        Meta: toSchema(metaSchema),
        Filters: toSchema(filtersSchema),
        StatusResponse: toSchema(statusResponseSchema),
        ResetListResponse: toSchema(listResponseSchema),
        Source: toSchema(sourceSchema),
        SourcesResponse: toSchema(sourcesResponseSchema),
        Problem: toSchema(problemSchema),
      },
    },
    paths: {
      '/api/v1/status': {
        get: {
          operationId: 'getResetStatus',
          summary: 'Current reset state and statistics',
          description:
            'Returns the latest confirmed reset matching the filters, a separately represented announced future reset when one exists, statistics, and metadata. Statistics count distinct qualifying events; interval figures use only gaps with exact times on both sides and never bridge a date-only event.',
          parameters: filterParams,
          responses: {
            200: { description: 'Current status.', headers: cacheHeaders, content: { 'application/json': { schema: { $ref: '#/components/schemas/StatusResponse' } } } },
            304: { description: 'Not modified.' },
            400: problemResponse('A query parameter is invalid.'),
            429: problemResponse('Too many requests. Retry-After is set.'),
            503: problemResponse('Reset data is temporarily unavailable.'),
          },
        },
      },
      '/api/v1/resets': {
        get: {
          operationId: 'listResets',
          summary: 'Paginated reset history',
          description:
            'Cursor-based keyset pagination over qualifying resets ordered by announcement time with the event id as tie-breaker. Date-only records compare by their stated date for from/to filtering. Cursors embed the content revision; pagination.revision_changed reports when content was republished mid-walk.',
          parameters: [
            { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
            { name: 'cursor', in: 'query', required: false, schema: { type: 'string', pattern: '^[A-Za-z0-9_-]+$', maxLength: 1024 }, description: 'Opaque cursor from the previous page.' },
            { name: 'from', in: 'query', required: false, schema: { type: 'string', format: 'date-time' }, description: 'Include events at or after this time (or date).' },
            { name: 'to', in: 'query', required: false, schema: { type: 'string', format: 'date-time' }, description: 'Include events at or before this time (or date).' },
            { name: 'order', in: 'query', required: false, schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' } },
            ...filterParams,
          ],
          responses: {
            200: { description: 'A page of resets.', headers: cacheHeaders, content: { 'application/json': { schema: { $ref: '#/components/schemas/ResetListResponse' } } } },
            304: { description: 'Not modified.' },
            400: problemResponse('A query parameter is invalid.'),
            429: problemResponse('Too many requests. Retry-After is set.'),
            503: problemResponse('Reset data is temporarily unavailable.'),
          },
        },
      },
      '/api/v1/sources': {
        get: {
          operationId: 'listSources',
          summary: 'Source-account directory',
          description: 'The public accounts this tracker watches, with classification, evidence links and review dates.',
          responses: {
            200: { description: 'Source accounts.', headers: cacheHeaders, content: { 'application/json': { schema: { $ref: '#/components/schemas/SourcesResponse' } } } },
            304: { description: 'Not modified.' },
            429: problemResponse('Too many requests. Retry-After is set.'),
          },
        },
      },
    },
  };
}
