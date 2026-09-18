import type { FC } from 'hono/jsx';
import type { ResetEvent, SourceAccount } from '../domain/types';
import { formatDate, formatUtcDateTime, interpolate, localizePath } from '../i18n';
import { AbsoluteTime, Avatar, RelativeTime, ScopeChips, SourceCard, localizedSummary, localizedTitle, planChipLabel } from './components';
import { ArrowIcon, CupIcon } from './icons';
import { Layout, type PageContext } from './layout';

export const CLAUDE_STATUS_URL = 'https://status.claude.com/';
export const USAGE_HELP_URL = 'https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work';
export const CLAUDE_CODE_HELP_URL = 'https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan';
export const API_RATE_LIMITS_URL = 'https://platform.claude.com/docs/en/api/rate-limits';

export function xSearchUrl(sources: SourceAccount[]): string {
  const handles = sources.filter((s) => s.priority === 'primary' || s.priority === 'additional').map((s) => `from:${s.handle}`);
  const q = `(${handles.join(' OR ')}) (reset OR limits OR usage)`;
  return `https://x.com/search?q=${encodeURIComponent(q)}&f=live`;
}

export const SourcesPage: FC<{ ctx: PageContext }> = ({ ctx }) => {
  const { t, locale, content } = ctx;
  const order = { primary: 0, additional: 1, context: 2, optional: 3 } as const;
  const sources = [...content.sources].sort((a, b) => order[a.priority] - order[b.priority]);
  const main = sources.filter((s) => s.priority === 'primary' || s.priority === 'additional');
  const context = sources.filter((s) => s.priority === 'context' || s.priority === 'optional');
  return (
    <Layout ctx={ctx} title={`${t.sources.pageTitle} | ${ctx.cfg.siteName}`} description={t.sources.pageIntro}>
      <h1 class="page-title">{t.sources.pageTitle}</h1>
      <p class="page-intro">{t.sources.pageIntro}</p>
      <section class="section" aria-labelledby="primary-heading">
        <div class="section-head">
          <h2 id="primary-heading">{t.sources.primary}</h2>
          <p class="section-sub">{t.sources.sub}</p>
        </div>
        <div class="stack">
          {main.map((s) => (
            <SourceCard ctx={ctx} s={s} />
          ))}
        </div>
      </section>
      <section class="section" aria-labelledby="context-heading">
        <div class="section-head">
          <h2 id="context-heading">{t.sources.context}</h2>
        </div>
        <div class="stack">
          {context.map((s) => (
            <SourceCard ctx={ctx} s={s} />
          ))}
        </div>
      </section>
      <section class="section prose">
        <p>{t.sources.notExhaustive}</p>
        <p>{t.sources.notifyHelp}</p>
        <p>
          <a class="btn" href={xSearchUrl(content.sources)} target="_blank" rel="noopener noreferrer">
            {t.sources.search} <ArrowIcon />
          </a>
        </p>
      </section>
      <section class="section" aria-labelledby="resources-heading">
        <div class="section-head">
          <h2 id="resources-heading">{t.sources.resources}</h2>
        </div>
        <ul class="prose">
          <li>
            <a href={CLAUDE_STATUS_URL} target="_blank" rel="noopener noreferrer">
              {t.sources.status}
            </a>{' '}
            — {t.sources.statusNote}
          </li>
          <li>
            <a href={USAGE_HELP_URL} target="_blank" rel="noopener noreferrer">
              {t.sources.usageHelp}
            </a>
          </li>
          <li>
            <a href={CLAUDE_CODE_HELP_URL} target="_blank" rel="noopener noreferrer">
              {t.sources.claudeCodeHelp}
            </a>
          </li>
        </ul>
        <p class="status-line" style="margin-top:12px">
          {interpolate(t.footer.lastReview, { date: formatDate(content.review.lastSourceReviewAt.slice(0, 10), locale) })}
        </p>
      </section>
    </Layout>
  );
};

export const SupportPage: FC<{ ctx: PageContext }> = ({ ctx }) => {
  const { t, cfg } = ctx;
  return (
    <Layout ctx={ctx} title={`${t.support.pageTitle} | ${cfg.siteName}`} description={t.support.description}>
      <h1 class="page-title">{t.support.pageTitle}</h1>
      <div class="section card card--rose support-card">
        <div>
          <p>{t.support.description}</p>
          <small>{t.support.noEffect}</small>
          {cfg.supportProvider ? <small>{interpolate(t.support.provider, { provider: cfg.supportProvider })}</small> : null}
        </div>
        {cfg.supportUrl ? (
          <a class="btn btn--sun" href={cfg.supportUrl} target="_blank" rel="noopener noreferrer" title={t.support.external}>
            <CupIcon /> {t.support.cta}
          </a>
        ) : (
          <p class="notice notice--warn">{t.support.unavailable}</p>
        )}
      </div>
      <section class="section prose" aria-labelledby="sponsorship-heading">
        <h2 id="sponsorship-heading">{t.support.sponsorship}</h2>
        <p>{t.support.sponsorshipIntro}</p>
        <p>{t.sponsors.body}</p>
        {cfg.supportContactEmail ? (
          <p>
            <a class="btn" href={`mailto:${cfg.supportContactEmail}?subject=${encodeURIComponent(`${cfg.siteName} sponsorship`)}`}>
              {t.sponsors.contact}
            </a>
          </p>
        ) : (
          <p class="notice notice--warn">{t.sponsors.unavailable}</p>
        )}
      </section>
    </Layout>
  );
};

