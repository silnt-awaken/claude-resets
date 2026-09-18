import type { FC } from 'hono/jsx';
import type { ContentSnapshot } from '../domain/content';
import { activeSponsors } from '../domain/content';
import type { Sponsor } from '../domain/types';
import type { SiteConfig } from '../env';
import { LOCALES, dict, formatDate, interpolate, localizePath, ogLocale, type Dict, type Locale } from '../i18n';
import { CloseIcon, CoinIcon, CupIcon, GitHubIcon, GlobeIcon, MoonIcon, ResetMark, RoadmapIcon, SunIcon, XIcon } from './icons';

export interface PageContext {
  locale: Locale;
  t: Dict;
  cfg: SiteConfig;
  content: ContentSnapshot;
  /** Locale-free app path, e.g. '/sources' or '/resets/2026-09-04-max-weekly'. */
  path: string;
  /** Query string to preserve across language switches (filters). */
  query: string;
  now: Date;
}

export function makeContext(args: { locale: Locale; cfg: SiteConfig; content: ContentSnapshot; path: string; query?: string; now?: Date }): PageContext {
  return { locale: args.locale, t: dict(args.locale), cfg: args.cfg, content: args.content, path: args.path, query: args.query ?? '', now: args.now ?? new Date() };
}

export function absoluteUrl(ctx: PageContext, locale: Locale, path = ctx.path, query = ctx.query): string {
  return `${ctx.cfg.siteUrl}${localizePath(locale, path)}${query}`;
}

interface LayoutProps {
  ctx: PageContext;
  title: string;
  description: string;
  /** Page-specific translated content exists for every locale (default true). */
  noindex?: boolean;
  /** Which sponsors to render: 'rails' on the tracker, 'none' elsewhere. */
  sponsors?: 'rails' | 'none';
  children?: unknown;
  ogImage?: boolean;
}

export const Layout: FC<LayoutProps> = ({ ctx, title, description, noindex, sponsors = 'none', children }) => {
  const { t, locale, cfg } = ctx;
  const canonical = absoluteUrl(ctx, locale);
  const active = sponsors === 'rails' ? activeSponsors(ctx.content.sponsors, ctx.now) : [];
  const left = active.filter((_, i) => i % 2 === 0);
  const right = active.filter((_, i) => i % 2 === 1);
  // Sponsor placements exist only once sponsorship is actually open: a real sponsor or a contact address.
  const showSponsors = sponsors === 'rails' && (active.length > 0 || !!cfg.supportContactEmail);
  return (
    <html lang={locale} data-theme="light">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <meta name="description" content={description} />
        <meta name="robots" content={noindex ? 'noindex,follow' : 'index,follow,max-image-preview:large'} />
        <meta name="theme-color" media="(prefers-color-scheme: light)" content="#fff4dd" />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#17130f" />
        <link rel="canonical" href={canonical} />
        {LOCALES.map((l) => (
          <link rel="alternate" hreflang={l} href={absoluteUrl(ctx, l)} />
        ))}
        <link rel="alternate" hreflang="x-default" href={absoluteUrl(ctx, 'en')} />
        <link rel="alternate" type="application/rss+xml" title={`${cfg.siteName} RSS`} href={`${cfg.siteUrl}/feed.xml`} />
        <link rel="alternate" type="application/feed+json" title={`${cfg.siteName} JSON Feed`} href={`${cfg.siteUrl}/feed.json`} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content={cfg.siteName} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={canonical} />
        <meta property="og:image" content={`${cfg.siteUrl}/icons/og.png`} />
        <meta property="og:image:alt" content={t.meta.ogAlt} />
        <meta property="og:locale" content={ogLocale(locale)} />
        {LOCALES.filter((l) => l !== locale).map((l) => (
          <meta property="og:locale:alternate" content={ogLocale(l)} />
        ))}
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
        <meta name="twitter:image" content={`${cfg.siteUrl}/icons/og.png`} />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="icon" href="/icons/icon.svg" type="image/svg+xml" />
        <link rel="icon" href="/icons/icon-192.png" type="image/png" sizes="192x192" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        <link rel="preload" as="font" type="font/woff2" href="/fonts/Baloo2.woff2" crossorigin="anonymous" />
        <script src="/theme.js"></script>
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body
        data-locale={locale}
        data-push-key={cfg.browserAlerts.publicKey ?? ''}
        data-push-enabled={cfg.browserAlerts.enabled ? 'true' : 'false'}
        data-cooldown-hours={String(cfg.reactionCooldownHours)}
        data-goal-pool={cfg.goal.live ? (cfg.goal.poolAddress ?? '') : ''}
        data-goal-usdg={cfg.goal.usdgAddress ?? ''}
        data-goal-chain-id={String(cfg.goal.chainId)}
        data-goal-rpc={cfg.goal.rpcUrl.split(',')[0]}
        data-goal-explorer={cfg.goal.explorerUrl}
        data-goal-min="1"
      >
        <a class="skip-link" href="#main">
          {t.nav.skip}
        </a>
        <div class="page">
          <Masthead ctx={ctx} />
          <main id="main">{children}</main>
          {showSponsors ? <SponsorRails ctx={ctx} left={left} right={right} /> : null}
          <SiteFooter ctx={ctx} />
        </div>
        {showSponsors ? <SponsorDialog ctx={ctx} /> : null}
        {cfg.goal.live ? <GoalStrings ctx={ctx} /> : null}
        <script src="/app.js" defer></script>
        {cfg.goal.live || cfg.goal.tokenAddress ? <script src="/goal.js" defer></script> : null}
      </body>
    </html>
  );
};

