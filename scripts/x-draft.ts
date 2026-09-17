// npm run x:draft -- --event <id>
// Prints copyable text for a manual X post. Nothing is sent anywhere.

import { fail, flagString, parseArgs, readContent, readWranglerVars } from './lib';

const { flags } = parseArgs(process.argv.slice(2));
const id = flagString(flags, 'event') ?? fail('--event <id> is required');
const content = readContent();
const event = content.events.find((e) => e.id === id) ?? fail(`Unknown event ${id}`);
const siteUrl = flagString(flags, 'url') ?? readWranglerVars().SITE_URL ?? 'http://localhost:8787';
const src = event.sources.find((s) => s.role === 'original') ?? event.sources[0]!;

const windows = event.windows.map((w) => ({ five_hour: '5-hour', weekly: 'weekly', other: 'other', unspecified: 'unspecified' })[w]).join(' + ');
const lines = [
  `Claude reset: ${event.title}`,
  `Audience: ${event.audience.statement}. Windows: ${windows}.`,
  `Source: ${src.url}`,
  `Details: ${siteUrl}/resets/${event.id}`,
];

/** X counts every URL as 23 characters; CJK counts double but this draft is English. */
export function xLength(text: string): number {
  const urlRe = /https?:\/\/\S+/g;
  const stripped = text.replace(urlRe, '');
  const urls = text.match(urlRe) ?? [];
  return [...stripped].length + urls.length * 23;
}

let text = lines.join('\n');
if (xLength(text) > 280) {
  lines[1] = `Audience: ${event.audience.statement}.`;
  text = lines.join('\n');
}
if (xLength(text) > 280) {
  lines[0] = `Claude reset: ${event.title.slice(0, 60)}`;
  text = lines.join('\n');
}
if (xLength(text) > 280) fail('Draft still exceeds 280 characters; shorten the title.');

console.log('--- copy below (nothing has been posted) ---');
console.log(text);
console.log('--- end ---');
console.log(`(${xLength(text)} / 280 characters by X's counting; URLs count as 23)`);
