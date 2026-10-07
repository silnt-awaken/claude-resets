import { describe, expect, it } from 'vitest';
import { adsConfig } from '../src/config';
import { request } from './helpers';

const ADS = { ADSENSE_CLIENT: 'ca-pub-1234567890123456', ADSENSE_SLOT: '9876543210' };
const AD_PAGES = ['/', '/perks', '/sources', '/about', '/support', '/privacy', '/resets/2026-09-04-max-weekly', '/api/docs', '/mcp/docs', '/ko', '/ja/perks'];

function nonceOf(csp: string | null): string | undefined {
  return csp?.match(/'nonce-([^']+)'/)?.[1];
}

/** Executable script tags (JSON data blocks are not scripts to the CSP). */
function scriptTags(html: string): string[] {
  return (html.match(/<script\b[^>]*>/g) ?? []).filter((tag) => !tag.includes('type="application/json"'));
}

describe('ads off (the default)', () => {
  it('serves no ad code, no ads.txt and the strict policy', async () => {
    for (const path of ['/', '/perks', '/goal', '/privacy']) {
      const res = await request(path);
      const html = await res.text();
      expect(html, path).not.toContain('adsbygoogle');
      expect(html, path).not.toContain('google-adsense-account');
      expect(html, path).not.toContain('nonce=');
      expect(res.headers.get('content-security-policy'), path).toContain("script-src 'self'");
    }
    expect((await request('/ads.txt')).status).toBe(404);
    expect(await (await request('/privacy')).text()).toContain('no analytics scripts, ad trackers');
  });
});

describe('ads on', () => {
  it('loads AdSense on content pages with one nonce shared by every script and the policy', async () => {
    for (const path of AD_PAGES) {
      const res = await request(path, {}, ADS);
      expect(res.status, path).toBe(200);
      const csp = res.headers.get('content-security-policy');
      const nonce = nonceOf(csp);
      expect(nonce, path).toBeTruthy();
      expect(csp).toContain("'strict-dynamic'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("base-uri 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).not.toContain('default-src');
      const html = await res.text();
      expect(html).toContain('<meta name="google-adsense-account" content="ca-pub-1234567890123456"');
      expect(html).toContain('src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1234567890123456"');
      const tags = scriptTags(html);
      expect(tags.length, path).toBeGreaterThan(2);
      for (const tag of tags) expect(tag, `${path}: ${tag}`).toContain(`nonce="${nonce}"`);
    }
  });

  it('issues a fresh nonce per response and sends no policy with a 304', async () => {
    const a = await request('/sources', {}, ADS);
    const b = await request('/sources', {}, ADS);
    expect(nonceOf(a.headers.get('content-security-policy'))).not.toBe(nonceOf(b.headers.get('content-security-policy')));
    const etag = a.headers.get('etag')!;
    const notModified = await request('/sources', { headers: { 'if-none-match': etag } }, ADS);
    expect(notModified.status).toBe(304);
    expect(notModified.headers.get('content-security-policy')).toBeNull();
    // Switching ads off must not revalidate a page that still carries ad code.
    expect((await request('/sources', { headers: { 'if-none-match': etag } })).status).toBe(200);
  });

  it('keeps /goal and error pages ad-free under the strict policy', async () => {
    for (const path of ['/goal', '/ko/goal', '/no-such-page']) {
      const res = await request(path, {}, ADS);
      const html = await res.text();
      expect(html, path).not.toContain('adsbygoogle');
      expect(html, path).not.toContain('nonce=');
      expect(res.headers.get('content-security-policy'), path).toContain("script-src 'self'");
    }
  });

  it('places in-page units only when a slot id is configured', async () => {
    const units = (html: string) => html.match(/<ins class="adsbygoogle"/g)?.length ?? 0;
    const home = await (await request('/', {}, ADS)).text();
    expect(units(home)).toBe(2);
    expect(home).toContain('data-ad-slot="9876543210"');
    expect(home).toContain('data-ad-client="ca-pub-1234567890123456"');
    expect(units(await (await request('/resets/2026-09-04-max-weekly', {}, ADS)).text())).toBe(1);
    expect(units(await (await request('/perks', {}, ADS)).text())).toBe(1);
    const autoOnly = await (await request('/', {}, { ADSENSE_CLIENT: ADS.ADSENSE_CLIENT })).text();
    expect(autoOnly).toContain('adsbygoogle.js');
    expect(units(autoOnly)).toBe(0);
  });

  it('serves ads.txt and the advertising disclosure on the privacy page', async () => {
    const txt = await request('/ads.txt', {}, ADS);
    expect(txt.status).toBe(200);
    expect(await txt.text()).toBe('google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n');
    const privacy = await (await request('/privacy', {}, ADS)).text();
    expect(privacy).toContain('id="advertising"');
    expect(privacy).toContain('https://policies.google.com/technologies/partner-sites');
    expect(privacy).toContain('https://myadcenter.google.com/');
    expect(privacy).not.toContain('ad trackers');
    expect(await (await request('/ja/privacy', {}, ADS)).text()).toContain('Google AdSense');
  });

  it('ignores malformed ids instead of rendering them', async () => {
    expect(adsConfig({ ADSENSE_CLIENT: 'pub-1234567890123456' }).enabled).toBe(false);
    expect(adsConfig({ ADSENSE_CLIENT: 'ca-pub-12ab' }).enabled).toBe(false);
    expect(adsConfig({ ADSENSE_CLIENT: 'ca-pub-1234567890123456"><script>' }).enabled).toBe(false);
    expect(adsConfig({ ADSENSE_CLIENT: ' ca-pub-1234567890123456 ', ADSENSE_SLOT: 'abc' })).toMatchObject({ enabled: true, client: 'ca-pub-1234567890123456', slot: null });
    expect(await (await request('/', {}, { ADSENSE_CLIENT: 'ca-pub-bad' })).text()).not.toContain('adsbygoogle');
  });
});
