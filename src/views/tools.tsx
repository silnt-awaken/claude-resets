import type { FC } from 'hono/jsx';
import { eventDay, qualifyingResets, resetBoard } from '../domain/content';
import { computeStats, formatDays } from '../domain/stats';
import { formatDate, formatNumber, localizePath } from '../i18n';
import { toolDict } from '../i18n/tools';
import { localizedTitle } from './components';
import { Layout, type PageContext } from './layout';
import { API_RATE_LIMITS_URL, CLAUDE_CODE_HELP_URL, CLAUDE_STATUS_URL, USAGE_HELP_URL } from './pages';

export const TOOL_REVISION = '2026-10-17-tools-2';
const BEST_PRACTICES = 'https://support.claude.com/en/articles/9797557-usage-limit-best-practices';
const CREDITS = 'https://support.claude.com/en/articles/12429409-manage-usage-credits-for-paid-claude-plans';
// Translations contain tokens, not executable HTML. JSX escapes each substituted value.
export function rich(template: string, values: Record<string, unknown>) {
  return template.split(/(\{\w+\})/g).map((part) => /^\{\w+\}$/.test(part) ? (values[part.slice(1, -1)] ?? part) : part);
}

export const ToolsTeaser: FC<{ ctx: PageContext }> = ({ ctx }) => {
  const m = toolDict(ctx.locale);
  return <section class="section help-teaser" aria-labelledby="limit-help-heading">
    <div><h2 id="limit-help-heading">{m.teaser.heading}</h2><p>{m.teaser.body}</p></div>
    <div class="tool-actions"><a class="btn btn--sun" href={localizePath(ctx.locale, '/tools')}>{m.teaser.cta} →</a><a href={localizePath(ctx.locale, '/reset-history')}>{m.nav.history} →</a></div>
  </section>;
};

export const ToolsPage: FC<{ ctx: PageContext; issue?: string }> = ({ ctx, issue }) => {
  const { locale } = ctx;
  const m = toolDict(locale);
  const path = (p: string) => localizePath(locale, p);
  const urls = { session: 'https://claude.ai/settings/usage', weekly: 'https://claude.ai/settings/usage', length: USAGE_HELP_URL, api: API_RATE_LIMITS_URL, outage: CLAUDE_STATUS_URL, banked: path('/') };
  const choices = Object.entries(m.issues).map(([key, value]) => ({ key, ...value, url: urls[key as keyof typeof urls] }));
  const selected = choices.find((choice) => choice.key === issue);
  const correction = `mailto:${ctx.cfg.supportContactEmail || 'silnt.awaken@gmail.com'}?subject=Claude%20Resets%20tools%20correction`;
  return <Layout ctx={ctx} title={`${m.title} | Claude Resets`} description={m.description}>
    <nav class="tool-nav" aria-label={m.nav.label}><a href={path('/')}>{m.nav.board}</a><a href={path('/reset-history')}>{m.nav.history}</a><a href={path('/about')}>{m.nav.verify}</a></nav>
    <p class="eyebrow">{m.eyebrow}</p><h1 class="page-title">{m.heading}</h1><p class="page-intro">{m.intro}</p>
    <section class="section card" aria-labelledby="troubleshoot-heading"><h2 id="troubleshoot-heading">{m.question}</h2>
      <form action={`${path('/tools')}#next-step`} method="get" class="limit-form"><label for="issue">{m.choose}</label><select name="issue" id="issue">{choices.map((choice) => <option value={choice.key} selected={issue === choice.key}>{choice.label}</option>)}</select><button class="btn btn--sun" type="submit">{m.show} →</button></form>
      <div id="next-step" class="tool-answer" tabindex={-1}>{selected ? <><h3>{selected.title}</h3><p>{selected.body}</p><a href={selected.url}>{selected.action} →</a></> : <p>{m.select}</p>}</div>
    </section>
    <section class="section card" aria-labelledby="planner-heading"><h2 id="planner-heading">{m.planner.heading}</h2>
      <p>{rich(m.planner.intro, { usage: <a href="https://claude.ai/settings/usage">{m.planner.usage}</a> })}</p><p class="status-line">{m.planner.privacy}</p>
      <form id="reset-planner" class="limit-form"><div class="planner-fields"><label for="session-reset">{m.planner.session}<span>{m.planner.optional}</span><input type="datetime-local" id="session-reset" /></label><label for="weekly-reset">{m.planner.weekly}<span>{m.planner.optional}</span><input type="datetime-local" id="weekly-reset" /></label></div><p id="planner-zone" class="status-line">{m.planner.zoneDefault}</p><label class="planner-remember"><input type="checkbox" id="remember-reset" /> {m.planner.remember}</label><div class="tool-actions"><button class="btn btn--sun" type="submit">{m.planner.calculate}</button><button class="btn" type="button" id="clear-planner">{m.planner.clear}</button></div></form>
      <div id="planner-result" class="tool-answer" role="status" aria-live="polite">{m.planner.empty}</div><noscript><p>{m.planner.noJs}</p></noscript>
    </section>
    <section class="section prose" aria-labelledby="guide-heading"><h2 id="guide-heading">{m.guide.heading}</h2><p>{m.guide.intro}</p>
      <div class="limit-guide">{choices.map((choice) => <article id={`guide-${choice.key}`}><h3>{choice.label}</h3><p>{choice.body}</p><a href={choice.url}>{choice.action} →</a></article>)}</div>
      <h2>{m.guide.countHeading}</h2><p>{m.guide.count}</p><h2>{m.guide.efficientHeading}</h2><p>{rich(m.guide.efficient, { best: <a href={BEST_PRACTICES}>{m.guide.best}</a> })}</p>
      <h2>{m.guide.billingHeading}</h2><p>{rich(m.guide.billing, { code: <a href={CLAUDE_CODE_HELP_URL}>{m.guide.code}</a> })}</p><p>{rich(m.guide.credits, { credits: <a href={CREDITS}>{m.guide.creditLink}</a> })}</p>
    </section>
    <section class="section prose"><h2>{m.maintenance.heading}</h2><p>{m.maintenance.body}</p><p>{rich(m.maintenance.correction, { contact: <a href={correction}>{m.maintenance.contact}</a> })}</p>
      <ul><li><a href={USAGE_HELP_URL}>{m.maintenance.usage}</a></li><li><a href={BEST_PRACTICES}>{m.maintenance.best}</a></li><li><a href={CLAUDE_CODE_HELP_URL}>{m.maintenance.code}</a></li><li><a href={API_RATE_LIMITS_URL}>{m.maintenance.api}</a></li></ul>
    </section>
    <script type="application/json" id="planner-i18n" dangerouslySetInnerHTML={{ __html: JSON.stringify(m.planner).replace(/</g, '\\u003c') }} />
    <script src="/reset-planner.js" defer nonce={ctx.nonce ?? undefined}></script>
  </Layout>;
};

