import { Hono } from 'hono';
import { loadContent, publishedEvents } from '../domain/content';
import { siteConfig, type Env } from '../env';
import { LOCALES, localizePath } from '../i18n';

export const meta = new Hono<{ Bindings: Env }>();

meta.get('/robots.txt', (c) => {
  const cfg = siteConfig(c.env);
  return new Response(`User-agent: *\nAllow: /\nDisallow: /admin/\nSitemap: ${cfg.siteUrl}/sitemap.xml\n`, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  });
});

meta.get('/sitemap.xml', (c) => {
  const cfg = siteConfig(c.env);
  const content = loadContent();
  const pages = ['/', '/sources', '/about', '/support', '/privacy'];
  const urls: string[] = [];
  const entry = (path: string, lastmod?: string) => {
    const alternates = LOCALES.map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${cfg.siteUrl}${localizePath(l, path)}" />`).join('\n');
    for (const l of LOCALES) {
      urls.push(`  <url>\n    <loc>${cfg.siteUrl}${localizePath(l, path)}</loc>\n${lastmod ? `    <lastmod>${lastmod}</lastmod>\n` : ''}${alternates}\n  </url>`);
    }
  };
  for (const p of pages) entry(p);
  for (const e of publishedEvents(content.events)) entry(`/resets/${e.id}`, e.revisedAt);
  urls.push(`  <url>\n    <loc>${cfg.siteUrl}/api/docs</loc>\n  </url>`);
  urls.push(`  <url>\n    <loc>${cfg.siteUrl}/mcp/docs</loc>\n  </url>`);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`;
  return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
});

/** Safe sponsor redirect: only known, active slugs; destination comes from stored configuration. */
meta.get('/sponsor/:slug', (c) => {
  const slug = c.req.param('slug');
  const content = loadContent();
  const now = Date.now();
  const sponsor = content.sponsors.find(
    (s) => s.slug === slug && s.active && (!s.startsAt || Date.parse(s.startsAt) <= now) && (!s.endsAt || Date.parse(s.endsAt) > now),
  );
  if (!sponsor) return c.notFound();
  return new Response(null, { status: 302, headers: { location: sponsor.url, 'cache-control': 'no-store', 'referrer-policy': 'strict-origin-when-cross-origin' } });
});
