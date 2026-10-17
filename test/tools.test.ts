import { afterEach, describe, expect, it } from 'vitest';
import { __setContentForTests } from '../src/domain/content';
import { makeEvent, snapshotFor } from './fixtures';
import { request } from './helpers';

afterEach(() => __setContentForTests(null));
describe('reader tools', () => {
  it('answers each issue without JavaScript and handles unrecognized input safely', async () => {
    for (const [issue, answer] of Object.entries({ session: 'Check the session reset time', weekly: 'Check the weekly timer separately', length: 'Carry a short handover into a new chat', api: 'Check the API response and Console', outage: 'Check service status before assuming', banked: 'Check whether your account can redeem it' })) {
      const res = await request(`/tools?issue=${issue}`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain(answer);
      expect(html).toContain(`value="${issue}" selected`);
    }
    const html = await (await request('/tools?issue=%3Cscript%3E')).text();
    expect(html).not.toContain('<script>');
    expect(html).toContain('Select a message above');
    expect(html).toContain('href="http://test.local/tools"');
    expect(html).not.toContain('hreflang="ja" href="http://test.local/ja/tools"');
  });
  it('keeps banked offers out of interval averages and shows reproducible history counts', async () => {
    __setContentForTests(snapshotFor([
      makeEvent({ id: 'first', at: '2026-06-01T00:00:00Z' }),
      makeEvent({ id: 'last', at: '2026-06-11T00:00:00Z' }),
      makeEvent({ id: 'banked', kind: 'credit', at: '2026-06-15T00:00:00Z', resetOffer: { expiresOn: '2026-07-15' } }),
      makeEvent({ id: 'draft', editorialStatus: 'draft', at: '2026-06-20T00:00:00Z' }),
    ]));
    const html = await (await request('/reset-history')).text();
    expect(html).toContain('3 reset announcements');
    expect(html).toContain('2 applied resets and 1 banked offer.');
    expect(html).toContain('10.0 days');
    expect(html).toContain('using 1 of 1 consecutive pairs');
    expect(html).toContain('href="/resets/last"');
    expect(html).not.toContain('/resets/draft');
    expect(html).toContain('<td>2</td><td>1</td>');
  });
  it('handles empty histories and links actual English tool pages from the sitemap and localized homepage', async () => {
    __setContentForTests(snapshotFor([]));
    const html = await (await request('/reset-history')).text();
    expect(html).toContain('not enough precisely timed');
    expect(html).not.toContain('NaN');
    const sitemap = await (await request('/sitemap.xml')).text();
    expect(sitemap).toContain('<loc>http://test.local/tools</loc>');
    expect(sitemap).toContain('<loc>http://test.local/reset-history</loc>');
    expect(sitemap).not.toContain('/ja/tools');
    expect(await (await request('/ja')).text()).toContain('href="/tools" lang="en"');
  });
});
