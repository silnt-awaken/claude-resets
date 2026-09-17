// One service layer for the homepage, the public API, the feeds and the MCP tools.

import { announcedResets, compareEventsAsc, eventDay, eventInstant, qualifyingResets, sortEventsDesc, type ContentSnapshot } from './content';
import { applyFilters, type Filters } from './filters';
import { computeStats, type Stats } from './stats';
import type { ResetEvent } from './types';

export interface StatusResult {
  filters: Filters;
  stats: Stats;
  latest: ResetEvent | null;
  latestAmbiguous: ResetEvent[] | null;
  announced: ResetEvent | null;
  filtered: ResetEvent[];
}

export function computeStatus(content: ContentSnapshot, filters: Filters, now: Date): StatusResult {
  const filtered = sortEventsDesc(applyFilters(qualifyingResets(content.events), filters));
  const stats = computeStats(filtered, now);
  const announced = sortEventsDesc(applyFilters(announcedResets(content.events), filters))[0] ?? null;
  return {
    filters,
    stats,
    latest: stats.latest.kind === 'exact' || stats.latest.kind === 'date' ? stats.latest.event : null,
    latestAmbiguous: stats.latest.kind === 'ambiguous' ? stats.latest.events : null,
    announced,
    filtered,
  };
}

export interface ListOptions {
  limit: number;
  cursor: string | null;
  from: string | null;
  to: string | null;
  order: 'asc' | 'desc';
}

export interface ListError {
  parameter: string;
  message: string;
}

export const LIST_LIMIT_DEFAULT = 20;
export const LIST_LIMIT_MAX = 100;

const ISO_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;

export function parseListOptions(get: (key: string) => string | null | undefined): { options: ListOptions; errors: ListError[] } {
  const errors: ListError[] = [];
  let limit = LIST_LIMIT_DEFAULT;
  const rawLimit = get('limit');
  if (rawLimit != null && rawLimit !== '') {
    const n = Number(rawLimit);
    if (!Number.isInteger(n) || n < 1 || n > LIST_LIMIT_MAX) errors.push({ parameter: 'limit', message: `limit must be an integer between 1 and ${LIST_LIMIT_MAX}` });
    else limit = n;
  }
  const cursor = get('cursor') || null;
  if (cursor && !/^[A-Za-z0-9_-]{1,1024}$/.test(cursor)) errors.push({ parameter: 'cursor', message: 'cursor is malformed' });
  const parseTime = (key: string): string | null => {
    const v = get(key);
    if (v == null || v === '') return null;
    if (!ISO_RE.test(v) || !Number.isFinite(Date.parse(v))) {
      errors.push({ parameter: key, message: `${key} must be an ISO 8601 date or date-time` });
      return null;
    }
    return v;
  };
  const from = parseTime('from');
  const to = parseTime('to');
  if (from && to && Date.parse(from) > Date.parse(to)) errors.push({ parameter: 'from', message: 'from must not be after to' });
  let order: 'asc' | 'desc' = 'desc';
  const rawOrder = get('order');
  if (rawOrder != null && rawOrder !== '') {
    if (rawOrder === 'asc' || rawOrder === 'desc') order = rawOrder;
    else errors.push({ parameter: 'order', message: 'order must be asc or desc' });
  }
  return { options: { limit, cursor, from, to, order }, errors };
}

interface CursorKey {
  d: string; // day
  i: number | null; // instant
  id: string;
  r: string; // content revision when issued
}

function keyOf(e: ResetEvent, revision: string): CursorKey {
  return { d: eventDay(e), i: eventInstant(e), id: e.id, r: revision };
}

function compareKeys(a: CursorKey, b: CursorKey): number {
  if (a.d !== b.d) return a.d < b.d ? -1 : 1;
  if (a.i != null && b.i != null && a.i !== b.i) return a.i - b.i;
  if (a.i != null && b.i == null) return -1;
  if (a.i == null && b.i != null) return 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function encodeCursor(key: CursorKey): string {
  const json = JSON.stringify(key);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeCursor(cursor: string): CursorKey | null {
  try {
    const b64 = cursor.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (cursor.length % 4)) % 4);
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const obj = JSON.parse(new TextDecoder().decode(bytes)) as Partial<CursorKey>;
    if (typeof obj.d !== 'string' || typeof obj.id !== 'string' || typeof obj.r !== 'string') return null;
    if (obj.i !== null && typeof obj.i !== 'number') return null;
    return { d: obj.d, i: obj.i ?? null, id: obj.id, r: obj.r };
  } catch {
    return null;
  }
}

export interface ListResult {
  items: ResetEvent[];
  hasMore: boolean;
  nextCursor: string | null;
  revisionChanged: boolean;
  error: ListError | null;
}

/**
 * Keyset pagination over the qualifying resets. Ordering is (day, instant, id), which does not
 * change when an event is edited, so edits during pagination never skip or duplicate records.
 * Date filters: exact times compare as instants; a date-only record matches when its stated
 * date lies within the [from, to] UTC dates.
 */
export function listResets(content: ContentSnapshot, filters: Filters, options: ListOptions): ListResult {
  let events = applyFilters(qualifyingResets(content.events), filters).sort(compareEventsAsc);
  if (options.from) {
    const fromT = Date.parse(options.from);
    const fromDay = options.from.slice(0, 10);
    events = events.filter((e) => {
      const i = eventInstant(e);
      return i != null ? i >= fromT : eventDay(e) >= fromDay;
    });
  }
  if (options.to) {
    const toT = Date.parse(options.to);
    const toDay = options.to.slice(0, 10);
    events = events.filter((e) => {
      const i = eventInstant(e);
      return i != null ? i <= toT : eventDay(e) <= toDay;
    });
  }
  if (options.order === 'desc') events = events.reverse();

  let revisionChanged = false;
  if (options.cursor) {
    const key = decodeCursor(options.cursor);
    if (!key) return { items: [], hasMore: false, nextCursor: null, revisionChanged: false, error: { parameter: 'cursor', message: 'cursor is malformed' } };
    revisionChanged = key.r !== content.revision;
    events = events.filter((e) => {
      const c = compareKeys(keyOf(e, content.revision), key);
      return options.order === 'asc' ? c > 0 : c < 0;
    });
  }
  const page = events.slice(0, options.limit);
  const hasMore = events.length > options.limit;
  const last = page[page.length - 1];
  return {
    items: page,
    hasMore,
    nextCursor: hasMore && last ? encodeCursor(keyOf(last, content.revision)) : null,
    revisionChanged,
    error: null,
  };
}
