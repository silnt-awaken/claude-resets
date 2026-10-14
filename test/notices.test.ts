import { afterEach, describe, expect, it } from 'vitest';
import noticesJson from '../content/notices.json';
import { __setContentForTests, currentNotice, loadContent } from '../src/domain/content';
import { siteNoticeSchema } from '../src/domain/schema';
import type { SiteNotice } from '../src/domain/types';
import { dict, LOCALES } from '../src/i18n';
import { snapshotFor } from './fixtures';
import { request } from './helpers';

afterEach(() => __setContentForTests(null));

const fixture = (extra: Partial<SiteNotice> = {}): SiteNotice => ({
  ...siteNoticeSchema.parse(noticesJson[0]), startsAt: '2000-01-01T00:00:00Z', displayUntil: '2099-01-01T00:00:00Z', ...extra,
});

describe('short notices', () => {
  it('validates translated content and rejects unsafe actions or backwards display windows', () => {
    for (const notice of noticesJson) expect(siteNoticeSchema.safeParse(notice).success).toBe(true);
    expect(siteNoticeSchema.safeParse(fixture({ actionUrl: 'https://evilclaude.ai/subscribe' })).success).toBe(false);
    expect(siteNoticeSchema.safeParse(fixture({ sourceUrl: 'javascript:alert(1)' })).success).toBe(false);
    expect(siteNoticeSchema.safeParse(fixture({ guideUrl: 'https://evilclaude.com/projects' })).success).toBe(false);
    expect(siteNoticeSchema.safeParse(fixture({ displayUntil: '1999-01-01T00:00:00Z' })).success).toBe(false);
    expect(siteNoticeSchema.safeParse({ ...fixture(), translations: {} }).success).toBe(false);
  });

  it('shows only the newest active notice, never before its start or at/after removal', () => {
    const notice = fixture({ startsAt: '2026-10-08T12:00:00Z', displayUntil: '2026-10-09T04:00:00Z' });
    expect(currentNotice([notice], new Date('2026-10-08T11:59:59Z'))).toBeNull();
    expect(currentNotice([notice], new Date(notice.startsAt))?.id).toBe(notice.id);
    expect(currentNotice([notice], new Date('2026-10-09T03:59:59Z'))?.id).toBe(notice.id);
    expect(currentNotice([notice], new Date(notice.displayUntil))).toBeNull();
    expect(currentNotice([notice], new Date('2026-10-10T00:00:00Z'))).toBeNull();
    expect(currentNotice([{ ...notice, active: false }], new Date(notice.startsAt))).toBeNull();
    expect(currentNotice([fixture({ id: 'older' }), notice], new Date(notice.startsAt))?.id).toBe(notice.id);
  });

  it('renders localized collapsed details and the real account link without a guessed countdown', async () => {
    const notice = fixture();
    __setContentForTests(snapshotFor([], { notices: [notice] }));
    for (const locale of LOCALES) {
      const html = await (await request(locale === 'en' ? '/' : `/${locale}`)).text();
      expect(html).toContain('data-role="site-notice"');
      expect(html).toContain(locale === 'en' ? notice.title : notice.translations[locale].title);
      expect(html).toContain('<details class="site-notice-details">');
      expect(html).toContain(`href="${notice.actionUrl}"`);
      expect(html).toContain(`href="${notice.sourceUrl}"`);
      expect(html).toContain('data-role="notice-dismiss"');
      expect(html).toContain(dict(locale).notices.reported);
      expect(html).toContain(dict(locale).notices.checkAccount);
      expect(html).not.toContain('data-role="perk-countdown"');
    }
  });

  it('labels official announcements accurately and links Projects, its guide and the source in every locale', async () => {
    const notice = siteNoticeSchema.parse(noticesJson.find((n) => n.sourceType === 'official'));
    __setContentForTests(snapshotFor([], { notices: [{ ...notice, startsAt: '2000-01-01T00:00:00Z', displayUntil: '2099-01-01T00:00:00Z' }] }));
    for (const locale of LOCALES) {
      const html = await (await request(locale === 'en' ? '/' : `/${locale}`)).text();
      const t = dict(locale).notices;
      expect(html).toContain(locale === 'en' ? notice.title : notice.translations[locale].title);
      expect(html).toContain(t.official);
      expect(html).toContain(t.openProjects);
      expect(html).toContain(t.readGuide);
      expect(html).toContain(t.officialSource);
      expect(html).not.toContain(t.reported);
      expect(html).not.toContain(t.source);
      for (const url of [notice.actionUrl, notice.guideUrl, notice.sourceUrl]) expect(html).toContain(`href="${url}"`);
    }
  });

  it('removes an expired notice from server HTML', async () => {
    __setContentForTests(snapshotFor([], { notices: [fixture({ displayUntil: '2001-01-01T00:00:00Z' })] }));
    expect(await (await request('/')).text()).not.toContain('data-role="site-notice"');
  });

  it('keeps notices out of perks, reset API results and announcement feeds', async () => {
    const baseline = loadContent();
    const notices = noticesJson.map((notice) => ({ ...siteNoticeSchema.parse(notice), startsAt: '2000-01-01T00:00:00Z', displayUntil: '2099-01-01T00:00:00Z' }));
    __setContentForTests(snapshotFor(baseline.events, { sources: baseline.sources, perks: baseline.perks, notices }));
    for (const path of ['/perks', '/api/v1/status', '/feed.xml', '/feed.json']) {
      const response = await request(path);
      expect(response.status, path).toBe(200);
      const html = await response.text();
      for (const notice of notices) expect(html, path).not.toContain(notice.id);
    }
  });
});
