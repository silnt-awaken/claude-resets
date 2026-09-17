// npm run content:export -- [--env production] [--out exports]
// npm run content:export -- --restore exports/<stamp>
// Writes a restorable snapshot: the content files plus the publication/alert ledger
// from the target environment. Restore copies the content files back (git shows the diff).

import { cpSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { CONTENT_DIR, ROOT, adminRequest, ensureDir, fail, flagString, parseArgs, readContent, resolveTarget, validateFiles, writeJson } from './lib';

const { flags } = parseArgs(process.argv.slice(2));
const restore = flagString(flags, 'restore');

if (restore) {
  const dir = path.resolve(ROOT, restore, 'content');
  if (!existsSync(dir)) fail(`No content directory at ${dir}`);
  for (const f of readdirSync(dir)) cpSync(path.join(dir, f), path.join(CONTENT_DIR, f));
  const result = validateFiles(readContent());
  if (!result.ok) fail(`Restored content does not validate: ${result.errors[0]}`);
  console.log(`✔ Restored ${readdirSync(dir).length} content files from ${restore}. Review with git diff, then deploy.`);
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = path.resolve(ROOT, flagString(flags, 'out') ?? 'exports', stamp);
ensureDir(path.join(out, 'content'));
for (const f of readdirSync(CONTENT_DIR)) cpSync(path.join(CONTENT_DIR, f), path.join(out, 'content', f));

const target = resolveTarget(flags);
let ledger: unknown = null;
try {
  const res = await adminRequest(target, '/admin/ledger');
  ledger = res.status === 200 ? res.body : { error: res.status, body: res.body };
} catch (err) {
  ledger = { error: err instanceof Error ? err.message : String(err) };
}
writeJson(path.join(out, 'ledger.json'), { exportedAt: new Date().toISOString(), target: target.name, baseUrl: target.baseUrl, ledger });
console.log(`✔ Snapshot written to ${path.relative(ROOT, out)} (content files + ledger from ${target.name}).`);
console.log(`Restore with: npm run content:export -- --restore ${path.relative(ROOT, out)}`);
