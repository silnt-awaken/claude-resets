import { afterEach, describe, expect, it } from 'vitest';
import { __setContentForTests, loadContent } from '../src/domain/content';
import { LOCALES } from '../src/i18n';
import { makeEvent, snapshotFor } from './fixtures';
import { request } from './helpers';

afterEach(() => __setContentForTests(null));

function stripJsonScripts(html: string): string {
  return html.replace(/<script type="application\/json"[^>]*>[\s\S]*?<\/script>/g, '');
}

const PAGES = ['/', '/sources', '/about', '/support', '/privacy', '/resets/2026-09-04-max-weekly', '/api/docs', '/mcp/docs'];

describe('pages', () => {
  it('renders every page in every locale with security headers and no raw placeholders', async () => {
    for (const locale of LOCALES) {
      for (const path of PAGES) {
        const url = locale === 'en' ? path : `/${locale}${path === '/' ? '' : path}`;
        const res = await request(url);
        expect(res.status, url).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/html');
        expect(res.headers.get('content-security-policy')).toContain("script-src 'self'");
        expect(res.headers.get('x-content-type-options')).toBe('nosniff');
        const html = await res.text();
        expect(html.startsWith('<!doctype html>')).toBe(true);
        expect(html).toContain(`<html lang="${locale}"`);
        const visible = stripJsonScripts(html).replace(/<pre[\s\S]*?<\/pre>/g, '');
        expect(visible, `${url} has an uninterpolated placeholder`).not.toMatch(/\{(date|n|count|hours|site|owner|eligible|total|rel|state|audience|window|provider|lang)\}/);
        expect(visible).not.toContain('undefined');
        expect(visible).not.toContain('[object Object]');
      }
    }
  });

  it('shows the latest reset, statistics, calendar, archive, sources, support and footer on the tracker', async () => {
    const html = await (await request('/')).text();
    expect(html).toContain('data-role="hero"');
    expect(html).toContain('data-event-id="2026-09-04-max-weekly"');
    expect(html).toContain('data-role="beg"');
    expect(html).toContain('class="stats"');
    expect(html).toContain('data-role="cg"');
    expect(html).toContain('data-role="log"');
    expect(html).toContain('data-role="log-extra"');
    expect(html).toContain('Show all 12 resets');
    expect(html).toContain('Tip for coffee');
    expect(html).toContain('not affiliated with or endorsed by Anthropic');
    expect(html).toContain('https://claude.ai/settings/usage');
    expect(html).toContain('/feed.xml');
    expect(html).toContain('Other limit announcements');
    expect(html).not.toContain('Claim reset');
  });

  it('keeps the tracker readable without JavaScript: all archive entries, anchors and full text are in the HTML', async () => {
    const html = await (await request('/')).text();
    for (const e of loadContent().events.filter((x) => x.kind === 'usage_reset')) {
      expect(html).toContain(`data-event-id="${e.id}"`);
      expect(html).toContain(`id="event-${e.id}"`); // calendar cells link here without JS
    }
    expect(html).toContain('<noscript><style>[data-role="log-extra"]{display:block !important}');
    expect(html).not.toContain('is-clamped'); // clamping is applied by the script, never server-side
    expect(html).toContain('href="#event-2026-09-04-max-weekly"');
  });

  it('language links on a localized 404 keep a single locale prefix', async () => {
    const html = await (await request('/ja/resets/nope')).text();
    expect(html).toContain('href="/zh-CN/resets/nope"');
    expect(html).not.toContain('/zh-CN/ja/');
    expect(html).toContain('hreflang="en" href="http://test.local/resets/nope"');
  });

  it('persists filters in the URL and applies them to hero, stats, calendar and archive', async () => {
    const html = await (await request('/?audience=max&window=weekly')).text();
    expect(html).toContain('data-event-id="2026-09-04-max-weekly"');
    expect(html).toContain('Show all 11 resets');
    expect(html).toContain('href="/zh-CN?audience=max&amp;window=weekly"');
    const ja = await (await request('/ja?audience=max')).text();
    expect(ja).toContain('<html lang="ja"');
    expect(ja).toContain('audience=max');
  });

  it('renders the honest empty, date-only and pending-reset states', async () => {
    __setContentForTests(snapshotFor([]));
    const empty = await (await request('/')).text();
    expect(empty).toContain('No confirmed reset is published yet.');
    expect(empty).toContain('No resets are published yet.');

    __setContentForTests(
      snapshotFor([
        makeEvent({ id: 'dated', on: '2026-08-20', dateTimezone: 'unknown', title: 'A date-only reset with a rather long source name for layout checks' }),
        makeEvent({ id: 'promise', eventStatus: 'announced', at: '2026-09-10T00:00:00Z', schedule: { statedAt: '2026-09-12T00:00:00Z', statedWindow: null } }),
      ]),
    );
    const html = await (await request('/')).text();
    expect(html).toContain('the exact time is not established');
    expect(html).toContain('Announced, not yet confirmed');
    expect(html).toContain('Confirmation is still pending');
    expect(html).toContain('have a date but no established UTC day');
  });

  it('returns real 404s with a way back for unknown routes, events and locales', async () => {
    for (const [path, home] of [
      ['/nope', '/'],
      ['/resets/does-not-exist', '/'],
      ['/ja/resets/does-not-exist', '/ja'],
      ['/fr', '/'],
      ['/zh-CN/nothing', '/zh-CN'],
    ] as const) {
      const res = await request(path);
      expect(res.status, path).toBe(404);
      const html = await res.text();
      expect(html, path).toContain(`class="btn btn--sun" href="${home}"`);
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
    const ja = await request('/ja/resets/nope');
    expect(await ja.text()).toContain('<html lang="ja"');
    const en = await (await request('/nope')).text();
    expect(en).toContain('Back to the tracker');
  });

  it('serves robots, sitemap and manifest metadata using the configured origin', async () => {
    const robots = await (await request('/robots.txt', {}, { SITE_URL: 'https://example.test' })).text();
    expect(robots).toContain('Sitemap: https://example.test/sitemap.xml');
    const sitemap = await (await request('/sitemap.xml', {}, { SITE_URL: 'https://example.test' })).text();
    expect(sitemap).toContain('https://example.test/zh-CN/sources');
    expect(sitemap).toContain('https://example.test/resets/2026-09-04-max-weekly');
    expect(sitemap).not.toContain('claude-resets.com');
    const home = await (await request('/', {}, { SITE_URL: 'https://example.test' })).text();
    expect(home).toContain('<link rel="canonical" href="https://example.test/"');
    expect(home).toContain('hreflang="ko" href="https://example.test/ko"');
  });

  it('shows the support destination everywhere when configured and an honest state when not', async () => {
    const configured = await (await request('/', {}, { SUPPORT_URL: 'https://buymeacoffee.com/example' })).text();
    expect(configured.match(/https:\/\/buymeacoffee\.com\/example/g)?.length).toBeGreaterThanOrEqual(3);
    expect(configured).toContain('rel="noopener noreferrer"');
    const support = await (await request('/support', {}, { SUPPORT_URL: 'https://buymeacoffee.com/example' })).text();
    expect(support).toContain('Hosted by Buy Me a Coffee');
    const missing = await (await request('/support', {}, { SUPPORT_URL: '' })).text();
    expect(missing).toContain('The support link is not available yet.');
    const invalid = await (await request('/support', {}, { SUPPORT_URL: 'http://insecure.example' })).text();
    expect(invalid).toContain('The support link is not available yet.');
    expect(invalid).not.toContain('insecure.example');
  });

  it('shows Telegram and browser alerts as unavailable when unconfigured', async () => {
    const html = await (await request('/', {}, { BROWSER_ALERTS_ENABLED: 'false' })).text();
    expect(html).toContain('data-role="telegram-unavailable"');
    expect(html).toContain('data-push-enabled="false"');
    expect(html).toContain('aria-disabled="true"');
    const enabled = await (await request('/')).text();
    expect(enabled).toContain('data-push-enabled="true"');
    expect(enabled).toContain('data-push-key="B');
    const withTelegram = await (await request('/', {}, { TELEGRAM_CHANNEL_URL: 'https://t.me/example_channel' })).text();
    expect(withTelegram).toContain('href="https://t.me/example_channel"');
  });

  it('escapes user-facing content and never leaks secrets or subscriber data', async () => {
    __setContentForTests(snapshotFor([makeEvent({ id: 'xss', title: '<script>alert(1)</script> & "quotes"', summary: '<img src=x onerror=alert(1)>' })]));
    const html = await (await request('/')).text();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<img src=x');
    const withSecrets = await (await request('/', {}, { CONTENT_PUBLISH_TOKEN: 'SECRET-TOKEN-VALUE-XYZ', VAPID_PRIVATE_KEY: 'PRIVATE-KEY-XYZ' })).text();
    expect(withSecrets).not.toContain('SECRET-TOKEN-VALUE-XYZ');
    expect(withSecrets).not.toContain('PRIVATE-KEY-XYZ');
  });

  it('redirects only known active sponsor slugs and never arbitrary destinations', async () => {
    __setContentForTests(
      snapshotFor([], {
        sponsors: [
          { slug: 'live', name: 'Live', tagline: 'Active', logo: null, url: 'https://sponsor.example/live', active: true, startsAt: null, endsAt: null, priority: 1 },
          { slug: 'expired', name: 'Expired', tagline: 'Old', logo: null, url: 'https://sponsor.example/old', active: true, startsAt: null, endsAt: '2020-01-01T00:00:00Z', priority: 2 },
          { slug: 'off', name: 'Off', tagline: 'Inactive', logo: null, url: 'https://sponsor.example/off', active: false, startsAt: null, endsAt: null, priority: 3 },
        ],
      }),
    );
    const live = await request('/sponsor/live');
    expect(live.status).toBe(302);
    expect(live.headers.get('location')).toBe('https://sponsor.example/live');
    expect((await request('/sponsor/expired')).status).toBe(404);
    expect((await request('/sponsor/off')).status).toBe(404);
    expect((await request('/sponsor/live?to=https://evil.example')).headers.get('location')).toBe('https://sponsor.example/live');
    expect((await request('/sponsor/https%3A%2F%2Fevil.example')).status).toBe(404);
    const home = await (await request('/')).text();
    expect(home).toContain('href="/sponsor/live"');
    expect(home).not.toContain('sponsor.example/old');
    expect(home).toContain('rel="sponsored noopener noreferrer"');
  });

  it('shows at most one sponsorship invitation with no active sponsors', async () => {
    const html = await (await request('/')).text();
    expect(html.match(/data-role="sponsor-open"/g)?.length ?? 0).toBe(1);
    expect(html).toContain('<dialog id="sponsor-dialog"');
  });
});