export const HistoryPage: FC<{ ctx: PageContext }> = ({ ctx }) => {
  const { locale } = ctx;
  const m = toolDict(locale);
  const h = m.history;
  const path = (p: string) => localizePath(locale, p);
  const n = (value: number) => formatNumber(value, locale);
  const board = resetBoard(ctx.content.events, ctx.now);
  const applied = qualifyingResets(board);
  const stats = computeStats(applied, ctx.now);
  const monthly = new Map<string, { applied: number; banked: number }>();
  for (const e of board) { const month = eventDay(e).slice(0, 7); const row = monthly.get(month) ?? { applied: 0, banked: 0 }; row[e.resetOffer ? 'banked' : 'applied']++; monthly.set(month, row); }
  const latest = applied[0];
  return <Layout ctx={ctx} title={`${h.title} | Claude Resets`} description={h.description}>
    <nav class="tool-nav" aria-label={m.nav.label}><a href={path('/')}>{m.nav.board}</a><a href={path('/tools')}>{m.nav.tools}</a><a href={path('/sources')}>{m.nav.sources}</a></nav>
    <p class="eyebrow">{h.eyebrow}</p><h1 class="page-title">{h.title}</h1><p class="page-intro">{h.intro}</p>
    <section class="section card prose"><h2>{h.overview}</h2><p>{rich(h.counts, { start: formatDate(ctx.content.coverageStart, locale), end: formatDate(ctx.now.toISOString().slice(0, 10), locale), total: n(board.length), applied: n(applied.length), banked: n(board.length - applied.length) })}</p>
      <p>{latest ? rich(h.latest, { event: <a href={path(`/resets/${latest.id}`)}>{localizedTitle(latest, locale)}</a>, date: formatDate(eventDay(latest), locale) }) : null} {h.difference}</p>
    </section>
    <section class="section" aria-labelledby="monthly-heading"><h2 id="monthly-heading">{h.monthly}</h2><p>{h.monthlyIntro}</p><div class="tool-table-wrap"><table class="tool-table"><caption>{rich(h.caption, { start: formatDate(ctx.content.coverageStart, locale) })}</caption><thead><tr><th scope="col">{h.month}</th><th scope="col">{h.applied}</th><th scope="col">{h.banked}</th></tr></thead><tbody>{[...monthly.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([month, counts]) => <tr><th scope="row">{month}</th><td>{n(counts.applied)}</td><td>{n(counts.banked)}</td></tr>)}</tbody></table></div></section>
    <section class="section prose"><h2>{h.averageHeading}</h2><p>{stats.averageIntervalDays === null ? h.insufficient : rich(h.average, { average: formatDays(stats.averageIntervalDays), eligible: n(stats.eligibleGaps), pairs: n(stats.totalGaps), longest: formatDays(stats.longestGapDays!) })} {h.completed}</p><p>{h.uncertainty}</p>
      <h2>{h.scopeHeading}</h2><p>{rich(h.scope, { filter: <a href={`${path('/')}?audience=max&window=weekly`}>{h.filter}</a> })}</p>
      <h2>{h.typesHeading}</h2><p>{h.types}</p><h2>{h.howHeading}</h2><ol>{h.steps.map((step) => <li>{step}</li>)}</ol>
      <h2>{h.coverageHeading}</h2><p>{rich(h.coverage, { sources: <a href={path('/sources')}>{h.sources}</a> })}</p><p>{rich(h.dataset, { api: <a href={path('/api/docs')}>{h.api}</a>, revision: <code>{ctx.content.revision}</code>, about: <a href={path('/about')}>{h.about}</a>, contact: <a href={`mailto:${ctx.cfg.supportContactEmail || 'silnt.awaken@gmail.com'}?subject=Claude%20Resets%20history%20correction`}>{h.contact}</a> })}</p>
    </section>
  </Layout>;
};