const LaunchBar: FC<{ ctx: PageContext }> = ({ ctx }) => {
  const { t, cfg } = ctx;
  const g = cfg.goal;
  if (!g.tokenAddress) return null;
  return (
    <div class="launch-bar" data-role="launch-bar">
      <span class="chip chip--accent">$RESETS</span>
      <span class="launch-live">{t.goal.launch.live}</span>
      <span class="launch-ca">
        <span class="mono">{t.goal.launch.ca}</span> <code>{g.tokenAddress}</code>
      </span>
      <button class="btn launch-copy" type="button" data-copy={g.tokenAddress} data-label-copied={t.goal.launch.copied}>
        {t.goal.launch.copy}
      </button>
      {g.buyUrl ? (
        <a class="btn btn--accent" href={g.buyUrl} target="_blank" rel="noopener noreferrer">
          {t.goal.launch.buy}
        </a>
      ) : null}
      <a class="status-line" href={`${g.explorerUrl}/token/${g.tokenAddress}`} target="_blank" rel="noopener noreferrer">
        {t.goal.launch.explorer}
      </a>
    </div>
  );
};

const Masthead: FC<{ ctx: PageContext }> = ({ ctx }) => {
  const { t, locale, cfg } = ctx;
  return (
    <>
    <LaunchBar ctx={ctx} />
    <header class="masthead">
      <a class="brand" href={localizePath(locale, '/')}>
        <span class="brand-mark" aria-hidden="true">
          <ResetMark />
        </span>
        <h1>{cfg.siteName}</h1>
      </a>
      <div class="masthead-side">
        <button class="icon-btn" type="button" data-role="lang-toggle" aria-haspopup="true" aria-expanded="false" aria-controls="language-menu" aria-label={t.nav.language} title={t.nav.language}>
          <GlobeIcon />
        </button>
        <nav class="language-menu" id="language-menu" aria-label={t.nav.language} data-open="false">
          {LOCALES.map((l) => (
            <a href={`${localizePath(l, ctx.path)}${ctx.query}`} lang={l} hreflang={l} aria-current={l === locale ? 'page' : undefined}>
              {dict(l).name}
            </a>
          ))}
        </nav>
        <a class="icon-btn" href={`${localizePath(locale, '/goal')}#token`} aria-label={t.nav.tokenomics} title={t.nav.tokenomics}>
          <CoinIcon />
        </a>
        <a class="icon-btn" href={`${localizePath(locale, '/goal')}#roadmap`} aria-label={t.nav.roadmap} title={t.nav.roadmap}>
          <RoadmapIcon />
        </a>
        {cfg.projectXUrl ? (
          <a class="icon-btn" href={cfg.projectXUrl} target="_blank" rel="noopener noreferrer" aria-label={interpolate(t.nav.projectX, { site: cfg.siteName })} title={interpolate(t.nav.projectX, { site: cfg.siteName })}>
            <XIcon />
          </a>
        ) : null}
        {cfg.repoUrl ? (
          <a class="icon-btn" href={cfg.repoUrl} target="_blank" rel="noopener noreferrer" aria-label="GitHub" title="GitHub">
            <GitHubIcon />
          </a>
        ) : null}
        <button class="icon-btn" type="button" data-role="theme-toggle" aria-pressed="false" aria-label={t.nav.themeToDark} data-label-light={t.nav.themeToLight} data-label-dark={t.nav.themeToDark} title={t.nav.themeToDark}>
          <span class="theme-icon-moon">
            <MoonIcon />
          </span>
          <span class="theme-icon-sun">
            <SunIcon />
          </span>
        </button>
      </div>
    </header>
    </>
  );
};

