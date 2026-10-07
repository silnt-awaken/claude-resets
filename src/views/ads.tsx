import type { FC } from 'hono/jsx';
import type { PageContext } from './layout';

/**
 * One responsive AdSense display unit. Renders only on pages that carry ads and only when a slot id is
 * configured (without one, Auto ads decide placement). app.js pushes each unit; the label shows once
 * Google fills it, and an unfilled unit collapses (see .ad-slot in styles.css).
 */
export const AdSlot: FC<{ ctx: PageContext; placement: string }> = ({ ctx, placement }) => {
  const { cfg, t } = ctx;
  if (!ctx.ads || !cfg.ads.slot) return null;
  return (
    <aside class="ad-slot" aria-label={t.ads.label} data-placement={placement}>
      <span class="ad-label">{t.ads.label}</span>
      <ins class="adsbygoogle" style="display:block" data-ad-client={cfg.ads.client!} data-ad-slot={cfg.ads.slot} data-ad-format="auto" data-full-width-responsive="true"></ins>
    </aside>
  );
};
