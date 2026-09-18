// npm run content:publish -- --event <id> [--env production] [--no-alert] [--late]
// npm run content:backfill -- --event <id> | --all      (never sends alerts)
// npm run content:correct  -- --event <id> [--alert-correction]   (the reason lives in the event's correction record)
//
// Calls the private publication endpoint of the running site with the local copy of the
// event. The server refuses when the deployed content differs (deploy first), records the
// publication in D1, and creates alert work only for a first confirmed publication.

import { adminRequest, fail, flagString, parseArgs, readContent, resolveTarget, validateFiles } from './lib';

const { flags } = parseArgs(process.argv.slice(2));
const content = readContent();
const validation = validateFiles(content);
if (!validation.ok) fail(`Content is invalid; run npm run content:validate. First error: ${validation.errors[0]}`);

const backfill = flags.backfill === true;
const correct = flags.correct === true;
const mode = backfill ? 'backfill' : correct ? 'correct' : 'publish';
const ids = flags.all === true && backfill ? content.events.filter((e) => e.editorialStatus === 'published').map((e) => e.id) : [flagString(flags, 'event') ?? fail('--event <id> is required (or --all with --backfill)')];
const target = resolveTarget(flags);
if (target.name === 'production' && flags.yes !== true) {
  console.log(`About to ${mode} ${ids.join(', ')} to PRODUCTION at ${target.baseUrl}. Re-run with --yes to confirm.`);
  process.exit(2);
}

for (const id of ids) {
  const event = content.events.find((e) => e.id === id) ?? fail(`Unknown event ${id}`);
  if (event.editorialStatus !== 'published') fail(`${id} is not marked published in content/resets.json (editorialStatus=${event.editorialStatus}).`);
  if (correct && !event.correction) console.warn(`⚠ ${id} has no correction record; a correction publish is usually accompanied by one.`);
  const alertPolicy = backfill ? 'none' : correct ? (flags['alert-correction'] === true ? 'correction' : 'none') : flags['no-alert'] === true ? 'none' : 'default';
  const body = { eventId: id, mode, alertPolicy, late: flags.late === true, event };
  const res = await adminRequest(target, '/admin/publish', { method: 'POST', body: JSON.stringify(body) });
  const pretty = typeof res.body === 'string' ? res.body : JSON.stringify(res.body, null, 2);
  if (res.status >= 200 && res.status < 300) {
    console.log(`✔ ${mode} ${id} → ${target.name} (${res.status})`);
    console.log(pretty);
  } else {
    console.error(`✖ ${mode} ${id} → ${target.name} failed (${res.status})`);
    console.error(pretty);
    process.exit(1);
  }
}