const SiteFooter: FC<{ ctx: PageContext }> = ({ ctx }) => {
  const { t, locale, cfg } = ctx;
  const owner = cfg.ownerXUrl ? (
    <a href={cfg.ownerXUrl} target="_blank" rel="noopener noreferrer">
      {cfg.ownerName}
    </a>
  ) : (
    <span>{cfg.ownerName}</span>
  );
  const [wantBefore, rest] = t.footer.wantData.split('{api}');
  const [wantMid, wantAfter] = (rest ?? '').split('{mcp}');
  const [builtBefore, builtAfter] = t.footer.builtBy.split('{owner}');
  return (
    <footer class="site-footer">
      <nav class="footer-langs" aria-label={t.nav.language}>
        {LOCALES.map((l) => (
          <a href={`${localizePath(l, ctx.path)}${ctx.query}`} lang={l} hreflang={l} aria-current={l === locale ? 'page' : undefined}>
            {dict(l).name}
          </a>
        ))}
      </nav>
      <p>{t.footer.data}</p>
      <p>
        {wantBefore}
        <a href="/api/docs">API</a>
        {wantMid}
        <a href="/mcp/docs">MCP</a>
        {wantAfter}
      </p>
      <p>
        {builtBefore}
        {owner}
        {builtAfter}{' '}
        {cfg.supportUrl ? (
          <a href={cfg.supportUrl} target="_blank" rel="noopener noreferrer">
            <CupIcon class="inline-icon" /> {t.support.cta}
          </a>
        ) : (
          <a href={localizePath(locale, '/support')}>{t.support.cta}</a>
        )}
      </p>
      <nav class="footer-links" aria-label="Site">
        <a href={localizePath(locale, '/sources')}>{t.nav.sources}</a>
        <a href={localizePath(locale, '/about')}>{t.nav.about}</a>
        <a href={localizePath(locale, '/support')}>{t.nav.support}</a>
        <a href={localizePath(locale, '/privacy')}>{t.nav.privacy}</a>
        <a href="/feed.xml">{t.nav.feed}</a>
        <a href="/feed.json">{t.nav.jsonFeed}</a>
        {cfg.repoUrl ? (
          <a href={cfg.repoUrl} target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
        ) : null}
      </nav>
      <p class="status-line">
        {interpolate(t.footer.lastReview, { date: formatDate(ctx.content.review.lastSourceReviewAt.slice(0, 10), locale) })} {t.footer.design}
      </p>
    </footer>
  );
};

const SponsorCard: FC<{ s: Sponsor; t: Dict }> = ({ s, t }) => (
  <a class="sponsor-card" href={`/sponsor/${s.slug}`} target="_blank" rel="sponsored noopener noreferrer">
    <span class="sponsor-label">{t.sponsors.label}</span>
    <span class="sponsor-logo" aria-hidden="true">
      {s.logo ? <img src={s.logo} alt="" width="36" height="36" loading="lazy" /> : s.name.slice(0, 1).toUpperCase()}
    </span>
    <span>
      <strong>{s.name}</strong>
      <span class="tagline">{s.tagline}</span>
    </span>
  </a>
);

const SponsorRails: FC<{ ctx: PageContext; left: Sponsor[]; right: Sponsor[] }> = ({ ctx, left, right }) => {
  const { t } = ctx;
  const invite =
    left.length + right.length === 0 ? (
      <button class="sponsor-card sponsor-invite" type="button" data-role="sponsor-open" aria-haspopup="dialog">
        <span class="sponsor-label">{t.sponsors.label}</span>
        <span class="sponsor-logo" aria-hidden="true">
          ?
        </span>
        <span>
          <strong>{t.sponsors.invite}</strong>
          <span class="tagline">{t.sponsors.inviteSub}</span>
        </span>
      </button>
    ) : null;
  return (
    <div class="sponsor-rails">
      <aside class="sponsor-rail sponsor-rail--left" aria-label={t.sponsors.label}>
        {left.map((s) => (
          <SponsorCard s={s} t={t} />
        ))}
        {invite}
      </aside>
      <aside class="sponsor-rail sponsor-rail--right" aria-label={t.sponsors.label}>
        {right.map((s) => (
          <SponsorCard s={s} t={t} />
        ))}
      </aside>
    </div>
  );
};

const SponsorDialog: FC<{ ctx: PageContext }> = ({ ctx }) => {
  const { t, cfg } = ctx;
  return (
    <dialog id="sponsor-dialog" aria-labelledby="sponsor-dialog-title">
      <div class="dialog-head">
        <h2 id="sponsor-dialog-title">{t.sponsors.heading}</h2>
        <button class="icon-btn" type="button" data-role="sponsor-close" aria-label={t.sponsors.close}>
          <CloseIcon />
        </button>
      </div>
      <div class="dialog-body">
        <p>
          <strong>{t.sponsors.sub}</strong>
        </p>
        <p>{t.sponsors.body}</p>
        <div class="sponsor-card" aria-hidden="true">
          <span class="sponsor-label">{t.sponsors.label}</span>
          <span class="sponsor-logo">?</span>
          <span>
            <strong>{t.sponsors.invite}</strong>
            <span class="tagline">{t.sponsors.inviteSub}</span>
          </span>
        </div>
        <p class="status-line">{t.sponsors.placement}</p>
        {cfg.supportContactEmail ? (
          <p>
            <a class="btn btn--sun" href={`mailto:${cfg.supportContactEmail}?subject=${encodeURIComponent(`${cfg.siteName} sponsorship`)}`}>
              {t.sponsors.contact}
            </a>
          </p>
        ) : (
          <p class="notice notice--warn">{t.sponsors.unavailable}</p>
        )}
      </div>
    </dialog>
  );
};

/** Localized strings for goal.js (the contribution sheet and its inline no-wallet help). */
const GoalStrings: FC<{ ctx: PageContext }> = ({ ctx }) => (
  <script type="application/json" id="goal-i18n" dangerouslySetInnerHTML={{ __html: JSON.stringify(ctx.t.goal.sheet).replace(/</g, '\u003c') }} />
);
