// Pure reset statistics. Input is the already-filtered list of qualifying resets.
//
// Rules (see /about):
// - total = number of distinct qualifying events (sources are merged per event upstream).
// - A completed gap is eligible only between two consecutive events whose announcement
//   times are both exact AND with no date-only event on any day between them (inclusive).
//   A date-only event is never bridged: the gap on either side of it is ineligible.
// - Average interval = sum of eligible gaps / number of eligible gaps.
// - Longest wait = maximum eligible gap. The unfinished time since the latest event is
//   shown in the hero and is never included here.
// - When the newest events cannot be ordered within a day, the latest is "ambiguous".

import { addDays } from './calendar';
import { eventDay, eventInstant, eventUtcDay, sortEventsAsc } from './content';
import type { ResetEvent } from './types';

export const DAY_MS = 86_400_000;

/**
 * The UTC days a date-only record may really fall on. A record whose date is known in UTC
 * covers one day; a record known only in a local or unknown zone may straddle the
 * neighbouring UTC days, so it is treated as spanning three.
 */
export function dateOnlySpan(e: ResetEvent): { from: string; to: string } | null {
  if (e.time.precision !== 'date' || !e.time.announcedOn) return null;
  const day = e.time.announcedOn;
  if (eventUtcDay(e)) return { from: day, to: day };
  return { from: addDays(day, -1), to: addDays(day, 1) };
}

function spansOverlap(span: { from: string; to: string }, from: string, to: string): boolean {
  return span.from <= to && span.to >= from;
}

export type LatestState =
  | { kind: 'none' }
  | { kind: 'exact'; event: ResetEvent; instant: number }
  | { kind: 'date'; event: ResetEvent; day: string }
  | { kind: 'ambiguous'; events: ResetEvent[]; day: string };

export interface Stats {
  total: number;
  latest: LatestState;
  averageIntervalDays: number | null;
  longestGapDays: number | null;
  /** Number of gaps that could be measured precisely. */
  eligibleGaps: number;
  /** Number of consecutive pairs in the full history (total - 1). */
  totalGaps: number;
  exactCount: number;
  /** True when at least one gap in the history could not be measured. */
  partialSample: boolean;
  /** Milliseconds since the latest exact event, clamped to zero. Null when the latest is not exact. */
  sinceLatestMs: number | null;
}

export function computeStats(events: ResetEvent[], now: Date): Stats {
  const sorted = sortEventsAsc(events);
  const total = sorted.length;
  const exactCount = sorted.filter((e) => e.time.precision === 'exact').length;
  const dateOnlySpans = sorted.map(dateOnlySpan).filter((s): s is { from: string; to: string } => s !== null);

  const gaps: number[] = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;
    const ia = eventInstant(a);
    const ib = eventInstant(b);
    if (ia == null || ib == null) continue;
    const dayA = eventDay(a);
    const dayB = eventDay(b);
    // Never measure across days that may hold a date-only event (its position inside the day is unknown).
    if (dateOnlySpans.some((s) => spansOverlap(s, dayA, dayB))) continue;
    const gap = ib - ia;
    if (gap < 0) continue;
    gaps.push(gap);
  }

  const totalGaps = Math.max(0, total - 1);
  const sum = gaps.reduce((s, g) => s + g, 0);
  const averageIntervalDays = gaps.length ? sum / gaps.length / DAY_MS : null;
  const longestGapDays = gaps.length ? Math.max(...gaps) / DAY_MS : null;

  let latest: LatestState = { kind: 'none' };
  if (total > 0) {
    const last = sorted[total - 1]!;
    const lastDay = eventDay(last);
    const lastSpan = dateOnlySpan(last) ?? { from: lastDay, to: lastDay };
    // Every event whose possible days overlap the newest event's possible days cannot be ordered against it.
    const contenders = sorted.filter((e) => {
      if (e === last) return true;
      const span = dateOnlySpan(e) ?? { from: eventDay(e), to: eventDay(e) };
      return spansOverlap(span, lastSpan.from, lastSpan.to);
    });
    const dateOnlyContenders = contenders.filter((e) => e.time.precision === 'date');
    if (last.time.precision === 'exact' && dateOnlyContenders.length === 0) {
      latest = { kind: 'exact', event: last, instant: eventInstant(last)! };
    } else if (contenders.length === 1) {
      latest = { kind: 'date', event: last, day: lastDay };
    } else {
      latest = { kind: 'ambiguous', events: contenders, day: lastDay };
    }
  }

  const sinceLatestMs = latest.kind === 'exact' ? Math.max(0, now.getTime() - latest.instant) : null;

  return {
    total,
    latest,
    averageIntervalDays,
    longestGapDays,
    eligibleGaps: gaps.length,
    totalGaps,
    exactCount,
    partialSample: gaps.length < totalGaps,
    sinceLatestMs,
  };
}

/** Days with one decimal, e.g. "6.9". Only used for precisely measured values. */
export function formatDays(days: number): string {
  return (Math.round(days * 10) / 10).toFixed(1);
}

/** Round to one decimal for API output; null passes through. */
export function roundDays(days: number | null): number | null {
  return days == null ? null : Math.round(days * 10) / 10;
}

export interface RelativeParts {
  unit: 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month';
  value: number;
}

/** Coarse relative age used for the hero figure and archive chips. */
export function relativeParts(ms: number): RelativeParts {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return { unit: 'second', value: s };
  const m = Math.floor(s / 60);
  if (m < 60) return { unit: 'minute', value: m };
  const h = Math.floor(m / 60);
  if (h < 24) return { unit: 'hour', value: h };
  const d = Math.floor(h / 24);
  if (d < 7) return { unit: 'day', value: d };
  if (d < 30) return { unit: 'week', value: Math.floor(d / 7) };
  return { unit: 'month', value: Math.floor(d / 30) };
}
