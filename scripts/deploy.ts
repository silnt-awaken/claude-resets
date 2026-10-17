// Deploy, verify the exact Worker version on the public domain, then announce the release once.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { release } from '../src/domain/release';
import { ROOT, adminRequest, parseArgs, readWranglerVars, resolveTarget } from './lib';

const { flags } = parseArgs(process.argv.slice(2));
const walletBuild = spawn(process.execPath, [path.join(ROOT, 'scripts/build-wallet.mjs')], { cwd: ROOT, env: process.env, stdio: 'inherit' });
const walletExitCode = await new Promise<number>((resolve, reject) => { walletBuild.on('error', reject); walletBuild.on('close', (code) => resolve(code ?? 1)); });
if (walletExitCode !== 0) process.exit(walletExitCode);
const deploy = spawn(process.execPath, [path.join(ROOT, 'node_modules/wrangler/bin/wrangler.js'), 'deploy'], { cwd: ROOT, env: process.env, stdio: ['inherit', 'pipe', 'pipe'] });
let output = '';
deploy.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); process.stdout.write(chunk); });
deploy.stderr.on('data', (chunk: Buffer) => process.stderr.write(chunk));
const exitCode = await new Promise<number>((resolve, reject) => { deploy.on('error', reject); deploy.on('close', (code) => resolve(code ?? 1)); });
if (exitCode !== 0) process.exit(exitCode);
const version = output.match(/Current Version ID:\s*([a-f0-9-]{36})/i)?.[1];
if (!version) throw new Error('Deployment finished, but its version ID was not available. No announcement was sent.');
const siteUrl = readWranglerVars().SITE_URL;
if (!siteUrl) throw new Error('SITE_URL is required for live verification.');
let live = false;
for (let attempt = 0; attempt < 6; attempt++) {
  try {
    const response = await fetch(`${siteUrl}/api/v1/build?verify=${version}`, { signal: AbortSignal.timeout(10_000) });
    const body = await response.json() as { version_id?: string; release?: { id?: string } };
    if (response.ok && body.version_id === version && body.release?.id === release.id) { live = true; break; }
  } catch { /* bounded propagation checks */ }
  if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 2000));
}
if (!live) throw new Error('The public site has not confirmed this version. No Telegram announcement was sent.');
console.log(`✔ Live version verified: ${version}`);
if (flags['no-announcement'] || !release.announce) { console.log('○ This deployment is silent.'); process.exit(0); }
// Load the existing ignored production secret file without echoing any values.
const secretFile = path.join(ROOT, '.production-secrets.env');
if (existsSync(secretFile)) process.loadEnvFile(secretFile);
const target = resolveTarget({ env: 'production' });
const status = await adminRequest(target, '/admin/telegram/status');
if (status.status !== 200) throw new Error(`Telegram connection check failed (${status.status}); the build is live.`);
if (!(status.body as { configured?: boolean }).configured) { console.log('○ Build is live. Telegram announcement is pending the bot connection.'); process.exit(0); }
const announced = await adminRequest(target, '/admin/telegram/release', { method: 'POST', body: JSON.stringify({ release_id: release.id, version_id: version }) });
if (announced.status !== 200) throw new Error(`Build is live, but Telegram announcement could not be queued (${announced.status}).`);
console.log((announced.body as { queued: boolean }).queued ? '✔ Telegram release announcement queued.' : '✔ This release was already recorded; no duplicate announcement.');
