import { afterEach, describe, expect, it } from 'vitest';
import perksJson from '../content/perks.json';
import { __setContentForTests, closedPerks, loadContent, openPerks } from '../src/domain/content';
import { perkSchema } from '../src/domain/schema';
import type { Perk } from '../src/domain/types';
import { LOCALES, formatUntil } from '../src/i18n';
import { snapshotFor } from './fixtures';
import { request } from './helpers';

afterEach(() => __setContentForTests(null));

const text = { title: 'Fixture credit', value: '$1 on Pro', summary: 'A fixture.', eligibility: 'Fixture readers.', steps: ['Open the page.', 'Claim it.'] };

function makePerk(over: Partial<Perk> = {}): Perk {
  return {
    ...text,
    id: 'fixture-credit',
    kind: 'credit',
    cta: { url: 'https://claude.ai/code/claim-credit/1', action: 'claim' },
    closesAt: '2099-01-01T00:00:00Z',
    expiresAt: '2099-02-01T00:00:00Z',
    announcedOn: '2026-09-23',
    sources: [{ url: 'https://support.claude.com/en/articles/1', label: 'Claude Help Center', excerpt: 'Fixture quote.' }],
    verifiedAt: '2026-10-06',
    verificationMethod: 'Fixture.',
    translations: { 'zh-CN': text, 'zh-TW': text, ja: text, ko: text },
    active: true,
    priority: 1,
    ...over,
  };
}

describe('perks content', () => {
  it('bundles valid, translated perks', () => {
    for (const p of perksJson) expect(perkSchema.safeParse(p).success, p.id).toBe(true);
    expect(loadContent().perks.map((p) => p.id)).toEqual(['cloud-sessions-credit', 'claude-for-startups']);
  });

  it('stores the cloud credit deadline as the official 11:59 PM Pacific cutoffs in UTC', () => {
    const credit = loadContent().perks.find((p) => p.id === 'cloud-sessions-credit')!;
    expect(credit.closesAt).toBe('2026-10-08T06:59:00Z'); // Oct 7 23:59 PDT (UTC-7)
    expect(credit.expiresAt).toBe('2026-11-05T07:59:00Z'); // Nov 4 23:59 PST (UTC-8, after Nov 1)
  });

  it('only links readers to Anthropic properties', () => {
    expect(perkSchema.safeParse(makePerk({ cta: { url: 'https://claude-credit.example/claim', action: 'claim' } })).success).toBe(false);
    expect(perkSchema.safeParse(makePerk({ cta: { url: 'https://evilclaude.ai/claim', action: 'claim' } })).success).toBe(false);
    expect(perkSchema.safeParse(makePerk({ cta: { url: 'http://claude.ai/claim', action: 'claim' } })).success).toBe(false);
    expect(perkSchema.safeParse(makePerk({ sources: [{ url: 'https://blog.example/post', label: 'Blog' }] })).success).toBe(false);
    expect(perkSchema.safeParse(makePerk({ cta: { url: 'https://platform.claude.com/offers/x', action: 'apply' } })).success).toBe(true);
  });

  it('rejects impossible dates and incomplete translations', () => {
    expect(perkSchema.safeParse(makePerk({ expiresAt: '2098-01-01T00:00:00Z' })).success).toBe(false);
    expect(perkSchema.safeParse(makePerk({ closesAt: '2026-09-01T00:00:00Z' })).success).toBe(false);
    expect(perkSchema.safeParse(makePerk({ translations: { 'zh-CN': text, 'zh-TW': text, ja: text, ko: { ...text, steps: ['Only one.'] } } })).success).toBe(false);
    const { ja: _ja, ...missing } = makePerk().translations;
    expect(perkSchema.safeParse({ ...makePerk(), translations: missing }).success).toBe(false);
  });
});

