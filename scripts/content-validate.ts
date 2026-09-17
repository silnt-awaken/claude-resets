// npm run content:validate — validate all content files and cross-file rules.

import { readContent, validateFiles } from './lib';

const files = readContent();
const result = validateFiles(files);
for (const w of result.warnings) console.warn(`⚠ ${w}`);
if (!result.ok) {
  console.error(`✖ Content is invalid (${result.errors.length} error${result.errors.length === 1 ? '' : 's'}):`);
  for (const e of result.errors) console.error(`  - ${e}`);
  process.exit(1);
}
const published = files.events.filter((e) => e.editorialStatus === 'published');
const drafts = files.events.filter((e) => e.editorialStatus === 'draft');
console.log(`✔ Content valid: ${files.events.length} events (${published.length} published, ${drafts.length} draft), ${files.sources.length} sources, ${files.sponsors.length} sponsors, ${files.research.length} research items.`);
for (const d of drafts) console.log(`  draft: ${d.id} (${d.verificationStatus}, translations: ${d.translationStatus})`);
