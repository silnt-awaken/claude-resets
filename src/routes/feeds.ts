import { Hono } from 'hono';
import { loadContent, qualifyingResets, sortEventsDesc, withdrawnResets } from '../domain/content';
import type { ResetEvent } from '../domain/types';
import { siteConfig, type Env } from '../env';
import { hashString } from '../domain/content';

export const feeds = new Hono<{ Bindings: Env }>();

const FEED_LIMIT = 50;

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[ch]!);
}

/** Feed timestamp: exact announcement time, otherwise the first publication time (the date is stated in the text). */
function feedDate(e: ResetEvent): string {
  return e.time.precision === 'exact' && e.time.announcedAt ? e.time.announcedAt : e.firstPublishedAt;
}

function feedEvents(): ResetEvent[] {
  const content = loadContent();
  const items = [...qualifyingResets(content.events), ...withdrawnResets(content.events)];
  return sortEventsDesc(items).slice(0, FEED_LIMIT);
}

function describe(e: ResetEvent): string {
  const src = e.sources.find((s) => s.role === 'original') ?? e.sources[0]!;
  const parts = [e.summary];
  if (e.time.precision === 'date') parts.push(`Announced on ${e.time.announcedOn} (exact time not established).`);
  parts.push(`Audience: ${e.audience.statement}. Windows: ${e.windows.join(', ')}.`);
  if (e.correction) parts.push(`${e.correction.kind === 'retraction' ? 'Retracted' : 'Corrected'} (${e.correction.at}): ${e.correction.reason}`);
  parts.push(`Source: @${src.handle} ${src.url}`);
  return parts.join(' ');
}

feeds.get('/feed.xml', (c) => {
  const cfg = siteConfig(c.env);
  const content = loadContent();
  const events = feedEvents();
  const lastBuild = events.reduce((m, e) => (e.revisedAt > m ? e.revisedAt : m), events[0]?.revisedAt ?? new Date(0).toISOString());
  const items = events
    .map((e) => {
      const url = `${cfg.siteUrl}/resets/${e.id}`;
      const src = e.sources.find((s) => s.role === 'original') ?? e.sources[0]!;
      return `    <item>
      <title>${escapeXml(e.eventStatus === 'retracted' || e.eventStatus === 'cancelled' ? `[${e.eventStatus}] ${e.title}` : e.title)}</title>
      <link>${escapeXml(url)}</link>
      <guid isPermaLink="true">${escapeXml(url)}</guid>
      <pubDate>${new Date(feedDate(e)).toUTCString()}</pubDate>
      <dc:creator>${escapeXml(`@${src.handle} (${src.displayName})`)}</dc:creator>
      <description>${escapeXml(describe(e))}</description>
      <atom:updated>${escapeXml(e.revisedAt)}</atom:updated>
    </item>`;
    })
    .join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${escapeXml(cfg.siteName)}</title>
    <link>${escapeXml(cfg.siteUrl)}/</link>
    <description>Publicly announced Claude usage-limit resets, tracked by hand. Independent project, not affiliated with Anthropic.</description>
    <language>en</language>
    <lastBuildDate>${new Date(lastBuild).toUTCString()}</lastBuildDate>
    <atom:link href="${escapeXml(cfg.siteUrl)}/feed.xml" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`;
  return new Response(xml, {
    headers: {
      'content-type': 'application/rss+xml; charset=utf-8',
      'cache-control': 'public, max-age=300, stale-while-revalidate=900',
      etag: `W/"${hashString(`rss:${content.revision}`)}"`,
    },
  });
});

feeds.get('/feed.json', (c) => {
  const cfg = siteConfig(c.env);
  const content = loadContent();
  const events = feedEvents();
  const body = {
    version: 'https://jsonfeed.org/version/1.1',
    title: cfg.siteName,
    home_page_url: `${cfg.siteUrl}/`,
    feed_url: `${cfg.siteUrl}/feed.json`,
    description: 'Publicly announced Claude usage-limit resets, tracked by hand. Independent project, not affiliated with Anthropic.',
    language: 'en',
    items: events.map((e) => {
      const src = e.sources.find((s) => s.role === 'original') ?? e.sources[0]!;
      return {
        id: `${cfg.siteUrl}/resets/${e.id}`,
        url: `${cfg.siteUrl}/resets/${e.id}`,
        external_url: src.url,
        title: e.eventStatus === 'retracted' || e.eventStatus === 'cancelled' ? `[${e.eventStatus}] ${e.title}` : e.title,
        content_text: describe(e),
        date_published: feedDate(e),
        date_modified: e.revisedAt,
        authors: [{ name: `@${src.handle} (${src.displayName})`, url: src.url }],
        tags: [e.kind, e.eventStatus, e.audience.scope, ...e.windows],
        _claude_resets: { event_status: e.eventStatus, time_precision: e.time.precision, announced_on: e.time.announcedOn ?? null, revision: e.revision },
      };
    }),
  };
  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      'content-type': 'application/feed+json; charset=utf-8',
      'cache-control': 'public, max-age=300, stale-while-revalidate=900',
      etag: `W/"${hashString(`json:${content.revision}`)}"`,
    },
  });
});
