// Isolated confirmation/refresh regression. All POSTs are fixtures; no wallet or chain writes.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
const base = process.argv[2] || 'http://127.0.0.1:8788';
const browser = await chromium.launch();
const wallet = '6N9a6TJhFzGGtRLPkekmwF3xq2ncuXh7Yz7XipU6grBv';
const signature = (n) => String(n).repeat(88);
const actual = await (await fetch(base + '/api/v1/goal')).json();
const roundId = actual.round.id;
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/New_York' });
  await context.addInitScript(({ signature }) => localStorage.setItem('claude-resets:pending-contribution', JSON.stringify({ signature, at: Date.now() })), { signature: signature(3) });
  let staleRequest, confirmationRequest, reads = 0, confirmations = 0;
  const transfers = [1, 2, 3].map((n) => ({ signature: signature(n), wallet, usdc: 1, sent_at: `2026-10-${String(n).padStart(2, '0')}T16:00:00.000Z`, recorded_at: `2026-10-${String(n).padStart(2, '0')}T16:01:00.000Z` }));
  const status = (count) => ({ as_of: new Date(Date.now() + count * 10000).toISOString(), contributors_available: true, contributor_list: [{ wallet, usdc: count }], recent_contributions: transfers.slice(0, count).reverse(), round: { id: roundId, status: 'open', raised_usd: count, contributions: count, contributors: 1, target_usd: 200 } });
  await context.route('**/*', async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== new URL(base).origin) return route.abort();
    if (url.pathname === '/api/v1/goal' && request.method() === 'GET') {
      reads++;
      if (reads === 1) { staleRequest = route; return; }
      return route.fulfill({ json: status(3) });
    }
    if (url.pathname === '/api/v1/goal/contributions') {
      assert.deepEqual(request.postDataJSON(), { signature: signature(3) });
      confirmations++;
      if (confirmations === 1) return route.fulfill({ status: 202, json: { status: 'pending', signature: signature(3) } });
      confirmationRequest = route; return;
    }
    if (request.method() === 'POST') throw new Error(`Unexpected POST ${url.pathname}`);
    return route.continue();
  });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base + '/goal');
  await page.locator('[data-role="goal-live-status"]').filter({ hasText: 'Waiting for network confirmation' }).waitFor();
  assert.equal(await page.locator('[data-role="pay"]').isDisabled(), true);
  await page.waitForFunction(() => document.querySelector('[data-role="goal-live-status"]').textContent.includes('Please don’t send again'));
  // Wait for the next bounded poll to arrive, then release the confirmed snapshot.
  for (let n = 0; n < 30 && !confirmationRequest; n++) await new Promise((resolve) => setTimeout(resolve, 100));
  assert.ok(confirmationRequest);
  await confirmationRequest.fulfill({ json: { status: 'confirmed', signature: signature(3), usdc: 1, counted: true, excluded: false, goal: status(3) } });
  await page.locator('[data-role="goal-live-status"]').filter({ hasText: 'Your $1 contribution is confirmed' }).waitFor();
  assert.match(await page.locator('[data-role="goal-raised"]').innerText(), /\$3 raised/);
  assert.match(await page.locator('[data-role="goal-contributors"]').innerText(), /\$3/);
  assert.equal(await page.locator('[data-role="goal-activity"] li').count(), 3);
  assert.equal(await page.locator('[data-signature="' + signature(3) + '"] time').getAttribute('datetime'), transfers[2].sent_at);
  assert.match(await page.locator('[data-signature="' + signature(3) + '"] time').innerText(), /Oct 3, 2026/);
  assert.equal(await page.evaluate(() => localStorage.getItem('claude-resets:pending-contribution')), null);
  assert.ok(staleRequest);
  await staleRequest.fulfill({ json: status(2) });
  await page.locator('[data-role="goal-recheck"]').click();
  await page.locator('[data-role="goal-live-status"]').filter({ hasText: 'Checked' }).waitFor();
  assert.match(await page.locator('[data-role="goal-raised"]').innerText(), /\$3 raised/);
  assert.match(await page.locator('[data-role="goal-contributors"]').innerText(), /\$3/);
  assert.equal(await page.locator('[data-role="goal-activity"] li').count(), 3);
  assert.deepEqual(errors, []);
  await mkdir('outputs/goal-activity', { recursive: true });
  await page.locator('[data-role="goal-card"]').screenshot({ path: 'outputs/goal-activity/mobile-confirmed.png' });
  await context.close();
  // Check real server-rendered dates and localized UI at mobile and desktop sizes.
  for (const locale of ['en', 'zh-CN', 'zh-TW', 'ja', 'ko']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route('**/*', (route) => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
    const page = await context.newPage();
    await page.goto(base + (locale === 'en' ? '' : '/' + locale) + '/goal');
    const messages = await page.locator('#goal-i18n').evaluate((el) => JSON.parse(el.textContent).activity);
    assert.match(await page.locator('.goal-activity h3').innerText(), new RegExp(messages.heading));
    for (const width of [360, 390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    await page.locator('[data-role="goal-card"]').screenshot({ path: `outputs/goal-activity/${locale}.png` });
    await context.close();
  }
  console.log('PASS: pending donation survives reload without wallet calls, duplicate payment disabled, confirmed total/wallet/three dated receipts update together, stale in-flight response cannot roll back the card, locale UI and widths pass, zero funds sent.');
} finally { await browser.close(); }
