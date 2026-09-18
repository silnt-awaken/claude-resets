// npm run content:new -- --url <post url> --title "..." --summary "..." [options]
// Creates a validated DRAFT event from a source URL plus manually supplied facts.
// Nothing is scraped from X: you read the post yourself and record what it says.

import type { Plan, ResetEvent, ResetWindow } from '../src/domain/types';
import { decodeXPostTime, fail, flagString, nowIso, parseArgs, parseXStatusUrl, readContent, today, validateFiles, writeEvents } from './lib';

const { flags } = parseArgs(process.argv.slice(2));
const url = flagString(flags, 'url') ?? fail('--url <source post url> is required');
const title = flagString(flags, 'title') ?? fail('--title "..." is required');
const summary = flagString(flags, 'summary') ?? fail('--summary "..." is required (a faithful summary in your own words)');
const excerpt = flagString(flags, 'excerpt');
const kind = (flagString(flags, 'kind') ?? 'usage_reset') as ResetEvent['kind'];
const statement = flagString(flags, 'audience') ?? fail('--audience "<wording used by the source, e.g. all users>" is required');
const plansFlag = flagString(flags, 'plans') ?? 'unspecified';
// Unknown stays unknown: only an explicit plan list defaults to "limited".
const scope = (flagString(flags, 'scope') ?? (plansFlag === 'all' || plansFlag === 'subscribers' ? 'broad' : plansFlag === 'unspecified' ? 'unspecified' : 'limited')) as ResetEvent['audience']['scope'];
const windowsFlag = flagString(flags, 'windows') ?? 'unspecified';
const status = (flagString(flags, 'status') ?? 'confirmed') as ResetEvent['eventStatus'];
const statedAt = flagString(flags, 'stated-at') ?? null;
const statedWindow = flagString(flags, 'stated-window') ?? null;

const content = readContent();
const post = parseXStatusUrl(url);
const sourceId = flagString(flags, 'source-id') ?? content.sources.find((s) => post && s.handle.toLowerCase() === post.handle.toLowerCase())?.id;
if (!sourceId) fail(`Could not match the post author to content/sources.json. Pass --source-id <id> (known: ${content.sources.map((s) => s.id).join(', ')}).`);
const account = content.sources.find((s) => s.id === sourceId) ?? fail(`Unknown source id ${sourceId}`);

const decoded = post ? decodeXPostTime(post.id) : null;
const announcedAt = flagString(flags, 'at') ?? decoded ?? null;
const announcedOn = flagString(flags, 'on') ?? null;
if (!announcedAt && !announcedOn) fail('Could not establish a time. Pass --at <ISO UTC> for an exact time or --on YYYY-MM-DD --tz <UTC|IANA|unknown> for a date-only record.');

const plans: ResetEvent['audience']['plans'] =
  plansFlag === 'all' || plansFlag === 'subscribers' || plansFlag === 'unspecified' ? plansFlag : (plansFlag.split(',').map((p) => p.trim()) as Plan[]);
const windows = windowsFlag.split(',').map((w) => w.trim()) as ResetWindow[];

const dayPart = (announcedAt ?? announcedOn)!.slice(0, 10);
const baseId = flagString(flags, 'id') ?? `${dayPart}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}`;
let id = baseId;
let n = 2;
while (content.events.some((e) => e.id === id)) id = `${baseId}-${n++}`;

const event: ResetEvent = {
  id,
  kind,
  editorialStatus: 'draft',
  verificationStatus: 'needs_review',
  eventStatus: status,
  title,
  summary,
  originalLanguage: 'en',
  translations: {},
  translationStatus: 'none',
  time: announcedAt ? { precision: 'exact', announcedAt } : { precision: 'date', announcedOn: announcedOn!, dateTimezone: flagString(flags, 'tz') ?? 'unknown', utcDayResolved: flagString(flags, 'tz') === 'UTC' },
  effectiveAt: null,
  effectiveNote: flagString(flags, 'effective-note'),
  allocation: (flagString(flags, 'allocation') ?? 'subscription_usage') as ResetEvent['allocation'],
  audience: { scope, statement, plans, exclusions: flagString(flags, 'exclusions') },
  windows,
  sources: [
    {
      url,
      sourceId: account.id,
      handle: account.handle,
      displayName: account.displayName,
      kind: 'x_post',
      role: (flagString(flags, 'role') ?? 'original') as 'original' | 'relay',
      postedAt: decoded ?? undefined,
      excerpt,
      evidenceSummary: flagString(flags, 'evidence') ?? 'States the reset as described in the summary.',
      verificationMethod: flagString(flags, 'method') ?? 'Post read manually; timestamp decoded from the post id.',
      verifiedAt: today(),
    },
  ],
  firstPublishedAt: nowIso(),
  revisedAt: nowIso(),
  revision: 1,
  alertRevision: 1,
  ...(status === 'announced' ? { schedule: { statedAt, statedWindow } } : {}),
};
if (event.effectiveNote === undefined) delete event.effectiveNote;
if (event.audience.exclusions === undefined) delete event.audience.exclusions;
if (event.sources[0]!.excerpt === undefined) delete event.sources[0]!.excerpt;
if (event.sources[0]!.postedAt === undefined) delete event.sources[0]!.postedAt;

const next = [event, ...content.events];
const result = validateFiles({ ...content, events: next });
if (!result.ok) {
  console.error('✖ The draft does not validate:');
  for (const e of result.errors) console.error(`  - ${e}`);
  process.exit(1);
}
writeEvents(next);
console.log(`✔ Draft ${id} added to content/resets.json (${announcedAt ? `exact time ${announcedAt}` : `date-only ${announcedOn}`}).`);
console.log('Next: add translations (zh-CN, zh-TW, ja, ko), set editorialStatus to "published" and verificationStatus to "verified",');
console.log('then: npm run content:validate && npm run content:preview -- --event ' + id + ' && npm run content:publish -- --event ' + id);
