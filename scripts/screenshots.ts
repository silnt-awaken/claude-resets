// npm run screenshots -- [--url http://localhost:8787] [--icons]
// Captures the acceptance screenshot matrix (5 widths × 2 themes, English + Japanese)
// into screenshots/, and with --icons renders the PNG icons and OG image from the SVG mark.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { ROOT, ensureDir, flagString, parseArgs } from './lib';

const { flags } = parseArgs(process.argv.slice(2));
const base = flagString(flags, 'url') ?? 'http://localhost:8787';
const outDir = path.join(ROOT, 'screenshots');
ensureDir(outDir);

const browser = await chromium.launch();
try {
  if (flags.icons === true) {
    const iconsDir = path.join(ROOT, 'public', 'icons');
    const svgPath = path.join(iconsDir, 'icon.svg');
    if (!existsSync(svgPath)) throw new Error('public/icons/icon.svg missing');
    const svg = readFileSync(svgPath, 'utf8');
    for (const size of [192, 512, 96]) {
      const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
      await page.setContent(`<html><body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px">${svg.replace('<svg ', '<svg style="width:100%;height:100%" ')}</div></body></html>`);
      const file = size === 96 ? 'badge-96.png' : `icon-${size}.png`;
      await page.screenshot({ path: path.join(iconsDir, file), omitBackground: true });
      await page.close();
      console.log(`icon ${file}`);
    }
    const og = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
    await og.setContent(`<html><head><style>
      body{margin:0;width:1200px;height:630px;background:#fff4dd;font-family:system-ui,sans-serif;color:#26201a;display:flex;align-items:center;justify-content:center}
      .card{display:flex;align-items:center;gap:40px;padding:48px 64px;border:6px solid #26201a;border-radius:32px;background:#fffdf7;box-shadow:16px 16px 0 #26201a;transform:rotate(-1deg)}
      h1{font:800 84px/1 'Arial Rounded MT Bold','Baloo 2',system-ui,sans-serif;margin:0}
      p{margin:14px 0 0;font-size:30px;color:#5c5347}
      .tag{display:inline-block;margin-top:20px;padding:8px 20px;background:#ffd84d;border:4px solid #26201a;border-radius:16px;font:800 34px/1 'Arial Rounded MT Bold',system-ui,sans-serif}
    </style></head><body><div class="card"><div style="width:220px;height:220px">${svg.replace('<svg ', '<svg style="width:100%;height:100%" ')}</div><div><h1>Claude Resets</h1><p>Publicly announced Claude usage-limit resets, tracked by hand.</p><span class="tag">Independent · not affiliated with Anthropic</span></div></div></body></html>`);
    await og.screenshot({ path: path.join(iconsDir, 'og.png') });
    await og.close();
    console.log('icon og.png');
    if (flags['icons-only'] === true) {
      await browser.close();
      process.exit(0);
    }
  }

  const widths = [360, 390, 768, 1280, 1440];
  const themes = ['light', 'dark'] as const;
  const pages: Array<{ name: string; path: string }> = [
    { name: 'home-en', path: '/' },
    { name: 'home-ja', path: '/ja' },
    { name: 'home-max', path: '/?audience=max' },
    { name: 'sources-zh-CN', path: '/zh-CN/sources' },
    { name: 'reset-ko', path: '/ko/resets/2026-09-04-max-weekly' },
    { name: 'support', path: '/support' },
    { name: 'api-docs', path: '/api/docs' },
  ];
  let count = 0;
  for (const width of widths) {
    for (const theme of themes) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
      await context.addInitScript((t: string) => {
        try {
          window.localStorage.setItem('claude-resets-theme', t);
        } catch {
          /* ignore */
        }
      }, theme);
      const page = await context.newPage();
      for (const p of pages) {
        if (width < 768 && (p.name === 'api-docs' || p.name === 'support')) continue;
        if (width > 768 && p.name === 'home-max') continue;
        await page.goto(`${base}${p.path}`, { waitUntil: 'networkidle' });
        if (p.name.startsWith('home')) {
          await page.locator('[data-role="log-toggle"]').click({ timeout: 2000 }).catch(() => {});
        }
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        const file = `${p.name}-${width}-${theme}.png`;
        await page.screenshot({ path: path.join(outDir, file), fullPage: true });
        count++;
        console.log(`${file}${overflow > 0 ? `  !! horizontal overflow ${overflow}px` : ''}`);
      }
      await context.close();
    }
  }
  console.log(`\n${count} screenshots written to screenshots/`);
} finally {
  await browser.close();
}
