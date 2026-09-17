// Shared domain types. Content files under content/ are validated against these
// (see src/domain/schema.ts) before they are served or published.

export const LOCALES = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko'] as const;
export type Locale = (typeof LOCALES)[number];
export type OtherLocale = Exclude<Locale, 'en'>;

export type EventKind =
  | 'usage_reset' // discretionary usage-limit reset (the only kind counted by default)
  | 'limit_increase' // temporary limit increase
  | 'credit' // usage credit or other compensation
  | 'policy_change' // limit/policy change
  | 'incident'; // service incident

export type EditorialStatus = 'draft' | 'published' | 'withdrawn';
export type VerificationStatus = 'needs_review' | 'verified';
export type EventStatus = 'announced' | 'confirmed' | 'cancelled' | 'retracted';

export type ResetWindow = 'five_hour' | 'weekly' | 'other' | 'unspecified';
export type AudienceScope = 'broad' | 'limited' | 'unspecified';
export type Plan = 'free' | 'pro' | 'max' | 'team' | 'enterprise';
/** Plans as stated by the source. 'all' = "all users/everyone"; 'subscribers' = all paid plans; 'unspecified' = not stated. */
export type PlanStatement = 'all' | 'subscribers' | 'unspecified' | Plan[];

export type SourceKind = 'x_post' | 'web_page' | 'status_page';
export type SourceRole = 'original' | 'relay';

export interface EventSource {
  url: string;
  sourceId: string; // id in content/sources.json
  handle: string;
  displayName: string;
  kind: SourceKind;
  role: SourceRole;
  postedAt?: string; // ISO 8601 UTC, when established (X IDs encode creation time)
  excerpt?: string; // short verbatim quote, clearly labelled in the UI
  evidenceSummary: string;
  verificationMethod: string;
  verifiedAt: string; // ISO date or datetime
}

export interface EventTime {
  precision: 'exact' | 'date';
  /** ISO 8601 UTC. Required when precision is 'exact'. */
  announcedAt?: string;
  /** YYYY-MM-DD. Required when precision is 'date'. */
  announcedOn?: string;
  /** Timezone the date is known in ('UTC', an IANA zone, or 'unknown'). */
  dateTimezone?: string;
  /** For date-only records: true only when the UTC day is established by evidence. */
  utcDayResolved?: boolean;
}

export interface Audience {
  scope: AudienceScope;
  statement: string; // wording used by the source
  plans: PlanStatement;
  exclusions?: string;
}

export interface Translation {
  title: string;
  summary: string;
}

export interface Schedule {
  statedAt: string | null; // ISO if the source gave an exact future time
  statedWindow: string | null; // free-text approximate timing as stated
  note?: string;
}

export interface Correction {
  kind: 'correction' | 'retraction';
  reason: string;
  at: string;
}

export interface ResetEvent {
  id: string;
  kind: EventKind;
  editorialStatus: EditorialStatus;
  verificationStatus: VerificationStatus;
  eventStatus: EventStatus;
  title: string;
  summary: string;
  originalLanguage: 'en';
  translations: Partial<Record<OtherLocale, Translation>>;
  translationStatus: 'authored' | 'machine' | 'none';
  time: EventTime;
  effectiveAt?: string | null;
  effectiveNote?: string;
  schedule?: Schedule;
  allocation: 'subscription_usage' | 'api' | 'unspecified';
  audience: Audience;
  windows: ResetWindow[];
  sources: EventSource[];
  firstPublishedAt: string;
  revisedAt: string;
  revision: number;
  alertRevision: number;
  correction?: Correction;
  relatedEventIds?: string[];
  notes?: string;
}

export type SourceClassification = 'official' | 'team_member' | 'relay';

export interface SourceAccount {
  id: string;
  handle: string;
  displayName: string;
  profileUrl: string;
  classification: SourceClassification;
  priority: 'primary' | 'additional' | 'context' | 'optional';
  relevance: string;
  relevanceTranslations: Partial<Record<OtherLocale, string>>;
  affiliationEvidenceUrl: string;
  affiliationEvidenceNote: string;
  resetEvidenceUrls: string[];
  verificationMethod: string;
  lastReviewedAt: string;
  active: boolean;
  limitations?: string;
}

export interface Sponsor {
  slug: string;
  name: string;
  tagline: string;
  logo: string | null; // path under /public or null for initials
  url: string;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  priority: number;
}

export interface ResearchCandidate {
  id: string;
  url: string;
  note: string;
  status: 'unresolved' | 'resolved' | 'rejected';
  resolution?: string;
}

export interface ReviewState {
  lastSourceReviewAt: string;
  note: string;
}