export const AboutPage: FC<{ ctx: PageContext }> = ({ ctx }) => {
  const { t, cfg } = ctx;
  return (
    <Layout ctx={ctx} title={`${t.about.pageTitle} | ${cfg.siteName}`} description={t.about.intro}>
      <h1 class="page-title">{t.about.pageTitle}</h1>
      <p class="page-intro">{t.about.intro}</p>
      <div class="section prose">
        {t.about.sections.map((s) => (
          <>
            <h2>{s.heading}</h2>
            <p>{s.body}</p>
          </>
        ))}
        <h2>{t.about.officialHelp}</h2>
        <ul>
          <li>
            <a href={USAGE_HELP_URL} target="_blank" rel="noopener noreferrer">
              {t.sources.usageHelp}
            </a>
          </li>
          <li>
            <a href={CLAUDE_CODE_HELP_URL} target="_blank" rel="noopener noreferrer">
              {t.sources.claudeCodeHelp}
            </a>
          </li>
          <li>
            <a href={API_RATE_LIMITS_URL} target="_blank" rel="noopener noreferrer">
              {t.about.apiRateLimits}
            </a>
          </li>
          <li>
            <a href={CLAUDE_STATUS_URL} target="_blank" rel="noopener noreferrer">
              {t.sources.status}
            </a>
          </li>
        </ul>
      </div>
    </Layout>
  );
};

export const PrivacyPage: FC<{ ctx: PageContext }> = ({ ctx }) => {
  const { t, cfg } = ctx;
  return (
    <Layout ctx={ctx} title={`${t.privacy.pageTitle} | ${cfg.siteName}`} description={t.privacy.intro}>
      <h1 class="page-title">{t.privacy.pageTitle}</h1>
      <p class="page-intro">{t.privacy.intro}</p>
      <div class="section prose">
        {t.privacy.items.map((s) => (
          <>
            <h2>{s.heading}</h2>
            <p>{s.body}</p>
          </>
        ))}
      </div>
    </Layout>
  );
};

export const NotFoundPage: FC<{ ctx: PageContext }> = ({ ctx }) => {
  const { t, locale, cfg } = ctx;
  return (
    <Layout ctx={ctx} title={`${t.notFound.title} | ${cfg.siteName}`} description={t.notFound.body} noindex>
      <h1 class="page-title">{t.notFound.title}</h1>
      <p class="page-intro">{t.notFound.body}</p>
      <p class="section">
        <a class="btn btn--sun" href={localizePath(locale, '/')}>
          {t.notFound.back}
        </a>
      </p>
    </Layout>
  );
};

