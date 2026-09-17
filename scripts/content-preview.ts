// npm run content:preview -- [--event <id>] [--env production]
// Shows the exact local public result (hero, statistics, calendar placement, archive)
// computed from content/, optionally treating a draft as published, and compares the
// totals with what the target environment currently serves.

import { buildCalendar } from '../src/domain/calendar';
import { buildSnapshot, qualifyingResets, sortEventsDesc } from '../src/domain/content';
import { DEFAULT_FILTERS } from '../src/domain/filters';
import { computeStatus } from '../src/domain/service';
import { formatDays } from '../src/domain/stats';
import { flagString, parseArgs, readContent, resolveTarget } from './lib';

const { flags } = parseArgs(process.argv.slice(2));
const files = readContent();
const previewId = flagString(flags, 'event');
const events = files.events.map((e) => (e.id === previewId && e.editorialStatus === 'draft' ? { ...e, editorialStatus: 'published' as const, verificationStatus: 'verified' as const } : e));
let snapshot;
try {
  snapshot = buildSnapshot({ ...files, events });
} catch (err) {
  console.error(String(err instanceof Error ? err.message : err));
  process.exit(1);
}
const now = new Date();
const status = computeStatus(snapshot, DEFAULT_FILTERS, now);
const { stats } = status;

console.log(`Local preview (${previewId ? `treating ${previewId} as published` : 'published content only'}) at ${now.toISOString()}\n`);
if (stats.latest.kind === 'exact') {
  const e = stats.latest.event;
  console.log(`HERO      ${e.title}`);
  console.log(`          announced ${e.time.announcedAt} (${formatDays(stats.sinceLatestMs! / 86_400_000)} days ago) · ${e.audience.statement} · ${e.windows.join('+')}`);
} else if (stats.latest.kind === 'date') {
  console.log(`HERO      ${stats.latest.event.title} (date-only ${stats.latest.day})`);
} else if (stats.latest.kind === 'ambiguous') {
  console.log(`HERO      ambiguous latest on ${stats.latest.day}: ${stats.latest.events.map((e) => e.id).join(', ')}`);
} else {
  console.log('HERO      no confirmed reset');
}
console.log(`STATS     resets=${stats.total} avg=${stats.averageIntervalDays == null ? '—' : formatDays(stats.averageIntervalDays) + 'd'} longest=${stats.longestGapDays == null ? '—' : formatDays(stats.longestGapDays) + 'd'} gaps=${stats.eligibleGaps}/${stats.totalGaps}${stats.partialSample ? ' (partial)' : ''}`);
if (status.announced) console.log(`UPCOMING  ${status.announced.title} · stated ${status.announced.schedule?.statedAt ?? status.announced.schedule?.statedWindow ?? 'n/a'}`);

const grid = buildCalendar(status.filtered, now, snapshot.coverageStart);
if (previewId) {
  const cell = grid.weeks.flat().find((c) => c.events.some((r) => r.id === previewId));
  console.log(`CALENDAR  ${previewId} → ${cell ? `${cell.date} (${cell.state})` : 'not placed (no established UTC day)'}`);
}
if (grid.unplaced.length) console.log(`CALENDAR  unplaced: ${grid.unplaced.map((e) => e.id).join(', ')}`);

console.log('ARCHIVE   (latest 3)');
for (const e of sortEventsDesc(qualifyingResets(snapshot.events)).slice(0, 3)) {
  console.log(`  - ${e.time.announcedAt ?? e.time.announcedOn}  ${e.id}  ${e.sources.map((s) => `@${s.handle}${s.role === 'relay' ? ' (relay)' : ''}`).join(', ')}`);
}

const target = resolveTarget(flags);
try {
  const res = await fetch(`${target.baseUrl}/api/v1/status`);
  if (res.ok) {
    const remote = (await res.json()) as { data: { stats: { total: number; last_reset_at: string | null }; latest_reset: { id: string } | null }; meta: { content_revision: string } };
    const localLatest = stats.latest.kind === 'exact' || stats.latest.kind === 'date' ? stats.latest.event.id : null;
    console.log(`\nDEPLOYED  (${target.baseUrl}) resets=${remote.data.stats.total} latest=${remote.data.latest_reset?.id ?? '—'} revision=${remote.meta.content_revision}`);
    console.log(`CHANGE    resets ${remote.data.stats.total} → ${stats.total}; latest ${remote.data.latest_reset?.id ?? '—'} → ${localLatest ?? '—'}; revision ${remote.meta.content_revision} → ${snapshot.revision}`);
  } else console.log(`\nDEPLOYED  ${target.baseUrl} responded ${res.status}`);
} catch {
  console.log(`\nDEPLOYED  ${target.baseUrl} not reachable (start \`npm run dev\` for a local comparison)`);
}
