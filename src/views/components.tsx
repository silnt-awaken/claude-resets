import type { FC } from 'hono/jsx';
import type { EventSource, ResetEvent, SourceAccount } from '../domain/types';
import { eventInstant } from '../domain/content';
import { formatDate, formatRelative, formatRelativeDays, formatUtcDateTime, interpolate, localizePath, type Dict, type Locale } from '../i18n';
import type { PageContext } from './layout';
import { ArrowIcon } from './icons';

export function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N} ]/gu, '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]!.slice(0, 1) + parts[parts.length - 1]!.slice(0, 1)).toUpperCase();
}

export function avatarClass(classification: SourceAccount['classification'] | undefined): string {
  switch (classification) {
    case 'official':
      return 'avatar avatar--sun';
    case 'team_member':
      return 'avatar';
    case 'relay':
      return 'avatar avatar--rose';
    default:
      return 'avatar avatar--mint';
  }
}

export function localizedTitle(e: ResetEvent, locale: Locale): string {
  if (locale === 'en') return e.title;
  return e.translations[locale]?.title ?? e.title;
}

export function localizedSummary(e: ResetEvent, locale: Locale): string {
  if (locale === 'en') return e.summary;
  return e.translations[locale]?.summary ?? e.summary;
}

export function primarySource(e: ResetEvent): EventSource {
  return e.sources.find((s) => s.role === 'original') ?? e.sources[0]!;
}

export function planChipLabel(e: ResetEvent, t: Dict): string {
  const p = e.audience.plans;
  if (p === 'all') return t.chips.plansAll;
  if (p === 'subscribers') return t.chips.plansSubscribers;
  if (p === 'unspecified') return t.chips.plansUnspecified;
  return p.map((plan) => t.chips[plan]).join(' · ');
}

export const Avatar: FC<{ name: string; classification?: SourceAccount['classification']; href?: string }> = ({ name, classification, href }) => {
  const cls = avatarClass(classification);
  const content = <span aria-hidden="true">{initials(name)}</span>;
  return href ? (
    <a class={cls} href={href} target="_blank" rel="noopener noreferrer" aria-label={name}>
      {content}
    </a>
  ) : (
    <span class={cls} title={name}>
      {content}
    </span>
  );
};

/** Absolute timestamp: server renders UTC; the client rewrites to local time and keeps UTC in the title. */
export const AbsoluteTime: FC<{ e: ResetEvent; locale: Locale; t: Dict }> = ({ e, locale, t }) => {
  if (e.time.precision === 'exact' && e.time.announcedAt) {
    const utc = formatUtcDateTime(e.time.announcedAt, locale);
    return (
      <time class="log-abs" datetime={e.time.announcedAt} data-role="absolute-time" data-datetime={e.time.announcedAt} title={utc}>
        {utc}
      </time>
    );
  }
  return (
    <time class="log-abs" datetime={e.time.announcedOn} title={t.time.dateOnly}>
      {formatDate(e.time.announcedOn ?? '', locale)} · {t.time.dateOnly}
    </time>
  );
};

export const RelativeTime: FC<{ e: ResetEvent; locale: Locale; now: Date; t: Dict; class?: string }> = ({ e, locale, now, t, class: cls }) => {
  const instant = eventInstant(e);
  if (instant != null) {
    return (
      <span class={cls ?? 'time-pill'} data-role="relative-time" data-datetime={e.time.announcedAt}>
        {formatRelative(now.getTime() - instant, locale)}
      </span>
    );
  }
  return <span class={cls ?? 'time-pill'}>{interpolate(t.time.approx, { rel: formatRelativeDays(e.time.announcedOn ?? '', now, locale) })}</span>;
};

export const ScopeChips: FC<{ e: ResetEvent; t: Dict }> = ({ e, t }) => (
  <>
    <span class={`chip ${e.audience.scope === 'broad' ? 'chip--sun' : e.audience.scope === 'limited' ? 'chip--peach' : 'chip--muted'}`}>
      {e.audience.scope === 'broad' ? t.chips.broad : e.audience.scope === 'limited' ? t.chips.limited : t.chips.unspecifiedAudience}
    </span>
    <span class="chip">{planChipLabel(e, t)}</span>
    {e.windows.map((w) => (
      <span class={`chip ${w === 'unspecified' ? 'chip--muted' : 'chip--sky'}`}>{t.chips[w]}</span>
    ))}
  </>
);

