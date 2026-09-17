// Test fixtures. These are deliberately separate from production content and never ship.

import { buildSnapshot, type ContentSnapshot } from '../src/domain/content';
import type { ResetEvent, SourceAccount } from '../src/domain/types';

export const fixtureSources: SourceAccount[] = [
  {
    id: 'official',
    handle: 'OfficialDevs',
    displayName: 'Official Devs',
    profileUrl: 'https://x.com/OfficialDevs',
    classification: 'official',
    priority: 'primary',
    relevance: 'Fixture official account.',
    relevanceTranslations: {},
    affiliationEvidenceUrl: 'https://example.com/official',
    affiliationEvidenceNote: 'fixture',
    resetEvidenceUrls: [],
    verificationMethod: 'fixture',
    lastReviewedAt: '2026-09-01',
    active: true,
  },
  {
    id: 'member',
    handle: 'teammember',
    displayName: 'Team Member',
    profileUrl: 'https://x.com/teammember',
    classification: 'team_member',
    priority: 'additional',
    relevance: 'Fixture team member.',
    relevanceTranslations: {},
    affiliationEvidenceUrl: 'https://example.com/member',
    affiliationEvidenceNote: 'fixture',
    resetEvidenceUrls: [],
    verificationMethod: 'fixture',
    lastReviewedAt: '2026-09-01',
    active: true,
  },
];

let seq = 0;

export interface EventOverrides extends Partial<Omit<ResetEvent, 'time' | 'audience' | 'sources'>> {
  time?: ResetEvent['time'];
  audience?: Partial<ResetEvent['audience']>;
  sources?: ResetEvent['sources'];
  /** Shortcut: exact ISO timestamp. */
  at?: string;
  /** Shortcut: date-only record. */
  on?: string;
  dateTimezone?: string;
  utcDayResolved?: boolean;
}

export function makeEvent(overrides: EventOverrides = {}): ResetEvent {
  seq += 1;
  const id = overrides.id ?? `fixture-${seq}`;
  const time: ResetEvent['time'] = overrides.time
    ? overrides.time
    : overrides.on
      ? { precision: 'date', announcedOn: overrides.on, dateTimezone: overrides.dateTimezone ?? 'unknown', utcDayResolved: overrides.utcDayResolved ?? false }
      : { precision: 'exact', announcedAt: overrides.at ?? '2026-06-01T12:00:00Z' };
  const translations = { 'zh-CN': { title: `zh-CN ${id}`, summary: `zh-CN summary ${id}` }, 'zh-TW': { title: `zh-TW ${id}`, summary: `zh-TW summary ${id}` }, ja: { title: `ja ${id}`, summary: `ja summary ${id}` }, ko: { title: `ko ${id}`, summary: `ko summary ${id}` } };
  const { at: _at, on: _on, dateTimezone: _tz, utcDayResolved: _u, audience, sources, time: _t, ...rest } = overrides;
  return {
    id,
    kind: 'usage_reset',
    editorialStatus: 'published',
    verificationStatus: 'verified',
    eventStatus: 'confirmed',
    title: `Fixture reset ${id}`,
    summary: `Fixture summary for ${id}.`,
    originalLanguage: 'en',
    translations,
    translationStatus: 'authored',
    time,
    effectiveAt: null,
    allocation: 'subscription_usage',
    audience: { scope: 'broad', statement: 'all users', plans: 'all', ...audience },
    windows: ['five_hour', 'weekly'],
    sources: sources ?? [
      {
        url: `https://x.com/OfficialDevs/status/${1000 + seq}`,
        sourceId: 'official',
        handle: 'OfficialDevs',
        displayName: 'Official Devs',
        kind: 'x_post',
        role: 'original',
        postedAt: time.precision === 'exact' ? time.announcedAt : undefined,
        excerpt: 'We reset limits.',
        evidenceSummary: 'fixture',
        verificationMethod: 'fixture',
        verifiedAt: '2026-09-01',
      },
    ],
    firstPublishedAt: '2026-09-01T00:00:00Z',
    revisedAt: '2026-09-01T00:00:00Z',
    revision: 1,
    alertRevision: 1,
    ...rest,
  };
}

export function snapshotFor(events: ResetEvent[], extra: Partial<Pick<ContentSnapshot, 'sources' | 'sponsors' | 'research' | 'review'>> = {}): ContentSnapshot {
  return buildSnapshot({
    events,
    sources: extra.sources ?? fixtureSources,
    sponsors: extra.sponsors ?? [],
    research: extra.research ?? [],
    review: extra.review ?? { lastSourceReviewAt: '2026-09-01T00:00:00Z', note: 'fixture' },
  });
}

/** The mixed-scope fixture used to prove surfaces agree: all-user, Max-only, unspecified. */
export function mixedScopeEvents(): ResetEvent[] {
  return [
    makeEvent({ id: 'all-users', at: '2026-06-01T10:00:00Z', audience: { scope: 'broad', statement: 'all users', plans: 'all' } }),
    makeEvent({ id: 'max-only', at: '2026-06-10T10:00:00Z', audience: { scope: 'limited', statement: 'everyone on Max', plans: ['max'] }, windows: ['weekly'] }),
    makeEvent({ id: 'unspecified', at: '2026-06-20T10:00:00Z', audience: { scope: 'unspecified', statement: 'users', plans: 'unspecified' }, windows: ['unspecified'] }),
  ];
}
