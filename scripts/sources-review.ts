// npm run sources:review -- [--id <sourceId>] [--note "..."] [--inactive <sourceId>]
// Records an actual manual source review: updates lastReviewedAt on the reviewed accounts
// and the editorial last-check timestamp in content/review.json. Deploy afterwards.

import path from 'node:path';
import { CONTENT_DIR, fail, flagString, nowIso, parseArgs, readContent, today, validateFiles, writeJson } from './lib';

const { flags } = parseArgs(process.argv.slice(2));
const content = readContent();
const only = flagString(flags, 'id');
const inactive = flagString(flags, 'inactive');
const note = flagString(flags, 'note') ?? (only ? `Reviewed ${only}.` : 'Reviewed all directory accounts.');

let touched = 0;
for (const s of content.sources) {
  if (only && s.id !== only) continue;
  s.lastReviewedAt = today();
  touched++;
  if (inactive && s.id === inactive) s.active = false;
}
if (touched === 0) fail(`No source matched ${only}`);
content.review = { lastSourceReviewAt: nowIso(), note };

const result = validateFiles(content);
if (!result.ok) fail(result.errors.join('\n'));
writeJson(path.join(CONTENT_DIR, 'sources.json'), content.sources);
writeJson(path.join(CONTENT_DIR, 'review.json'), content.review);
console.log(`✔ Recorded review of ${touched} account(s) at ${content.review.lastSourceReviewAt}. Commit and deploy to publish the new review date.`);
