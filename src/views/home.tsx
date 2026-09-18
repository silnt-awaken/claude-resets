import type { FC } from 'hono/jsx';
import type { CalendarGrid } from '../domain/calendar';
import { AUDIENCE_FILTERS, WINDOW_FILTERS, filtersToQuery, isDefaultFilters, type Filters } from '../domain/filters';
import { formatDays, type Stats } from '../domain/stats';
import type { ResetEvent, SourceAccount } from '../domain/types';
import { formatDate, formatNumber, formatRelativeDays, formatUtcDateTime, interpolate, localizePath } from '../i18n';
import { AbsoluteTime, LogItem, RelativeTime, ScopeChips, SourceCard, localizedSummary, localizedTitle, primarySource } from './components';
import { ArrowIcon, BellIcon, CupIcon, DownIcon, RssIcon, SendIcon, UpIcon } from './icons';
import { Layout, type PageContext } from './layout';

export const CHECK_USAGE_URL = 'https://claude.ai/settings/usage';
export const USAGE_HELP_URL = 'https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work';

export interface HomeModel {
  filters: Filters;
  /** Qualifying resets that match the filters, newest first. */
  filtered: ResetEvent[];
  stats: Stats;
  calendar: CalendarGrid;
  announced: ResetEvent[];
  others: ResetEvent[];
  withdrawn: ResetEvent[];
  previewSources: SourceAccount[];
  sourceById: Map<string, SourceAccount>;
  begCount: number | null;
}

const INITIAL_VISIBLE = 3;

