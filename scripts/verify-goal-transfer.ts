// Wallet contract regression: real SDK decoding + simulated approval/rejection. No funds move.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { Transaction, VersionedTransaction } from '@solana/web3.js';
import { base58Encode } from '../src/goal/base58';
import { buildTransferMessage, unsignedTransaction, SOLANA } from '../src/goal/solana';

const base = process.argv[2] || 'http://127.0.0.1:8788';
const address = (n: number) => base58Encode(new Uint8Array(32).fill(n));
const message = buildTransferMessage({ payer: address(1), source: address(2), destination: address(3), mint: SOLANA.usdcMint, units: 1_000_000n, decimals: 6, blockhash: address(4) });
const unsigned = unsignedTransaction(message);
// A message interpreted as a full transaction fails before wallet approval — the reported error path.
assert.throws(() => VersionedTransaction.deserialize(message), /buffer|unexpected|signature|version/i);
const decoded = Transaction.from(unsigned);
assert.equal(decoded.feePayer?.toBase58(), address(1));
assert.equal(decoded.instructions.at(-1)?.data.readBigUInt64LE(1), 1_000_000n);
assert.equal(decoded.instructions.at(-1)?.keys[2]?.pubkey.toBase58(), address(3));
const fixture = { message: base58Encode(message), transaction: base58Encode(unsigned), fee_lamports: 6000 };
// Use a read-only public render for the open-round sheet; scripts, API fixtures and wallet are isolated.
const html = await (await fetch('https://clauderesets.com/goal')).text();
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.addInitScript(`
    Object.assign(window, { __walletCalls: [], __wire: null, __approveFixture: false, phantom: { solana: {
      isPhantom: true, publicKey: { toString: () => '${address(1)}' }, on: () => {},
      connect: () => { throw new Error('Unexpected connect'); },
      request: () => { throw new Error('Legacy request must not be used'); },
      signAndSendTransaction: async (tx) => {
        const state = window;
        state.__walletCalls.push('signAndSendTransaction');
        state.__wire = Array.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
        if (state.__approveFixture) return { signature: '${base58Encode(new Uint8Array(64).fill(9))}' };
        throw Object.assign(new Error('User rejected test approval'), { code: 4001 });
      },
    } } });
  `);
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(base).origin) return route.abort();
    if (url.pathname === '/goal') return route.fulfill({ status: 200, contentType: 'text/html', body: html });
    if (url.pathname === '/api/v1/goal/tx') {
      assert.deepEqual(route.request().postDataJSON(), { from: address(1), amount: 1 });
      return route.fulfill({ json: fixture });
    }
    if (url.pathname === '/api/v1/goal/contributions') {
      assert.deepEqual(route.request().postDataJSON(), { signature: base58Encode(new Uint8Array(64).fill(9)) });
      return route.fulfill({ json: { status: 'confirmed', usdc: 1, counted: true, excluded: false } });
    }
    if (route.request().method() === 'POST') throw new Error('Unexpected submission in wallet regression');
    return route.continue();
  });
  await page.goto(base + '/goal');
  assert.deepEqual(await page.evaluate(() => (window as unknown as { __walletCalls: string[] }).__walletCalls), []);
  assert.equal(await page.evaluate(() => 'ClaudeGoalTransaction' in window), false);
  await page.locator('[data-role="goal-open"]').first().click();
  await page.locator('#goal-sheet [data-role="preset"][data-amount="1"]').click();
  await page.locator('#goal-sheet [data-role="pay"]').click();
  await page.locator('#goal-sheet [data-role="sheet-status"]').filter({ hasText: 'The transfer was not approved.' }).waitFor();
  const wire = await page.evaluate(() => (window as unknown as { __wire: number[] }).__wire);
  assert.deepEqual(new Uint8Array(wire), unsigned);
  assert.equal(Transaction.from(new Uint8Array(wire)).instructions.length, 3);
  assert.deepEqual(await page.evaluate(() => (window as unknown as { __walletCalls: string[] }).__walletCalls), ['signAndSendTransaction']);
  assert.deepEqual(errors, []);
  await page.evaluate(() => { Object.assign(window, { __approveFixture: true }); });
  await page.locator('#goal-sheet [data-role="pay"]').click();
  await page.locator('#goal-sheet [data-role="done"]').waitFor({ state: 'visible' });
  assert.match(await page.locator('#goal-sheet [data-role="done-line"]').innerText(), /1\.00/);
  assert.deepEqual(errors, []);
  await mkdir('outputs/reader-tools', { recursive: true });
  await page.screenshot({ path: 'outputs/reader-tools/phantom-transfer-regression.png', fullPage: true });
  console.log('PASS: raw-message decoding fails while full unsigned transfer decodes with Solana SDK; amount/destination retained; lazy loading on explicit contribution; simulated wallet rejection and successful receipt/confirmation; zero real signatures or broadcasts.');
} finally { await browser.close(); }
