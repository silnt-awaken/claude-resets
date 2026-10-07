import type { FC } from 'hono/jsx';
import { closedPerks, openPerks } from '../domain/content';
import type { Locale, Perk, PerkText } from '../domain/types';
import { formatDate, formatUntil, formatUtcDateTime, interpolate, localizePath } from '../i18n';
import { ArrowIcon, GiftIcon } from './icons';
import { Layout, type PageContext } from './layout';

export function localizedPerk(p: Perk, locale: Locale): PerkText {
  return locale === 'en' ? p : p.translations[locale];
}

/** A localized "{date}" template around a UTC <time> that app.js rewrites to the reader's local time. */
const AtTime: FC<{ template: string; iso: string; locale: Locale }> = ({ template, iso, locale }) => {
  const [before, after] = template.split('{date}');
  const utc = formatUtcDateTime(iso, locale);
  return (
    <span>
      {before}
      <time datetime={iso} data-role="absolute-time" data-datetime={iso} title={utc}>
        {utc}
      </time>
      {after}
    </span>
  );
};

/**
 * One official offer: value, deadline countdown, who qualifies, steps, and the official link.
 * Past its deadline the card says so and drops the claim button (server-side, and live in app.js).
 */
export const PerkCard: FC<{ ctx: PageContext; p: Perk; heading?: 'h2' | 'h3'; compact?: boolean }> = ({ ctx, p, heading = 'h3', compact = false }) => {
  const { t, locale, now } = ctx;
  const text = localizedPerk(p, locale);
  const closesMs = p.closesAt ? Date.parse(p.closesAt) : null;
  const closed = closesMs != null && closesMs <= now.getTime();
  const id = `perk-${p.id}`;
  const quoted = p.sources.find((s) => s.excerpt);
  return (
    <article class="card perk-card" id={`perk-card-${p.id}`} data-role="perk" data-perk-id={p.id} data-closed={closed ? 'true' : undefined} aria-labelledby={id}>
      <div class="badge-row">
        <span class={`chip ${p.kind === 'credit' ? 'chip--sun' : 'chip--sky'}`}>{t.perks.kinds[p.kind]}</span>
        {closesMs == null ? (
          <span class="chip chip--muted">{t.perks.noDeadline}</span>
        ) : closed ? (
          <span class="chip chip--muted">{t.perks.closed}</span>
        ) : (
          <span class="chip chip--accent" data-role="perk-countdown" data-deadline={p.closesAt!}>
            {interpolate(t.perks.endsIn, { rel: formatUntil(closesMs - now.getTime(), locale) })}
          </span>
        )}
      </div>
      <p class="perk-value">{text.value}</p>
      {heading === 'h2' ? (
        <h2 id={id} class="perk-title">
          {text.title}
        </h2>
      ) : (
        <h3 id={id} class="perk-title">
          {text.title}
        </h3>
      )}
      <p>{text.summary}</p>
      {p.closesAt || p.expiresAt ? (
        <p class="perk-dates">
          {p.closesAt ? <AtTime template={p.cta.action === 'claim' ? t.perks.claimBy : t.perks.applyBy} iso={p.closesAt} locale={locale} /> : null}
          {p.closesAt && p.expiresAt ? ' · ' : null}
          {p.expiresAt ? <AtTime template={t.perks.expires} iso={p.expiresAt} locale={locale} /> : null}
        </p>
      ) : null}
      {compact ? (
        // Homepage: who qualifies and the steps fold away so the value, deadline and button stay above the fold.
        <details class="perk-more">
          <summary>
            {t.perks.eligibility} · {t.perks.howTo}
          </summary>
          <PerkFacts t={t} text={text} />
        </details>
      ) : (
        <PerkFacts t={t} text={text} />
      )}
      {quoted ? (
        <blockquote class="quote" lang="en">
          “{quoted.excerpt}”<cite>
            {t.archive.quoted} · {quoted.label}
          </cite>
        </blockquote>
      ) : null}
      <div class="perk-links">
        {!closed ? (
          <a class="btn btn--sun perk-cta" data-role="perk-cta" href={p.cta.url} target="_blank" rel="noopener noreferrer">
            {p.cta.action === 'claim' ? t.perks.claim : t.perks.apply} <ArrowIcon />
          </a>
        ) : null}
        <span class="status-line">
          {t.perks.source}:{' '}
          {p.sources.map((s, i) => (
            <>
              {i > 0 ? ' · ' : ''}
              <a href={s.url} target="_blank" rel="noopener noreferrer">
                {s.label}
              </a>
            </>
          ))}{' '}
          · {interpolate(t.perks.checked, { date: formatDate(p.verifiedAt, locale) })}
        </span>
      </div>
    </article>
  );
};

