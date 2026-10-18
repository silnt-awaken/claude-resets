import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLAUDE_STATUS_CACHE, CLAUDE_STATUS_SOURCE, summarizeClaudeStatus } from '../src/claude-status';
import { claudeStatusMessages } from '../src/i18n/claude-status';
import { LOCALES, localizePath } from '../src/i18n';
import { request } from './helpers';

const now = '2026-10-18T12:00:00Z';
function feed() {
  return {
    page: { updated_at: '2026-10-17T09:00:00Z' },
    status: { indicator: 'none' },
    components: [
      { id: 'rwppv331jlwc', status: 'operational' },
      { id: 'yyzkbfz2thpt', status: 'operational' },
      { id: 'k8w3r06qmzrp', status: 'operational' },
    ],
    incidents: [] as { name: string; status: string; shortlink?: string }[],
  };
}

beforeEach(async () => { await caches.default.delete(CLAUDE_STATUS_CACHE); });
afterEach(() => vi.restoreAllMocks());

describe('official Claude service status', () => {
  it('distinguishes the time checked from the provider’s last change', () => {
    const status = summarizeClaudeStatus(feed(), new Date(now));
    expect(status.state).toBe('operational');
    expect(status.checked_at).toBe('2026-10-18T12:00:00.000Z');
    expect(status.source_updated_at).toBe('2026-10-17T09:00:00Z');
    expect(status.services.map(({ state }) => state)).toEqual(['operational', 'operational', 'operational']);
  });

  it('surfaces incidents and component failures even if the overall indicator says none', () => {
    const incident = feed();
    incident.incidents = [{ name: '<script>incident title</script>', status: 'investigating', shortlink: 'https://untrusted.example/' }];
    const status = summarizeClaudeStatus(incident);
    expect(status.state).toBe('issues');
    expect(status.incidents).toEqual([{ title: '<script>incident title</script>', url: 'https://status.claude.com/' }]);
    const degraded = feed();
    degraded.components[0]!.status = 'degraded_performance';
    expect(summarizeClaudeStatus(degraded).state).toBe('issues');
    // An issue with another official service must still affect the overall summary.
    degraded.components = [...feed().components, { id: 'console', status: 'major_outage' }];
    expect(summarizeClaudeStatus(degraded).state).toBe('issues');
  });

  it('handles maintenance, resolved reports, missing services and new upstream states honestly', () => {
    const maintenance = feed();
    maintenance.components[0]!.status = 'under_maintenance';
    expect(summarizeClaudeStatus(maintenance).state).toBe('maintenance');
    const resolved = feed();
    resolved.incidents = [{ name: 'Fixed', status: 'resolved' }];
    expect(summarizeClaudeStatus(resolved).state).toBe('operational');
    expect(summarizeClaudeStatus(resolved).incidents).toEqual([]);
    const missing = feed();
    missing.components.pop();
    expect(summarizeClaudeStatus(missing).state).toBe('unknown');
    const unknown = feed();
    unknown.components[0]!.status = 'new_status';
    expect(summarizeClaudeStatus(unknown).state).toBe('unknown');
    expect(() => summarizeClaudeStatus({ status: { indicator: 'none' } })).toThrow();
  });

  it('fetches only the fixed official feed and shares a one-minute edge snapshot', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(feed())));
    const first = await request('/api/v1/claude-status?url=https://untrusted.example/');
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('public, max-age=60');
    expect(first.headers.get('access-control-allow-origin')).toBe('*');
    const body = await first.json();
    expect(body).toMatchObject({ state: 'operational', source_url: 'https://status.claude.com/' });
    const second = await request('/api/v1/claude-status');
    expect(await second.json()).toEqual(body);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![0]).toBe(CLAUDE_STATUS_SOURCE);
    expect(fetch.mock.calls[0]![1]).toMatchObject({ redirect: 'manual' });
  });

  it.each(['http', 'redirect', 'invalid', 'network'])('does not turn a %s failure into a healthy or cached result', async (failure) => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    if (failure === 'http') fetch.mockResolvedValue(new Response('Unavailable', { status: 503 }));
    else if (failure === 'redirect') fetch.mockResolvedValue(new Response(null, { status: 302, headers: { location: 'https://untrusted.example/' } }));
    else if (failure === 'invalid') fetch.mockResolvedValue(new Response('{"status":{"indicator":"none"}}'));
    else fetch.mockRejectedValue(new Error('timeout'));
    const response = await request('/api/v1/claude-status');
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ state: 'unavailable' });
    expect(await caches.default.match(CLAUDE_STATUS_CACHE)).toBeUndefined();
    fetch.mockResolvedValue(new Response(JSON.stringify(feed())));
    expect((await request('/api/v1/claude-status')).status).toBe(200);
  });

  it('provides translated status cards and a no-JavaScript source link on the home and tools pages', async () => {
    for (const locale of LOCALES) {
      const m = claudeStatusMessages[locale];
      expect(m.checked.match(/\{\w+\}/g)).toEqual(['{time}']);
      for (const path of ['/', '/tools']) {
        const html = await (await request(localizePath(locale, path))).text();
        expect(html).toContain(m.heading);
        expect(html).toContain(m.noJs);
        expect(html).toContain('src="/claude-status.js"');
        expect(html).toContain('href="https://status.claude.com/"');
        if (path === '/') {
          const actions = html.match(/<div class="actions"[\s\S]*?<\/div>/)?.[0];
          expect(actions).toBeTruthy();
          expect(actions).not.toContain('buymeacoffee');
          expect(actions).not.toContain('/support');
          expect(html).toContain('id="support-heading"');
        }
      }
    }
  });
});
