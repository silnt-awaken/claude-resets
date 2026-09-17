import { afterEach, describe, expect, it } from 'vitest';
import { __setContentForTests } from '../src/domain/content';
import { makeEvent, snapshotFor } from './fixtures';
import { request } from './helpers';

afterEach(() => __setContentForTests(null));

describe('feeds', () => {
  it('serves RSS with stable guids, source attribution and updated timestamps', async () => {
    const res = await request('/feed.xml', {}, { SITE_URL: 'https://example.test' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/rss+xml');
    const xml = await res.text();
    expect(xml.startsWith('<?xml version="1.0"')).toBe(true);
    expect(xml).toContain('<rss version="2.0"');
    const items = xml.match(/<item>/g)?.length ?? 0;
    expect(items).toBe(12);
    expect(xml).toContain('<guid isPermaLink="true">https://example.test/resets/2026-09-04-max-weekly</guid>');
    expect(xml).toContain('<dc:creator>@lydiahallie (Lydia Hallie)</dc:creator>');
    expect(xml).toContain('<atom:updated>');
    expect(xml).toContain('<pubDate>Fri, 04 Sep 2026 20:08:45 GMT</pubDate>');
    expect(xml).not.toContain('fixture');
  });

  it('serves a valid JSON Feed 1.1', async () => {
    const res = await request('/feed.json', {}, { SITE_URL: 'https://example.test' });
    expect(res.headers.get('content-type')).toContain('application/feed+json');
    const feed = (await res.json()) as { version: string; items: Array<{ id: string; url: string; date_published: string; date_modified: string; external_url: string; authors: Array<{ name: string }> }> };
    expect(feed.version).toBe('https://jsonfeed.org/version/1.1');
    expect(feed.items).toHaveLength(12);
    const first = feed.items[0]!;
    expect(first.id).toBe('https://example.test/resets/2026-09-04-max-weekly');
    expect(first.external_url).toBe('https://x.com/lydiahallie/status/2095967323412930677');
    expect(first.date_published).toBe('2026-09-04T20:08:45Z');
    expect(first.date_modified).toBeTruthy();
  });

  it('labels retracted events and uses the publication time for date-only records', async () => {
    __setContentForTests(
      snapshotFor([
        makeEvent({ id: 'gone', eventStatus: 'retracted', at: '2026-08-01T00:00:00Z', correction: { kind: 'retraction', reason: 'Never happened.', at: '2026-08-02T00:00:00Z' }, firstPublishedAt: '2026-08-01T01:00:00Z', revisedAt: '2026-08-02T00:00:00Z', revision: 2 }),
        makeEvent({ id: 'dated', on: '2026-08-10', dateTimezone: 'unknown' }),
      ]),
    );
    const feed = (await (await request('/feed.json')).json()) as { items: Array<{ id: string; title: string; date_published: string; content_text: string }> };
    const gone = feed.items.find((i) => i.id.endsWith('/gone'))!;
    expect(gone.title.startsWith('[retracted]')).toBe(true);
    expect(gone.content_text).toContain('Retracted');
    const dated = feed.items.find((i) => i.id.endsWith('/dated'))!;
    expect(dated.date_published).toBe('2026-09-01T00:00:00Z');
    expect(dated.content_text).toContain('exact time not established');
  });
});