export const ResetPage: FC<{ ctx: PageContext; e: ResetEvent; related: ResetEvent[]; sourceById: Map<string, SourceAccount> }> = ({ ctx, e, related, sourceById }) => {
  const { t, locale, cfg, now } = ctx;
  const title = localizedTitle(e, locale);
  const summary = localizedSummary(e, locale);
  return (
    <Layout ctx={ctx} title={`${title} | ${cfg.siteName}`} description={summary}>
      <p class="section" style="margin-top:20px">
        <a href={localizePath(locale, '/')}>← {t.reset.back}</a>
      </p>
      <h1 class="page-title" style="margin-top:12px">
        {title}
      </h1>
      <div class="badge-row" style="margin-top:12px">
        <span class="chip chip--sun">{t.kinds[e.kind]}</span>
        <span class="chip">{t.statuses[e.eventStatus]}</span>
        <ScopeChips e={e} t={t} />
        {e.correction && e.correction.kind === 'correction' && e.eventStatus === 'confirmed' ? <span class="chip chip--mint">{t.archive.corrected}</span> : null}
      </div>
      <div class="section card">
        <div class="log-meta">
          <RelativeTime e={e} locale={locale} now={now} t={t} />
          <AbsoluteTime e={e} locale={locale} t={t} />
        </div>
        <p style="margin-top:12px">{summary}</p>
        {locale !== 'en' ? <p class="status-line" style="margin-top:8px">{t.reset.translatedNote}</p> : null}
        {e.correction ? (
          <p class="notice notice--warn" style="margin-top:12px">
            <strong>{e.correction.kind === 'retraction' ? t.reset.retraction : t.reset.correction}</strong> ({formatUtcDateTime(e.correction.at, locale)}): {e.correction.reason}
          </p>
        ) : null}
        {e.schedule ? (
          <p class="notice" style="margin-top:12px">
            {t.upcoming.stated}: {e.schedule.statedAt ? formatUtcDateTime(e.schedule.statedAt, locale) : (e.schedule.statedWindow ?? t.upcoming.unknownTiming)}
            {e.schedule.note ? ` · ${e.schedule.note}` : ''}
          </p>
        ) : null}
      </div>

      <section class="section" aria-labelledby="scope-heading">
        <h2 id="scope-heading">{t.reset.scope}</h2>
        <dl class="kv" style="margin-top:12px">
          <dt>{t.reset.kind}</dt>
          <dd>{t.kinds[e.kind]}</dd>
          <dt>{t.reset.status}</dt>
          <dd>{t.statuses[e.eventStatus]}</dd>
          <dt>{t.reset.statedAudience}</dt>
          <dd>{e.audience.statement}</dd>
          <dt>{t.hero.audience}</dt>
          <dd>{planChipLabel(e, t)}</dd>
          {e.audience.exclusions ? (
            <>
              <dt>{t.reset.exclusions}</dt>
              <dd>{e.audience.exclusions}</dd>
            </>
          ) : null}
          <dt>{t.hero.windows}</dt>
          <dd>{e.windows.map((w) => t.chips[w]).join(', ')}</dd>
          <dt>{t.reset.allocation}</dt>
          <dd>{t.reset.allocations[e.allocation]}</dd>
        </dl>
      </section>

      <section class="section" aria-labelledby="time-heading">
        <h2 id="time-heading">{t.reset.timestamps}</h2>
        <dl class="kv" style="margin-top:12px">
          <dt>{t.reset.announced}</dt>
          <dd>
            {e.time.precision === 'exact' ? (
              <AbsoluteTime e={e} locale={locale} t={t} />
            ) : (
              `${formatDate(e.time.announcedOn ?? '', locale)} (${t.time.dateOnly}; ${e.time.dateTimezone ?? 'unknown'})`
            )}
          </dd>
          <dt>{t.reset.effective}</dt>
          <dd>{e.effectiveAt ? formatUtcDateTime(e.effectiveAt, locale) : (e.effectiveNote ?? t.reset.notEstablished)}</dd>
          <dt>{t.reset.firstPublished}</dt>
          <dd>{formatUtcDateTime(e.firstPublishedAt, locale)}</dd>
          <dt>{t.reset.revised}</dt>
          <dd>
            {formatUtcDateTime(e.revisedAt, locale)} · {interpolate(t.reset.revision, { n: e.revision })}
          </dd>
        </dl>
      </section>

      <section class="section" aria-labelledby="evidence-heading">
        <h2 id="evidence-heading">{t.reset.evidence}</h2>
        <ol class="log" style="margin-top:14px">
          {e.sources.map((s) => {
            const account = sourceById.get(s.sourceId);
            return (
              <li class="log-item">
                <Avatar name={s.displayName} classification={account?.classification} href={account?.profileUrl} />
                <div class="bubble">
                  <div class="log-meta">
                    <span class={`chip ${s.role === 'original' ? 'chip--sun' : 'chip--rose'}`}>{s.role === 'original' ? t.archive.originalSource : t.archive.relay}</span>
                    <span class="log-abs">
                      @{s.handle} · {s.displayName}
                    </span>
                    {s.postedAt ? (
                      <time class="log-abs" datetime={s.postedAt} data-role="absolute-time" data-datetime={s.postedAt} title={formatUtcDateTime(s.postedAt, locale)}>
                        {formatUtcDateTime(s.postedAt, locale)}
                      </time>
                    ) : null}
                  </div>
                  {s.excerpt ? (
                    <blockquote class="quote" lang="en">
                      “{s.excerpt}”<cite>{t.archive.quoted}</cite>
                    </blockquote>
                  ) : null}
                  <p class="log-text">{s.evidenceSummary}</p>
                  <dl class="kv" style="margin-top:10px">
                    <dt>{t.reset.method}</dt>
                    <dd>{s.verificationMethod}</dd>
                    <dt>{t.reset.verified}</dt>
                    <dd>{s.verifiedAt}</dd>
                  </dl>
                  <div class="log-links">
                    <a href={s.url} target="_blank" rel="noopener noreferrer">
                      {t.archive.viewOnX} <ArrowIcon />
                    </a>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {related.length > 0 ? (
        <section class="section" aria-labelledby="related-heading">
          <h2 id="related-heading">{t.reset.related}</h2>
          <ul class="prose" style="margin-top:10px">
            {related.map((r) => (
              <li>
                <a href={localizePath(locale, `/resets/${r.id}`)}>{localizedTitle(r, locale)}</a> · {r.time.precision === 'exact' ? formatUtcDateTime(r.time.announcedAt!, locale) : formatDate(r.time.announcedOn!, locale)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {e.notes ? (
        <section class="section prose">
          <h2>{t.reset.notes}</h2>
          <p>{e.notes}</p>
        </section>
      ) : null}
    </Layout>
  );
};
