import type { FC } from 'hono/jsx';
import { currentNotice } from '../domain/content';
import { CloseIcon } from './icons';
import type { PageContext } from './layout';

/** A single collapsed notice, separate from perks and reset history. */
export const NoticeStrip: FC<{ ctx: PageContext }> = ({ ctx }) => {
  const notice = currentNotice(ctx.content.notices, ctx.now);
  if (!notice) return null;
  const text = ctx.locale === 'en' ? notice : notice.translations[ctx.locale];
  const t = ctx.t.notices;
  return (
    <aside class="site-notice" aria-label={t.label} data-role="site-notice" data-notice-id={notice.id} data-display-until={notice.displayUntil}>
      <details class="site-notice-details">
        <summary><span class="site-notice-label">{notice.sourceType === 'official' ? t.official : t.reported}</span>{' '}<span>{text.title}</span></summary>
        <div class="site-notice-body">
          <p>{text.summary}</p>
          <div class="site-notice-links">
            <a href={notice.actionUrl} target="_blank" rel="noopener noreferrer">{notice.actionLabel === 'projects' ? t.openProjects : t.checkAccount} ↗</a>
            {notice.guideUrl && <a href={notice.guideUrl} target="_blank" rel="noopener noreferrer">{t.readGuide} ↗</a>}
            <a href={notice.sourceUrl} target="_blank" rel="noopener noreferrer">{notice.sourceType === 'official' ? t.officialSource : t.source} ↗</a>
          </div>
        </div>
      </details>
      <button class="site-notice-dismiss" type="button" data-role="notice-dismiss" aria-label={t.dismiss} title={t.dismiss} hidden><CloseIcon /></button>
    </aside>
  );
};
