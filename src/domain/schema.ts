// Content validation. Runs on the bundled content at startup, in `npm run content:validate`,
// and on the private publication endpoint.

import { z } from 'zod';
import { LOCALES, type ResearchCandidate, type ResetEvent, type ReviewState, type Sponsor, type SourceAccount } from './types';

const isoDateTime = z.iso.datetime({ message: 'must be an ISO 8601 UTC timestamp ending in Z' });
const isoDate = z.iso.date({ message: 'must be a YYYY-MM-DD date' });
const httpsUrl = z.url().refine((u) => u.startsWith('https://'), { message: 'must be an https URL' });
const otherLocales = LOCALES.filter((l) => l !== 'en') as readonly ('zh-CN' | 'zh-TW' | 'ja' | 'ko')[];

const translationSchema = z.object({ title: z.string().min(1).max(200), summary: z.string().min(1).max(2000) });

const eventSourceSchema = z.object({
  url: httpsUrl,
  sourceId: z.string().min(1),
  handle: z.string().min(1).max(50),
  displayName: z.string().min(1).max(100),
  kind: z.enum(['x_post', 'web_page', 'status_page']),
  role: z.enum(['original', 'relay']),
  postedAt: isoDateTime.optional(),
  excerpt: z.string().max(500).optional(),
  evidenceSummary: z.string().min(1).max(500),
  verificationMethod: z.string().min(1).max(500),
  verifiedAt: z.string().min(4),
});

const eventTimeSchema = z
  .object({
    precision: z.enum(['exact', 'date']),
    announcedAt: isoDateTime.optional(),
    announcedOn: isoDate.optional(),
    dateTimezone: z.string().optional(),
    utcDayResolved: z.boolean().optional(),
  })
  .superRefine((t, ctx) => {
    if (t.precision === 'exact' && !t.announcedAt) ctx.addIssue({ code: 'custom', message: 'exact precision requires announcedAt' });
    if (t.precision === 'date' && !t.announcedOn) ctx.addIssue({ code: 'custom', message: 'date precision requires announcedOn' });
    if (t.precision === 'date' && !t.dateTimezone) ctx.addIssue({ code: 'custom', message: 'date precision requires dateTimezone (UTC, an IANA zone, or unknown)' });
    if (t.precision === 'exact' && t.announcedOn) ctx.addIssue({ code: 'custom', message: 'exact precision must not also carry announcedOn' });
  });

const planSchema = z.enum(['free', 'pro', 'max', 'team', 'enterprise']);

const audienceSchema = z.object({
  scope: z.enum(['broad', 'limited', 'unspecified']),
  statement: z.string().min(1).max(300),
  plans: z.union([z.literal('all'), z.literal('subscribers'), z.literal('unspecified'), z.array(planSchema).min(1)]),
  exclusions: z.string().max(300).optional(),
});

