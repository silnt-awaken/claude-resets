import type { FC } from 'hono/jsx';
import { claudeStatusMessages } from '../i18n/claude-status';
import type { PageContext } from './layout';

export const ClaudeStatusCard: FC<{ ctx: PageContext }> = ({ ctx }) => {
  const m = claudeStatusMessages[ctx.locale];
  return <section class="section card claude-status" id="claude-status" data-state="loading" aria-labelledby="claude-status-heading">
    <div class="claude-status-head"><div><h2 id="claude-status-heading">{m.heading}</h2><p class="claude-status-intro">{m.intro}</p></div><a href="https://status.claude.com/" target="_blank" rel="noopener noreferrer">{m.source} ↗</a></div>
    <div role="status" aria-live="polite" aria-atomic="true"><p class="claude-status-summary" data-status-summary>{m.overall.unknown}</p><p class="status-line" data-status-hint hidden></p></div>
    <ul class="claude-status-services" data-status-services hidden></ul>
    <div data-status-incidents hidden><p class="status-line">{m.incidents}</p><ul></ul></div>
    <div class="claude-status-foot"><p class="status-line" data-status-checked></p><button class="link-btn" type="button" data-status-refresh hidden>{m.refresh}</button></div>
    <noscript><p>{m.noJs} <a href="https://status.claude.com/">{m.source} →</a></p></noscript>
    <script type="application/json" id="claude-status-i18n" dangerouslySetInnerHTML={{ __html: JSON.stringify(m).replace(/</g, '\\u003c') }} />
    <script src="/claude-status.js" defer nonce={ctx.nonce ?? undefined}></script>
  </section>;
};
