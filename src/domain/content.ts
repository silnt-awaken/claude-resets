// Loads and validates the versioned content files and provides the selectors every
// public surface (homepage, API, feeds, MCP) uses. There is exactly one dataset.

import resetsJson from '../../content/resets.json';
import sourcesJson from '../../content/sources.json';
import sponsorsJson from '../../content/sponsors.json';
import researchJson from '../../content/research-queue.json';
import reviewJson from '../../content/review.json';
import { validateContent, type RawContent } from './schema';
import type { ResearchCandidate, ResetEvent, ReviewState, Sponsor, SourceAccount } from './types';

/** UTC date from which announcements were researched (the day @ClaudeDevs joined X). */
export const COVERAGE_START = '2026-04-16';

export interface ContentSnapshot {
  events: ResetEvent[];
  sources: SourceAccount[];
  sponsors: Sponsor[];
  research: ResearchCandidate[];
  review: ReviewState;
  /** Hash of the whole content set; changes whenever any content file changes. */
  revision: string;
  coverageStart: string;
}

export function buildSnapshot(raw: RawContent): ContentSnapshot {
  const result = validateContent(raw);
  if (!result.ok) {
    throw new Error(`Invalid content:\n- ${result.errors.join('\n- ')}`);
  }
  const { events, sources, sponsors, research, review } = result.data;
  return {
    events,
    sources,
    sponsors,
    research,
    review,
    revision: hashString(JSON.stringify(raw)),
    coverageStart: COVERAGE_START,
  };
}

let cached: ContentSnapshot | null = null;

/** The bundled, validated content. Validation runs once per isolate. */
export function loadContent(): ContentSnapshot {
  if (!cached) {
    cached = buildSnapshot({
      events: resetsJson as unknown,
      sources: sourcesJson as unknown,
      sponsors: sponsorsJson as unknown,
      research: researchJson as unknown,
      review: reviewJson as unknown,
    });
  }
  return cached;
}

/** Test hook: replace the cached snapshot (fixtures) or reset to bundled content with null. */
export function __setContentForTests(snapshot: ContentSnapshot | null): void {
  cached = snapshot;
}

// ---------- selectors ----------

export function publishedEvents(events: ResetEvent[]): ResetEvent[] {
  return events.filter((e) => e.editorialStatus === 'published');
}

/** Events that count as resets: published, verified, confirmed, discretionary usage resets. */
export function isQualifyingReset(e: ResetEvent): boolean {
  return (
    e.editorialStatus === 'published' &&
    e.verificationStatus === 'verified' &&
    e.eventStatus === 'confirmed' &&
    e.kind === 'usage_reset'
  );
}

export function qualifyingResets(events: ResetEvent[]): ResetEvent[] {
  return events.filter(isQualifyingReset);
}

/** Published announcements of a future reset that has not been confirmed as applied. */
export function announcedResets(events: ResetEvent[]): ResetEvent[] {
  return events.filter((e) => e.editorialStatus === 'published' && e.kind === 'usage_reset' && e.eventStatus === 'announced');
}

/** Published events that are not usage resets (policy changes, incidents, credits, increases). */
export function otherAnnouncements(events: ResetEvent[]): ResetEvent[] {
  return events.filter((e) => e.editorialStatus === 'published' && e.kind !== 'usage_reset');
}

/** Published usage-reset events that are no longer confirmed (cancelled or retracted). */
export function withdrawnResets(events: ResetEvent[]): ResetEvent[] {
  return events.filter(
    (e) => e.editorialStatus === 'published' && e.kind === 'usage_reset' && (e.eventStatus === 'cancelled' || e.eventStatus === 'retracted'),
  );
}

export function findEvent(events: ResetEvent[], id: string): ResetEvent | undefined {
  return events.find((e) => e.id === id);
}

// ---------- time helpers ----------

/** Epoch milliseconds of the announcement when the time is exact; otherwise null. */
export function eventInstant(e: ResetEvent): number | null {
  if (e.time.precision !== 'exact' || !e.time.announcedAt) return null;
  const t = Date.parse(e.time.announcedAt);
  return Number.isFinite(t) ? t : null;
}

/** Calendar day used for ordering: the UTC day for exact times, the stated date otherwise. */
export function eventDay(e: ResetEvent): string {
  if (e.time.precision === 'exact' && e.time.announcedAt) return e.time.announcedAt.slice(0, 10);
  return e.time.announcedOn ?? '0000-00-00';
}

/** The UTC day an event can be placed on, or null when the evidence does not establish it. */
export function eventUtcDay(e: ResetEvent): string | null {
  if (e.time.precision === 'exact' && e.time.announcedAt) return e.time.announcedAt.slice(0, 10);
  if (e.time.precision === 'date' && e.time.announcedOn) {
    if (e.time.utcDayResolved || e.time.dateTimezone === 'UTC') return e.time.announcedOn;
  }
  return null;
}

/** Ascending comparator: by day, then exact times by instant, date-only records after exact ones on the same day, then id. */
export function compareEventsAsc(a: ResetEvent, b: ResetEvent): number {
  const da = eventDay(a);
  const db = eventDay(b);
  if (da !== db) return da < db ? -1 : 1;
  const ia = eventInstant(a);
  const ib = eventInstant(b);
  if (ia != null && ib != null && ia !== ib) return ia - ib;
  if (ia != null && ib == null) return -1;
  if (ia == null && ib != null) return 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function sortEventsAsc(events: ResetEvent[]): ResetEvent[] {
  return [...events].sort(compareEventsAsc);
}

export function sortEventsDesc(events: ResetEvent[]): ResetEvent[] {
  return [...events].sort((a, b) => compareEventsAsc(b, a));
}

// ---------- sponsors ----------

export function activeSponsors(sponsors: Sponsor[], now: Date): Sponsor[] {
  const t = now.getTime();
  return sponsors
    .filter((s) => s.active)
    .filter((s) => !s.startsAt || Date.parse(s.startsAt) <= t)
    .filter((s) => !s.endsAt || Date.parse(s.endsAt) > t)
    .sort((a, b) => a.priority - b.priority);
}

// ---------- hashing ----------

/** FNV-1a (two seeds) as a short, synchronous content hash. Not cryptographic; used for ETags and revision ids. */
export function hashString(input: string): string {
  const fnv = (seed: number): string => {
    let h = seed >>> 0;
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  };
  return fnv(0x811c9dc5) + fnv(0x9747b28c);
}

export function eventContentHash(e: ResetEvent): string {
  return hashString(JSON.stringify(e));
}