describe('perk deadlines', () => {
  const soon = makePerk({ id: 'soon', closesAt: '2026-10-08T06:59:00Z', expiresAt: null });
  const later = makePerk({ id: 'later', closesAt: '2026-12-01T00:00:00Z', expiresAt: null });
  const openEnded = makePerk({ id: 'open-ended', closesAt: null, expiresAt: null, priority: 0 });
  const withdrawn = makePerk({ id: 'withdrawn', active: false });

  it('lists open perks soonest deadline first, open-ended after, never withdrawn ones', () => {
    expect(openPerks([openEnded, later, withdrawn, soon], new Date('2026-10-06T12:00:00Z')).map((p) => p.id)).toEqual(['soon', 'later', 'open-ended']);
  });

  it('closes a perk exactly at its deadline and keeps it in the closed list', () => {
    const at = new Date('2026-10-08T06:59:00Z');
    expect(openPerks([soon], new Date(at.getTime() - 1)).map((p) => p.id)).toEqual(['soon']);
    expect(openPerks([soon], at)).toHaveLength(0);
    expect(closedPerks([soon, openEnded, withdrawn], at).map((p) => p.id)).toEqual(['soon']);
  });

  it('formats time left with hour precision until two days out', () => {
    expect(formatUntil(31 * 3_600_000, 'en')).toBe('in 31 hours');
    expect(formatUntil(59 * 60_000, 'en')).toBe('in 59 minutes');
    expect(formatUntil(5 * 86_400_000, 'en')).toBe('in 5 days');
    expect(formatUntil(10_000, 'en')).toBe('in 1 minute');
  });
});

describe('perk pages', () => {
  it('shows open perks on the homepage with the official link, countdown and local-time deadline', async () => {
    __setContentForTests(snapshotFor([], { perks: [makePerk()] }));
    const html = await (await request('/')).text();
    expect(html).toContain('data-role="perks"');
    expect(html).toContain('data-perk-id="fixture-credit"');
    expect(html).toContain('href="https://claude.ai/code/claim-credit/1"');
    expect(html).toContain('data-role="perk-countdown" data-deadline="2099-01-01T00:00:00Z"');
    expect(html).toContain('data-role="absolute-time" data-datetime="2099-01-01T00:00:00Z"');
    expect(html).toContain('Claim the credit');
    expect(html).toContain('id="perk-i18n"');
    expect(html).toContain('href="/perks"');
  });

  it('flags a perk at the top of the homepage only in its last three days', async () => {
    const iso = (ms: number) => new Date(Date.now() + ms).toISOString().replace(/\.\d+Z$/, 'Z');
    __setContentForTests(snapshotFor([], { perks: [makePerk({ closesAt: iso(5 * 3_600_000), expiresAt: null })] }));
    const soon = await (await request('/')).text();
    expect(soon).toContain('data-role="perk-flag"');
    expect(soon).toContain('href="#perk-card-fixture-credit"');
    expect(soon).toContain('id="perk-card-fixture-credit"');
    __setContentForTests(snapshotFor([], { perks: [makePerk({ closesAt: iso(4 * 86_400_000), expiresAt: null })] }));
    const later = await (await request('/')).text();
    expect(later).toContain('data-role="perks"');
    expect(later).not.toContain('data-role="perk-flag"');
  });

  it('drops a closed perk from the homepage and shows it on /perks without a claim link', async () => {
    __setContentForTests(snapshotFor([], { perks: [makePerk({ closesAt: '2026-09-30T00:00:00Z', expiresAt: null })] }));
    const home = await (await request('/')).text();
    expect(home).not.toContain('data-role="perks"');
    const page = await (await request('/perks')).text();
    expect(page).toContain('Closed offers');
    expect(page).toContain('data-closed="true"');
    expect(page).not.toContain('href="https://claude.ai/code/claim-credit/1"');
    expect(page).toContain('https://support.claude.com/en/articles/1');
  });

  it('says so when no perk is open', async () => {
    __setContentForTests(snapshotFor([], { perks: [] }));
    expect(await (await request('/perks')).text()).toContain('No open offers right now.');
  });

  it('renders the translated perk in every locale and lists /perks in the sitemap', async () => {
    __setContentForTests(snapshotFor([], { perks: [makePerk({ translations: { 'zh-CN': { ...text, title: 'ZH-CN title' }, 'zh-TW': { ...text, title: 'ZH-TW title' }, ja: { ...text, title: 'JA title' }, ko: { ...text, title: 'KO title' } } })] }));
    for (const locale of LOCALES.filter((l) => l !== 'en')) {
      const html = await (await request(`/${locale}/perks`)).text();
      expect(html, locale).toContain(`${locale.toUpperCase()} title`);
    }
    const sitemap = await (await request('/sitemap.xml')).text();
    expect(sitemap).toContain('/perks</loc>');
    expect(sitemap).toContain('/ja/perks</loc>');
  });
});