export const HomePage: FC<{ ctx: PageContext; model: HomeModel }> = ({ ctx, model }) => {
  const { t, locale, cfg } = ctx;
  const clientStrings = {
    push: t.push,
    beg: t.beg,
    telegram: t.telegram,
    calendar: { detailsFor: t.calendar.detailsFor, noReset: t.calendar.noReset, close: t.calendar.close },
    archive: { showAll: t.archive.showAll, showFewer: t.archive.showFewer },
    time: { utc: t.time.utc },
  };
  return (
    <Layout ctx={ctx} title={t.meta.title} description={t.meta.description} sponsors="rails">
      <script type="application/json" id="client-i18n" dangerouslySetInnerHTML={{ __html: JSON.stringify(clientStrings).replace(/</g, '\\u003c') }} />
      <section class="hero" aria-label={t.hero.latestLabel}>
        <p class="hero-explainer">
          {t.hero.intro} <a href={localizePath(locale, '/sources')}>{t.hero.introSources}</a>.
        </p>
        <Actions ctx={ctx} />
        <Upcoming ctx={ctx} events={model.announced} />
        <HeroCard ctx={ctx} model={model} />
      </section>

      <FiltersForm ctx={ctx} filters={model.filters} />
      <StatsTiles ctx={ctx} stats={model.stats} filters={model.filters} />

      <section class="section" aria-labelledby="graph-heading">
        <div class="section-head">
          <h2 id="graph-heading">{t.calendar.heading}</h2>
          <p class="section-sub legend">
            <span class="legend-item">
              <span class="legend-chip legend-chip--broad"></span> {t.calendar.legendBroad}
            </span>
            <span class="legend-item">
              <span class="legend-chip legend-chip--limited"></span> {t.calendar.legendLimited}
            </span>
            <span class="legend-item">
              <span class="legend-chip"></span> {t.calendar.legendNone}
            </span>
          </p>
        </div>
        <Calendar ctx={ctx} grid={model.calendar} events={model.filtered} />
      </section>

      <Archive ctx={ctx} model={model} />

      {model.withdrawn.length > 0 ? (
        <section class="section" aria-labelledby="withdrawn-heading">
          <div class="section-head">
            <h2 id="withdrawn-heading">{t.archive.withdrawnHeading}</h2>
            <p class="section-sub">{t.archive.withdrawnSub}</p>
          </div>
          <ol class="log">
            {model.withdrawn.map((e) => (
              <LogItem ctx={ctx} e={e} sourceById={model.sourceById} />
            ))}
          </ol>
        </section>
      ) : null}

      {model.others.length > 0 ? (
        <section class="section" aria-labelledby="other-heading">
          <div class="section-head">
            <h2 id="other-heading">{t.other.heading}</h2>
            <p class="section-sub">{t.other.sub}</p>
          </div>
          <ul class="other-list">
            {model.others.map((e) => {
              const src = primarySource(e);
              return (
                <li>
                  <span class="chip chip--rose">{t.kinds[e.kind]}</span>
                  <AbsoluteTime e={e} locale={locale} t={t} />
                  <a href={localizePath(locale, `/resets/${e.id}`)}>{localizedTitle(e, locale)}</a>
                  <a href={src.url} target="_blank" rel="noopener noreferrer" class="status-line">
                    @{src.handle} <ArrowIcon />
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section class="section" aria-labelledby="sources-heading">
        <div class="section-head">
          <h2 id="sources-heading">{t.sources.heading}</h2>
          <p class="section-sub">{t.sources.sub}</p>
        </div>
        <div class="grid-2">
          {model.previewSources.map((s) => (
            <SourceCard ctx={ctx} s={s} compact />
          ))}
        </div>
        <p class="log-more">
          <a class="btn" href={localizePath(locale, '/sources')}>
            {t.sources.directory} <ArrowIcon />
          </a>
        </p>
      </section>

      <section class="section" aria-labelledby="support-heading">
        <div class="card card--rose support-card">
          <div>
            <h2 id="support-heading">{t.support.heading}</h2>
            <p>{t.support.description}</p>
            <small>{t.support.noEffect}</small>
          </div>
          {cfg.supportUrl ? (
            <a class="btn btn--sun" href={cfg.supportUrl} target="_blank" rel="noopener noreferrer" title={t.support.external}>
              <CupIcon /> {t.support.cta}
            </a>
          ) : (
            <a class="btn" href={localizePath(locale, '/support')}>
              <CupIcon /> {t.support.cta}
            </a>
          )}
        </div>
      </section>
    </Layout>
  );
};

const Actions: FC<{ ctx: PageContext }> = ({ ctx }) => {
  const { t, cfg, locale } = ctx;
  return (
    <div class="actions" role="group" aria-label={t.actions.group}>
      <button
        class="pill pill--sun"
        type="button"
        data-role="push-toggle"
        aria-pressed="false"
        aria-describedby="action-hint"
        title={t.actions.browserTitle}
        aria-disabled={cfg.browserAlerts.enabled ? undefined : 'true'}
      >
        <BellIcon /> <span>{t.actions.browser}</span>
      </button>
      {cfg.telegramChannelUrl ? (
        <a class="pill" href={cfg.telegramChannelUrl} target="_blank" rel="noopener noreferrer" title={t.actions.telegramTitle}>
          <SendIcon /> <span>{t.actions.telegram}</span>
        </a>
      ) : (
        <button class="pill" type="button" data-role="telegram-unavailable" aria-describedby="action-hint" aria-disabled="true" title={t.telegram.unavailable}>
          <SendIcon /> <span>{t.actions.telegram}</span>
        </button>
      )}
      <a class="pill" href="/feed.xml" title={t.actions.feedTitle}>
        <RssIcon /> <span>{t.actions.feed}</span>
      </a>
      {cfg.supportUrl ? (
        <a class="pill pill--accent" href={cfg.supportUrl} target="_blank" rel="noopener noreferrer" title={t.actions.tipTitle}>
          <CupIcon /> <span>{t.actions.tip}</span>
        </a>
      ) : (
        <a class="pill pill--accent" href={localizePath(locale, '/support')} title={t.actions.tipTitle}>
          <CupIcon /> <span>{t.actions.tip}</span>
        </a>
      )}
      <p class="action-hint" id="action-hint" data-role="action-hint" aria-live="polite" hidden></p>
    </div>
  );
};

const Upcoming: FC<{ ctx: PageContext; events: ResetEvent[] }> = ({ ctx, events }) => {
  const { t, locale, now } = ctx;
  if (events.length === 0) return null;
  return (
    <>
      {events.map((e) => {
        const src = primarySource(e);
        const statedAt = e.schedule?.statedAt ?? null;
        const passed = statedAt ? Date.parse(statedAt) < now.getTime() : false;
        return (
          <aside class="upcoming" aria-label={t.upcoming.label}>
            <span class="mono">{t.upcoming.label}</span>
            <h3 style="margin-top:6px">
              <a href={localizePath(locale, `/resets/${e.id}`)}>{localizedTitle(e, locale)}</a>
            </h3>
            <p style="margin-top:6px">{localizedSummary(e, locale)}</p>
            <div class="log-chips">
              <ScopeChips e={e} t={t} />
            </div>
            <p class="status-line" style="margin-top:8px">
              {t.upcoming.stated}: {statedAt ? formatUtcDateTime(statedAt, locale) : (e.schedule?.statedWindow ?? t.upcoming.unknownTiming)} · @{src.handle}
              {passed ? ` · ${t.upcoming.pending}` : ''}
            </p>
            <p class="status-line">{t.upcoming.note}</p>
          </aside>
        );
      })}
    </>
  );
};

const HeroCard: FC<{ ctx: PageContext; model: HomeModel }> = ({ ctx, model }) => {
  const { t, locale, cfg, now } = ctx;
  const { stats, filters } = model;
  const latest = stats.latest;
  const cooldown = String(cfg.reactionCooldownHours);
  const beg = (
    <div class="beg-wrap">
      <button class="beg" type="button" data-role="beg" aria-describedby="beg-help" title={t.beg.title}>
        <span aria-hidden="true">🙏</span>
        <span>{t.beg.label}</span>
        <span class="beg-count" data-role="beg-count" aria-label={model.begCount == null ? t.beg.unavailable : interpolate(t.beg.count, { count: model.begCount })}>
          {model.begCount == null ? '—' : formatNumber(model.begCount, locale)}
        </span>
      </button>
      <span class="beg-help" id="beg-help">
        {interpolate(t.beg.help, { hours: cooldown })}
      </span>
      <span class="visually-hidden" data-role="beg-status" role="status" aria-live="polite"></span>
    </div>
  );

  if (latest.kind === 'none') {
    return (
      <div class="hero-card">
        <span class="hero-label mono">{t.hero.latestLabel}</span>
        <span class="hero-figure hero-figure--small">{isDefaultFilters(filters) ? t.hero.noEvents : t.hero.noEventsFiltered}</span>
        <div class="hero-row">
          <p class="hero-sub">{t.stats.coverage.replace('{date}', formatDate(ctx.content.coverageStart, locale))}</p>
          {beg}
        </div>
      </div>
    );
  }

  if (latest.kind === 'ambiguous') {
    return (
      <div class="hero-card">
        <span class="hero-label mono">{t.hero.ambiguous}</span>
        <span class="hero-figure hero-figure--small">{formatDate(latest.day, locale)}</span>
        <p class="hero-note">{t.hero.ambiguousNote}</p>
        <ul>
          {latest.events.map((e) => (
            <li>
              <a href={localizePath(locale, `/resets/${e.id}`)}>{localizedTitle(e, locale)}</a>
            </li>
          ))}
        </ul>
        <div class="hero-row">
          <p class="hero-note">{t.hero.ageNote}</p>
          {beg}
        </div>
      </div>
    );
  }

  const e = latest.event;
  const src = primarySource(e);
  const relays = e.sources.filter((s) => s.role === 'relay');
  return (
    <div class="hero-card" data-role="hero" data-event-id={e.id}>
      <span class="hero-label mono">{t.hero.latestLabel}</span>
      <div>
        {latest.kind === 'exact' ? (
          <RelativeTime e={e} locale={locale} now={now} t={t} class="hero-figure" />
        ) : (
          <span class="hero-figure hero-figure--small">{interpolate(t.time.approx, { rel: formatRelativeDays(latest.day, now, locale) })}</span>
        )}
      </div>
      <div class="hero-row">
        <p class="hero-sub">
          {latest.kind === 'exact' ? <AbsoluteTime e={e} locale={locale} t={t} /> : interpolate(t.hero.dateOnly, { date: formatDate(latest.day, locale) })}
        </p>
        {beg}
      </div>
      <h2 style="margin-top:14px;font-size:20px">
        <a href={localizePath(locale, `/resets/${e.id}`)}>{localizedTitle(e, locale)}</a>
      </h2>
      <div class="hero-meta">
        <ScopeChips e={e} t={t} />
      </div>
      <p class="hero-note">
        {t.hero.source}: @{src.handle} · {src.displayName}
        {relays.length ? ` · ${t.hero.relayedBy} ${relays.map((r) => `@${r.handle}`).join(', ')}` : ''}. {t.hero.ageNote}
      </p>
      <div class="hero-links">
        <a class="btn btn--sun" href={src.url} target="_blank" rel="noopener noreferrer">
          {t.hero.viewAnnouncement} <ArrowIcon />
        </a>
        <a class="btn" href={CHECK_USAGE_URL} target="_blank" rel="noopener noreferrer">
          {t.hero.checkUsage} <ArrowIcon />
        </a>
      </div>
    </div>
  );
};

const FiltersForm: FC<{ ctx: PageContext; filters: Filters }> = ({ ctx, filters }) => {
  const { t, locale } = ctx;
  return (
    <form class="filters" method="get" action={localizePath(locale, '/')} data-role="filters" aria-label={t.filters.legend}>
      <label>
        {t.filters.audience}
        <select name="audience" data-role="filter-audience">
          {AUDIENCE_FILTERS.map((a) => (
            <option value={a} selected={a === filters.audience}>
              {t.filters[a]}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t.filters.window}
        <select name="window" data-role="filter-window">
          {WINDOW_FILTERS.map((w) => (
            <option value={w} selected={w === filters.window}>
              {w === 'any' ? t.filters.anyWindow : t.filters[w]}
            </option>
          ))}
        </select>
      </label>
      <button class="btn" type="submit" data-role="filter-apply">
        {t.filters.apply}
      </button>
      {!isDefaultFilters(filters) ? (
        <a class="btn" href={localizePath(locale, '/')}>
          {t.filters.clear}
        </a>
      ) : null}
      <span class="filters-note">{t.filters.note}</span>
    </form>
  );
};

const StatsTiles: FC<{ ctx: PageContext; stats: Stats; filters: Filters }> = ({ ctx, stats, filters }) => {
  const { t, locale } = ctx;
  const avg = stats.averageIntervalDays == null ? null : interpolate(t.stats.days, { n: formatDays(stats.averageIntervalDays) });
  const longest = stats.longestGapDays == null ? null : interpolate(t.stats.days, { n: formatDays(stats.longestGapDays) });
  const showing = !isDefaultFilters(filters)
    ? interpolate(t.filters.showing, { audience: t.filters[filters.audience], window: filters.window === 'any' ? t.filters.anyWindow : t.filters[filters.window] })
    : '';
  return (
    <>
      <div class="stats" aria-describedby="stats-note">
        <div class="stat stat--sun">
          <span class="stat-label mono">{t.stats.resets}</span>
          <span class="stat-value">{formatNumber(stats.total, locale)}</span>
        </div>
        <div class="stat stat--rose">
          <span class="stat-label mono">{t.stats.avgInterval}</span>
          <span class="stat-value">{avg ?? '—'}</span>
          {avg == null ? <span class="stat-note">{t.stats.unavailable}</span> : null}
        </div>
        <div class="stat stat--sky">
          <span class="stat-label mono">{t.stats.longestWait}</span>
          <span class="stat-value">{longest ?? '—'}</span>
          {longest == null ? <span class="stat-note">{t.stats.unavailable}</span> : null}
        </div>
      </div>
      <p class="stats-note" id="stats-note">
        {showing ? `${showing} ` : `${t.stats.scope} `}
        {stats.partialSample && stats.eligibleGaps > 0 ? `${interpolate(t.stats.partial, { eligible: stats.eligibleGaps, total: stats.totalGaps })} ` : ''}
        {interpolate(t.stats.coverage, { date: formatDate(ctx.content.coverageStart, locale) })}{' '}
        <a href={localizePath(locale, '/about')}>{t.stats.explain}</a>
      </p>
    </>
  );
};

const Calendar: FC<{ ctx: PageContext; grid: CalendarGrid; events: ResetEvent[] }> = ({ ctx, grid, events }) => {
  const { t, locale } = ctx;
  const byId = new Map(events.map((e) => [e.id, e]));
  const data: Record<string, Array<{ id: string; title: string; url: string; scope: string; source: string }>> = {};
  for (const week of grid.weeks) {
    for (const cell of week) {
      if (cell.events.length === 0) continue;
      data[cell.date] = cell.events.map((ref) => {
        const e = byId.get(ref.id);
        const src = e ? primarySource(e) : null;
        return { id: ref.id, title: e ? localizedTitle(e, locale) : ref.id, url: localizePath(locale, `/resets/${ref.id}`), scope: ref.scope, source: src ? `@${src.handle}` : '' };
      });
    }
  }
  const stateLabel = (s: string) =>
    s === 'broad' ? t.calendar.legendBroad : s === 'limited' ? t.calendar.legendLimited : s === 'future' ? t.calendar.future : s === 'outside' ? t.calendar.outside : t.calendar.noReset;
  return (
    <div class="graph-card">
      <div class="cg-scroll" data-role="cg-scroll">
        <div class="cg" data-role="cg">
          {grid.months.map((m) => (
            <span class="cg-month" style={`grid-column:${m.column + 2};grid-row:1`}>
              {t.calendar.months[m.month - 1]}
            </span>
          ))}
          {[1, 3, 5].map((d) => (
            <span class="cg-weekday" style={`grid-column:1;grid-row:${d + 2}`}>
              {t.calendar.weekdays[d]}
            </span>
          ))}
          {grid.weeks.map((week, w) =>
            week.map((cell, d) => {
              const style = `grid-column:${w + 2};grid-row:${d + 2}`;
              const label = interpolate(t.calendar.cellLabel, { date: formatDate(cell.date, locale), state: stateLabel(cell.state) });
              if (cell.events.length > 0) {
                return (
                  <a
                    class={`cg-cell cg-cell--${cell.state}`}
                    style={style}
                    href={`#event-${cell.events[0]!.id}`}
                    data-role="cg-cell"
                    data-date={cell.date}
                    aria-label={`${label} (${cell.events.length})`}
                    aria-expanded="false"
                    aria-controls="cg-details"
                  ></a>
                );
              }
              return <span class={`cg-cell cg-cell--${cell.state}`} style={style} title={label} aria-hidden="true"></span>;
            }),
          )}
        </div>
      </div>
      <div class="cg-details" id="cg-details" data-role="cg-details" hidden tabindex={-1} aria-live="polite"></div>
      <script type="application/json" data-role="cg-data" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }} />
      <div class="cg-foot">
        <span>{t.calendar.timezone} · {t.calendar.selectHint}</span>
        <span>
          {grid.unplaced.length > 0 ? `${interpolate(t.calendar.unplaced, { n: grid.unplaced.length })} ` : ''}
          {t.calendar.older}
        </span>
      </div>
    </div>
  );
};

const Archive: FC<{ ctx: PageContext; model: HomeModel }> = ({ ctx, model }) => {
  const { t } = ctx;
  const items = model.filtered;
  const first = items.slice(0, INITIAL_VISIBLE);
  const rest = items.slice(INITIAL_VISIBLE);
  return (
    <section class="section" aria-labelledby="log-heading">
      <div class="section-head">
        <h2 id="log-heading">{t.archive.heading}</h2>
        <p class="section-sub">{t.archive.sub}</p>
      </div>
      {items.length === 0 ? <p class="notice">{t.archive.empty}</p> : null}
      <ol class="log" data-role="log">
        {first.map((e) => (
          <LogItem ctx={ctx} e={e} sourceById={model.sourceById} />
        ))}
      </ol>
      {rest.length > 0 ? (
        <>
          <noscript>
            <style dangerouslySetInnerHTML={{ __html: '[data-role="log-extra"]{display:block !important}[data-role="log-toggle"]{display:none}' }} />
          </noscript>
          <div data-role="log-extra" hidden>
            <ol class="log" style="margin-top:18px">
              {rest.map((e) => (
                <LogItem ctx={ctx} e={e} sourceById={model.sourceById} />
              ))}
            </ol>
          </div>
          <div class="log-more">
            <button class="btn" type="button" data-role="log-toggle" aria-expanded="false" data-show={interpolate(t.archive.showAll, { n: items.length })} data-hide={t.archive.showFewer}>
              <span data-role="log-toggle-label">{interpolate(t.archive.showAll, { n: items.length })}</span>
              <DownIcon class="icon-down" />
              <UpIcon class="icon-up" />
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
};