const PerkFacts: FC<{ t: PageContext['t']; text: PerkText }> = ({ t, text }) => (
  <dl class="perk-facts">
    <dt>{t.perks.eligibility}</dt>
    <dd>{text.eligibility}</dd>
    <dt>{t.perks.howTo}</dt>
    <dd>
      <ol class="perk-steps">
        {text.steps.map((s) => (
          <li>{s}</li>
        ))}
      </ol>
    </dd>
  </dl>
);

/** Strings app.js needs to keep countdowns live and flip a card to closed at its deadline. */
const PerkStrings: FC<{ ctx: PageContext }> = ({ ctx }) => (
  <script type="application/json" id="perk-i18n" dangerouslySetInnerHTML={{ __html: JSON.stringify({ endsIn: ctx.t.perks.endsIn, closed: ctx.t.perks.closed }).replace(/</g, '\\u003c') }} />
);

/** A perk closing within this window is flagged at the top of the homepage. */
export const PERK_FLAG_WINDOW_MS = 72 * 3_600_000;

/** Top-of-homepage pill for the open perk that closes soonest, only when that is within three days. */
export const PerkFlag: FC<{ ctx: PageContext; perks: Perk[] }> = ({ ctx, perks }) => {
  const { t, locale, now } = ctx;
  const p = perks.find((x) => x.closesAt && Date.parse(x.closesAt) - now.getTime() <= PERK_FLAG_WINDOW_MS);
  if (!p) return null;
  const left = Date.parse(p.closesAt!) - now.getTime();
  return (
    <a class="pill pill--rose perk-flag" href={`#perk-card-${p.id}`} data-role="perk-flag">
      <GiftIcon /> <span>{localizedPerk(p, locale).title}</span>
      <span class="perk-flag-time" data-role="perk-countdown" data-deadline={p.closesAt!}>
        {interpolate(t.perks.endsIn, { rel: formatUntil(left, locale) })}
      </span>
    </a>
  );
};

/** Homepage section: open perks only; renders nothing when none are open. */
export const PerksSection: FC<{ ctx: PageContext; perks: Perk[] }> = ({ ctx, perks }) => {
  const { t, locale } = ctx;
  if (perks.length === 0) return null;
  return (
    <section class="section" aria-labelledby="perks-heading" data-role="perks">
      <div class="section-head">
        <h2 id="perks-heading">{t.perks.heading}</h2>
        <p class="section-sub">{t.perks.sub}</p>
      </div>
      <div class="grid-2 perk-list">
        {perks.map((p) => (
          <PerkCard ctx={ctx} p={p} compact />
        ))}
      </div>
      <p class="status-line perk-note">{t.perks.note}</p>
      <p class="log-more">
        <a class="btn" href={localizePath(locale, '/perks')}>
          {t.perks.all} <ArrowIcon />
        </a>
      </p>
      <PerkStrings ctx={ctx} />
    </section>
  );
};

/** /perks: every open perk in full, then closed ones kept for reference. */
export const PerksPage: FC<{ ctx: PageContext }> = ({ ctx }) => {
  const { t, cfg, content, now } = ctx;
  const open = openPerks(content.perks, now);
  const closed = closedPerks(content.perks, now);
  return (
    <Layout ctx={ctx} title={`${t.perks.pageTitle} | ${cfg.siteName}`} description={t.perks.pageIntro}>
      <h1 class="page-title">{t.perks.pageTitle}</h1>
      <p class="page-intro">{t.perks.pageIntro}</p>
      <section class="section" aria-label={t.perks.heading} data-role="perks">
        {open.length > 0 ? (
          <div class="stack">
            {open.map((p) => (
              <PerkCard ctx={ctx} p={p} heading="h2" />
            ))}
          </div>
        ) : (
          <p class="notice">{t.perks.none}</p>
        )}
        <p class="status-line perk-note">{t.perks.note}</p>
      </section>
      {closed.length > 0 ? (
        <section class="section" aria-labelledby="perks-closed-heading">
          <div class="section-head">
            <h2 id="perks-closed-heading">{t.perks.closedHeading}</h2>
            <p class="section-sub">{t.perks.closedSub}</p>
          </div>
          <div class="stack">
            {closed.map((p) => (
              <PerkCard ctx={ctx} p={p} />
            ))}
          </div>
        </section>
      ) : null}
      <PerkStrings ctx={ctx} />
    </Layout>
  );
};