export const StatusChips: FC<{ e: ResetEvent; t: Dict }> = ({ e, t }) => (
  <>
    {e.kind !== 'usage_reset' ? <span class="chip chip--rose">{t.kinds[e.kind]}</span> : null}
    {e.eventStatus === 'announced' ? <span class="chip chip--sky">{t.statuses.announced}</span> : null}
    {e.eventStatus === 'retracted' ? <span class="chip chip--accent">{t.statuses.retracted}</span> : null}
    {e.eventStatus === 'cancelled' ? <span class="chip chip--accent">{t.statuses.cancelled}</span> : null}
    {e.correction && e.correction.kind === 'correction' && e.eventStatus === 'confirmed' ? <span class="chip chip--mint">{t.archive.corrected}</span> : null}
  </>
);

export const LogItem: FC<{ ctx: PageContext; e: ResetEvent; sourceById: Map<string, SourceAccount>; hidden?: boolean }> = ({ ctx, e, sourceById, hidden }) => {
  const { t, locale, now } = ctx;
  const src = primarySource(e);
  const account = sourceById.get(src.sourceId);
  const relays = e.sources.filter((s) => s.role === 'relay');
  const summary = localizedSummary(e, locale);
  const long = summary.length > 220;
  return (
    <li class="log-item" id={`event-${e.id}`} data-event-id={e.id} hidden={hidden}>
      <Avatar name={src.displayName} classification={account?.classification} href={account?.profileUrl} />
      <div class="bubble">
        <div class="log-meta">
          <RelativeTime e={e} locale={locale} now={now} t={t} />
          <AbsoluteTime e={e} locale={locale} t={t} />
          <span class="log-abs">
            @{src.handle} · {src.displayName}
          </span>
        </div>
        <h3 class="log-title">
          <a href={localizePath(locale, `/resets/${e.id}`)}>{localizedTitle(e, locale)}</a>
        </h3>
        <p class="log-text" data-role="log-text" data-long={long ? 'true' : undefined}>
          {summary}
        </p>
        {long ? (
          // Full text is in the HTML; the script clamps it and reveals this button only when JavaScript runs.
          <button class="link-btn" type="button" data-role="read-more" data-more={t.archive.readMore} data-less={t.archive.readLess} aria-expanded="true" hidden>
            {t.archive.readLess}
          </button>
        ) : null}
        {src.excerpt ? (
          <blockquote class="quote" lang="en">
            “{src.excerpt}”<cite>{t.archive.quoted} · @{src.handle}</cite>
          </blockquote>
        ) : null}
        <div class="log-chips">
          <ScopeChips e={e} t={t} />
          <StatusChips e={e} t={t} />
        </div>
        <div class="log-links">
          <a href={src.url} target="_blank" rel="noopener noreferrer">
            {t.archive.viewOnX} <ArrowIcon />
          </a>
          {relays.map((r) => (
            <a href={r.url} target="_blank" rel="noopener noreferrer">
              {t.archive.relay}: @{r.handle}
            </a>
          ))}
          <a href={localizePath(locale, `/resets/${e.id}`)}>{t.archive.permalink}</a>
        </div>
      </div>
    </li>
  );
};

export const SourceCard: FC<{ ctx: PageContext; s: SourceAccount; compact?: boolean }> = ({ ctx, s, compact }) => {
  const { t, locale } = ctx;
  const relevance = locale === 'en' ? s.relevance : (s.relevanceTranslations[locale] ?? s.relevance);
  return (
    <article class="card source-card">
      <Avatar name={s.displayName} classification={s.classification} href={s.profileUrl} />
      <div>
        <div class="card-title">
          <h3>{s.displayName}</h3>
          <span class="handle">@{s.handle}</span>
          <span class={`chip ${s.classification === 'official' ? 'chip--sun' : s.classification === 'team_member' ? 'chip--sky' : 'chip--rose'}`}>{t.sources[s.classification]}</span>
          {!s.active ? <span class="chip chip--muted">{t.sources.inactive}</span> : null}
        </div>
        <p>{relevance}</p>
        {!compact && s.limitations ? (
          <p>
            <strong>{t.sources.limitations}:</strong> {s.limitations}
          </p>
        ) : null}
        <div class="card-links">
          <a href={s.profileUrl} target="_blank" rel="noopener noreferrer">
            {t.sources.open} <ArrowIcon />
          </a>
          <a href={s.affiliationEvidenceUrl} target="_blank" rel="noopener noreferrer">
            {t.sources.affiliation}
          </a>
          {s.resetEvidenceUrls.slice(0, compact ? 1 : 3).map((u, i) => (
            <a href={u} target="_blank" rel="noopener noreferrer">
              {t.sources.evidence} {s.resetEvidenceUrls.length > 1 ? i + 1 : ''}
            </a>
          ))}
          <span class="status-line">{interpolate(t.sources.reviewed, { date: formatDate(s.lastReviewedAt, locale) })}</span>
        </div>
        {!compact ? (
          <p class="status-line">
            {t.sources.method}: {s.verificationMethod}
          </p>
        ) : null}
      </div>
    </article>
  );
};