export const resetEventSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,80}$/, 'id must be a lowercase slug'),
    kind: z.enum(['usage_reset', 'limit_increase', 'credit', 'policy_change', 'incident']),
    editorialStatus: z.enum(['draft', 'published', 'withdrawn']),
    verificationStatus: z.enum(['needs_review', 'verified']),
    eventStatus: z.enum(['announced', 'confirmed', 'cancelled', 'retracted']),
    title: z.string().min(1).max(200),
    summary: z.string().min(1).max(2000),
    originalLanguage: z.literal('en'),
    translations: z.object({
      'zh-CN': translationSchema.optional(),
      'zh-TW': translationSchema.optional(),
      ja: translationSchema.optional(),
      ko: translationSchema.optional(),
    }),
    translationStatus: z.enum(['authored', 'machine', 'none']),
    time: eventTimeSchema,
    effectiveAt: isoDateTime.nullable().optional(),
    effectiveNote: z.string().max(300).optional(),
    schedule: z
      .object({ statedAt: isoDateTime.nullable(), statedWindow: z.string().max(300).nullable(), note: z.string().max(300).optional() })
      .optional(),
    allocation: z.enum(['subscription_usage', 'api', 'unspecified']),
    audience: audienceSchema,
    windows: z.array(z.enum(['five_hour', 'weekly', 'other', 'unspecified'])).min(1),
    sources: z.array(eventSourceSchema).min(1),
    firstPublishedAt: isoDateTime,
    revisedAt: isoDateTime,
    revision: z.number().int().min(1),
    alertRevision: z.number().int().min(1),
    correction: z.object({ kind: z.enum(['correction', 'retraction']), reason: z.string().min(1).max(1000), at: isoDateTime }).optional(),
    relatedEventIds: z.array(z.string()).optional(),
    notes: z.string().max(2000).optional(),
  })
  .superRefine((e, ctx) => {
    if (e.eventStatus === 'announced' && !e.schedule) ctx.addIssue({ code: 'custom', message: `${e.id}: announced events need a schedule (statedAt/statedWindow)` });
    if ((e.eventStatus === 'cancelled' || e.eventStatus === 'retracted') && !e.correction) ctx.addIssue({ code: 'custom', message: `${e.id}: cancelled/retracted events need a correction with a reason` });
    if (e.editorialStatus === 'published' && e.verificationStatus !== 'verified') ctx.addIssue({ code: 'custom', message: `${e.id}: published events must be verified` });
    if (e.editorialStatus === 'published') {
      for (const l of otherLocales) if (!e.translations[l]) ctx.addIssue({ code: 'custom', message: `${e.id}: published events need a ${l} translation` });
    }
    if (e.windows.includes('unspecified') && e.windows.length > 1) ctx.addIssue({ code: 'custom', message: `${e.id}: 'unspecified' window cannot be combined with named windows` });
    if (e.sources.filter((s) => s.role === 'original').length === 0 && e.editorialStatus === 'published')
      ctx.addIssue({ code: 'custom', message: `${e.id}: published events need at least one original source` });
    if (e.alertRevision > e.revision) ctx.addIssue({ code: 'custom', message: `${e.id}: alertRevision cannot exceed revision` });
    if (e.revisedAt < e.firstPublishedAt) ctx.addIssue({ code: 'custom', message: `${e.id}: revisedAt precedes firstPublishedAt` });
  });

export const sourceAccountSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  handle: z.string().regex(/^[A-Za-z0-9_]{1,15}$/, 'must be an X handle without @'),
  displayName: z.string().min(1).max(100),
  profileUrl: httpsUrl,
  classification: z.enum(['official', 'team_member', 'relay']),
  priority: z.enum(['primary', 'additional', 'context', 'optional']),
  relevance: z.string().min(1).max(500),
  relevanceTranslations: z.object({ 'zh-CN': z.string().optional(), 'zh-TW': z.string().optional(), ja: z.string().optional(), ko: z.string().optional() }),
  affiliationEvidenceUrl: httpsUrl,
  affiliationEvidenceNote: z.string().min(1).max(500),
  resetEvidenceUrls: z.array(httpsUrl),
  verificationMethod: z.string().min(1).max(500),
  lastReviewedAt: isoDate,
  active: z.boolean(),
  limitations: z.string().max(500).optional(),
});

export const sponsorSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{2,40}$/),
  name: z.string().min(1).max(60),
  tagline: z.string().min(1).max(120),
  logo: z.string().regex(/^\/[A-Za-z0-9_./-]+\.(png|svg|webp|jpg)$/).nullable(),
  url: httpsUrl,
  active: z.boolean(),
  startsAt: isoDateTime.nullable(),
  endsAt: isoDateTime.nullable(),
  priority: z.number().int(),
});

export const researchCandidateSchema = z.object({
  id: z.string().min(1),
  url: httpsUrl,
  note: z.string().min(1).max(1000),
  status: z.enum(['unresolved', 'resolved', 'rejected']),
  resolution: z.string().max(1000).optional(),
});

