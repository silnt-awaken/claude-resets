// Synthetic status-feed checks; never connects to a Claude account or wallet.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://127.0.0.1:8788';
const output = new URL('../outputs/claude-status/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/New_York' });
  await context.route('**/*', (route) => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
  let mode = 'operational';
  let calls = 0;
  await context.route('**/api/v1/claude-status', async (route) => {
    calls++;
    if (mode === 'failure') return route.fulfill({ status: 503, json: { state: 'unavailable' } });
    await route.fulfill({ json: {
      state: mode === 'stale' ? 'operational' : mode,
      checked_at: new Date(Date.now() - (mode === 'stale' ? 600000 : 0)).toISOString(),
      source_updated_at: '2026-10-17T00:00:00Z',
      services: [{ key: 'claude', state: mode === 'issues' ? 'partial_outage' : 'operational' }, { key: 'code', state: 'operational' }, { key: 'api', state: 'operational' }],
      incidents: mode === 'issues' ? [{ title: '<img src=x onerror="window.badStatus=true"> Elevated errors' }] : [],
    } });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const locale of ['en', 'zh-CN', 'zh-TW', 'ja', 'ko']) {
    const prefix = locale === 'en' ? '' : '/' + locale;
    for (const path of ['', '/tools']) {
      mode = 'operational';
      await page.goto(`${base}${prefix}${path || (prefix ? '' : '/')}`);
      const card = page.locator('#claude-status');
      const m = await page.locator('#claude-status-i18n').evaluate((el) => JSON.parse(el.textContent));
      await page.waitForFunction(() => document.querySelector('#claude-status').dataset.state === 'operational');
      assert.equal(await card.locator('[data-status-summary]').innerText(), m.overall.operational);
      assert.equal(await card.locator('[data-status-services] li').count(), 3);
      assert.doesNotMatch(await card.locator('[data-status-checked]').innerText(), /\{time\}/);
      assert.equal(await page.locator('.actions a[href*="buymeacoffee"]').count(), 0);
      if (!path) assert.equal(await page.locator('#support-heading').count(), 1);
      for (const width of [360, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${locale}${path} overflow at ${width}`);
        if (width === 390) await card.screenshot({ path: `${output}/${locale}-${path ? 'tools' : 'home'}-390.png` });
      }
      for (const state of ['issues', 'maintenance', 'unknown', 'failure', 'stale', 'operational']) {
        mode = state;
        await card.locator('[data-status-refresh]').click();
        const expected = ['failure', 'stale'].includes(state) ? m.unavailable : m.overall[state];
        await page.waitForFunction((expected) => document.querySelector('[data-status-summary]').textContent === expected, expected);
        if (state === 'issues') {
          assert.match(await card.locator('[data-status-incidents]').innerText(), /<img src=x/);
          assert.equal(await card.locator('img').count(), 0);
          assert.equal(await page.evaluate(() => window.badStatus), undefined);
        }
        if (['failure', 'stale'].includes(state)) assert.equal(await card.locator('[data-status-services]').isVisible(), false);
      }
    }
  }
  await page.goto(`${base}/tools`);
  await page.waitForFunction(() => document.querySelector('#claude-status').dataset.state === 'operational');
  await page.clock.install();
  // Install the fake clock before this navigation creates the polling interval.
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#claude-status').dataset.state === 'operational');
  const before = calls;
  mode = 'failure';
  await page.clock.fastForward(60000);
  await page.waitForFunction(() => document.querySelector('#claude-status').dataset.state === 'unknown');
  assert.ok(calls > before, 'Automatic refresh did not fetch');
  mode = 'operational';
  await page.locator('[data-status-refresh]').click();
  await page.waitForFunction(() => document.querySelector('#claude-status').dataset.state === 'operational');
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await page.locator('#claude-status').screenshot({ path: `${output}/status-dark.png` });
  assert.deepEqual(errors, []);
  await context.close();
  const plain = await browser.newContext({ javaScriptEnabled: false });
  const noJs = await plain.newPage();
  await noJs.goto(`${base}/tools`);
  assert.ok(await noJs.locator('#claude-status a[href="https://status.claude.com/"]').count());
  assert.doesNotMatch(await noJs.locator('#claude-status').innerText(), /Checking the official/);
  await plain.close();
  console.log('PASS: all five locales on home/tools, healthy/incident/maintenance/unknown/unavailable/stale/recovery states, escaped incident titles, automatic polling, four widths, dark mode, no-JS source link, bottom support retained, no browser errors.');
} finally { await browser.close(); }
