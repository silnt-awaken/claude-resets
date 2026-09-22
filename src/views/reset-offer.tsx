import type { FC } from 'hono/jsx';
import type { ResetEvent } from '../domain/types';
import { formatDate, interpolate, localizePath } from '../i18n';
import { localizedSummary, localizedTitle, primarySource } from './components';
import { ArrowIcon } from './icons';
import type { PageContext } from './layout';

export const ResetOfferCard: FC<{ ctx: PageContext; e: ResetEvent; detail?: boolean }> = ({ ctx, e, detail = false }) => {
  if (!e.resetOffer) return null;
  const { t, locale, now } = ctx;
  const expired = now.toISOString().slice(0, 10) > e.resetOffer.expiresOn;
  const withdrawn = e.eventStatus === 'cancelled' || e.eventStatus === 'retracted';
  return (
    <aside class="reset-offer" data-role="reset-offer" aria-labelledby={`offer-${e.id}`}>
      <div class="badge-row">
        <span class="chip chip--sun">{t.resetOffer.label}</span>
        <span class="chip">{interpolate(expired ? t.resetOffer.expired : t.resetOffer.expires, { date: formatDate(e.resetOffer.expiresOn, locale) })}</span>
      </div>
      <h2 id={`offer-${e.id}`}>{localizedTitle(e, locale)}</h2>
      {!detail ? <p>{localizedSummary(e, locale)}</p> : null}
      <p class="reset-offer-note">{t.resetOffer.note}</p>
      <div class="hero-links">
        {!expired && !withdrawn ? <a class="btn btn--sun" href="https://claude.ai/settings/usage" target="_blank" rel="noopener noreferrer">{t.hero.checkUsage} <ArrowIcon /></a> : null}
        <a class="btn" href={detail ? primarySource(e).url : localizePath(locale, `/resets/${e.id}`)}
          target={detail ? '_blank' : undefined} rel={detail ? 'noopener noreferrer' : undefined}>
          {detail ? t.hero.viewAnnouncement : t.resetOffer.details} <ArrowIcon />
        </a>
      </div>
    </aside>
  );
};
