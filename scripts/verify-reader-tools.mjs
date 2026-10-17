// Synthetic public-page acceptance checks. Does not connect to a Claude account.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://127.0.0.1:8788';
const output = new URL('../outputs/reader-tools/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/New_York' });
  await context.route('**/*', (route) => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${base}/tools`);
  await page.locator('#issue').selectOption('weekly');
  await page.getByRole('button', { name: 'Show my next step' }).click();
  await page.waitForURL('**/tools?issue=weekly#next-step');
  assert.match(await page.locator('#next-step').innerText(), /Check the weekly timer separately/);
  await page.locator('#session-reset').fill('2099-01-01T15:00');
  await page.locator('#weekly-reset').fill('2099-01-04T15:00');
  await page.getByRole('button', { name: 'Calculate my wait' }).click();
  assert.match(await page.locator('#planner-result').innerText(), /Jan 4, 2099/);
  assert.match(await page.locator('#planner-result').innerText(), /later of the two/);
  assert.equal(await page.evaluate(() => localStorage.getItem('claude-resets:planner:v1')), null);
  await page.locator('#remember-reset').check();
  await page.reload();
  assert.equal(await page.locator('#weekly-reset').inputValue(), '2099-01-04T15:00');
  await page.locator('#session-reset').fill('2000-01-01T15:00');
  await page.locator('#weekly-reset').fill('');
  assert.match(await page.locator('#planner-result').innerText(), /have passed/);
  await page.getByRole('button', { name: 'Clear times' }).click();
  assert.equal(await page.evaluate(() => localStorage.getItem('claude-resets:planner:v1')), null);
  assert.equal(await page.locator('#weekly-reset').inputValue(), '');
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const path of ['/', '/tools', '/reset-history', '/ja']) {
      await page.goto(base + path);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Overflow at ${path}, ${width}`);
      if (path === '/tools' || path === '/reset-history') {
        await page.screenshot({ path: `${output}/${path.slice(1)}-${width}.png`, fullPage: true });
      }
    }
  }
  await page.goto(`${base}/tools`);
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await page.screenshot({ path: `${output}/tools-dark.png`, fullPage: true });
  assert.deepEqual(errors, []);
  await context.close();
  const plain = await browser.newContext({ javaScriptEnabled: false });
  const noJs = await plain.newPage();
  await noJs.goto(`${base}/tools?issue=length`);
  assert.match(await noJs.locator('#next-step').innerText(), /new chat/);
  await plain.close();
  console.log('PASS: all six issue paths are server-rendered (unit suite); browser checked weekly path, later-limit selection, past/empty inputs, opt-in storage, clear, reload, no-JS answer, four widths, dark mode, no browser errors.');
} finally { await browser.close(); }
