// Maintainer commands. The owner can also use /share in the bot's private Telegram chat.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT, adminRequest, fail, parseArgs, resolveTarget } from './lib';

const { flags, positional } = parseArgs(process.argv.slice(2));
const secretFile = path.join(ROOT, '.production-secrets.env');
if (existsSync(secretFile)) process.loadEnvFile(secretFile);
const target = resolveTarget({ env: 'production' });
const command = positional[0] ?? 'status';
let result;
if (command === 'status') result = await adminRequest(target, '/admin/telegram/status');
else if (command === 'share') result = await adminRequest(target, '/admin/telegram/share', { method: 'POST', body: JSON.stringify({ url: positional[1] ?? fail('share requires an @clauderesets post URL') }) });
else if (command === 'announce') {
  const response = await fetch(`${target.baseUrl}/api/v1/build`, { signal: AbortSignal.timeout(10_000) });
  const build = await response.json() as { release: { id: string }; version_id: string };
  result = await adminRequest(target, '/admin/telegram/release', { method: 'POST', body: JSON.stringify({ release_id: build.release.id, version_id: build.version_id }) });
} else if (command === 'drain') result = await adminRequest(target, '/admin/telegram/drain', { method: 'POST' });
else fail('Use status, share <URL>, announce, or drain.');
if (result.status !== 200) fail(`Telegram command failed (${result.status}): ${JSON.stringify(result.body)}`);
console.log(JSON.stringify(result.body, null, 2));