export const reviewStateSchema = z.object({ lastSourceReviewAt: isoDateTime, note: z.string().max(500) });

export interface RawContent {
  events: unknown;
  sources: unknown;
  sponsors: unknown;
  research: unknown;
  review: unknown;
}

export interface ValidatedContent {
  events: ResetEvent[];
  sources: SourceAccount[];
  sponsors: Sponsor[];
  research: ResearchCandidate[];
  review: ReviewState;
}

export type ValidationResult = { ok: true; data: ValidatedContent; warnings: string[] } | { ok: false; errors: string[]; warnings: string[] };

function issuesToStrings(prefix: string, error: z.ZodError): string[] {
  return error.issues.map((i) => `${prefix}${i.path.length ? ` [${i.path.join('.')}]` : ''}: ${i.message}`);
}

/** Validate every content file plus the cross-file rules (unique ids, known sources, no duplicate evidence URLs). */
export function validateContent(raw: RawContent): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const events = z.array(resetEventSchema).safeParse(raw.events);
  const sources = z.array(sourceAccountSchema).safeParse(raw.sources);
  const sponsors = z.array(sponsorSchema).safeParse(raw.sponsors);
  const research = z.array(researchCandidateSchema).safeParse(raw.research);
  const review = reviewStateSchema.safeParse(raw.review);

  if (!events.success) errors.push(...issuesToStrings('resets.json', events.error));
  if (!sources.success) errors.push(...issuesToStrings('sources.json', sources.error));
  if (!sponsors.success) errors.push(...issuesToStrings('sponsors.json', sponsors.error));
  if (!research.success) errors.push(...issuesToStrings('research-queue.json', research.error));
  if (!review.success) errors.push(...issuesToStrings('review.json', review.error));
  if (!events.success || !sources.success || !sponsors.success || !research.success || !review.success) {
    return { ok: false, errors, warnings };
  }

  const sourceIds = new Set(sources.data.map((s) => s.id));
  const seenIds = new Set<string>();
  const seenUrls = new Map<string, string>();
  for (const e of events.data) {
    if (seenIds.has(e.id)) errors.push(`resets.json: duplicate event id ${e.id}`);
    seenIds.add(e.id);
    for (const s of e.sources) {
      if (!sourceIds.has(s.sourceId)) errors.push(`${e.id}: unknown sourceId ${s.sourceId} (add it to sources.json)`);
      const prior = seenUrls.get(s.url);
      if (prior && prior !== e.id) errors.push(`${e.id}: source URL ${s.url} is already used by ${prior}; one real-world event must not be recorded twice`);
      seenUrls.set(s.url, e.id);
    }
    for (const rel of e.relatedEventIds ?? []) {
      if (!events.data.some((x) => x.id === rel)) errors.push(`${e.id}: relatedEventIds references unknown event ${rel}`);
    }
    if (e.translationStatus === 'machine') warnings.push(`${e.id}: translations are machine-generated and not reviewed`);
  }
  const seenSlugs = new Set<string>();
  for (const s of sponsors.data) {
    if (seenSlugs.has(s.slug)) errors.push(`sponsors.json: duplicate slug ${s.slug}`);
    seenSlugs.add(s.slug);
  }
  const seenHandles = new Set<string>();
  for (const s of sources.data) {
    const h = s.handle.toLowerCase();
    if (seenHandles.has(h)) errors.push(`sources.json: duplicate handle ${s.handle}`);
    seenHandles.add(h);
  }

  if (errors.length) return { ok: false, errors, warnings };
  return {
    ok: true,
    warnings,
    data: {
      events: events.data as ResetEvent[],
      sources: sources.data as SourceAccount[],
      sponsors: sponsors.data as Sponsor[],
      research: research.data as ResearchCandidate[],
      review: review.data as ReviewState,
    },
  };
}
