import { describe, expect, it } from 'vitest';
import { computeStats, formatDays, relativeParts } from '../src/domain/stats';
import { makeEvent } from './fixtures';

const NOW = new Date('2026-09-17T12:00:00Z');

describe('computeStats', () => {
  it('handles an empty history', () => {
    const s = computeStats([], NOW);
    expect(s.total).toBe(0);
    expect(s.latest.kind).toBe('none');
    expect(s.averageIntervalDays).toBeNull();
    expect(s.longestGapDays).toBeNull();
    expect(s.eligibleGaps).toBe(0);
    expect(s.sinceLatestMs).toBeNull();
  });

  it('handles a single event: no gaps, latest exact', () => {
    const s = computeStats([makeEvent({ at: '2026-09-04T20:08:45Z' })], NOW);
    expect(s.total).toBe(1);
    expect(s.latest.kind).toBe('exact');
    expect(s.averageIntervalDays).toBeNull();
    expect(s.longestGapDays).toBeNull();
    expect(s.partialSample).toBe(false);
    expect(s.sinceLatestMs).toBe(NOW.getTime() - Date.parse('2026-09-04T20:08:45Z'));
  });

  it('computes average and longest from precise gaps regardless of input order', () => {
    const events = [
      makeEvent({ at: '2026-06-10T00:00:00Z' }),
      makeEvent({ at: '2026-06-01T00:00:00Z' }),
      makeEvent({ at: '2026-06-04T00:00:00Z' }),
    ];
    const s = computeStats(events, NOW);
    expect(s.total).toBe(3);
    expect(s.eligibleGaps).toBe(2);
    expect(s.averageIntervalDays).toBeCloseTo(4.5, 6);
    expect(s.longestGapDays).toBeCloseTo(6, 6);
    expect(s.partialSample).toBe(false);
    expect(formatDays(s.averageIntervalDays!)).toBe('4.5');
  });

  it('never bridges an intervening date-only event', () => {
    const events = [
      makeEvent({ at: '2026-06-01T00:00:00Z' }),
      makeEvent({ on: '2026-06-05', dateTimezone: 'UTC', utcDayResolved: true }),
      makeEvent({ at: '2026-06-11T00:00:00Z' }),
    ];
    const s = computeStats(events, NOW);
    expect(s.total).toBe(3);
    expect(s.eligibleGaps).toBe(0);
    expect(s.averageIntervalDays).toBeNull();
    expect(s.longestGapDays).toBeNull();
    expect(s.partialSample).toBe(true);
    expect(s.latest.kind).toBe('exact');
  });

  it('discloses a partial sample when only some gaps are measurable', () => {
    const events = [
      makeEvent({ at: '2026-05-01T00:00:00Z' }),
      makeEvent({ at: '2026-05-03T00:00:00Z' }),
      makeEvent({ on: '2026-05-10', dateTimezone: 'UTC', utcDayResolved: true }),
      makeEvent({ at: '2026-05-20T00:00:00Z' }),
    ];
    const s = computeStats(events, NOW);
    expect(s.totalGaps).toBe(3);
    expect(s.eligibleGaps).toBe(1);
    expect(s.longestGapDays).toBeCloseTo(2, 6);
    expect(s.partialSample).toBe(true);
  });

  it('does not include the unfinished time since the latest event in the longest gap', () => {
    const events = [makeEvent({ at: '2026-01-01T00:00:00Z' }), makeEvent({ at: '2026-01-03T00:00:00Z' })];
    const s = computeStats(events, NOW);
    expect(s.longestGapDays).toBeCloseTo(2, 6);
    expect(s.sinceLatestMs).toBeGreaterThan(200 * 86_400_000);
  });

  it('measures same-day exact events precisely', () => {
    const events = [makeEvent({ at: '2026-06-19T02:50:28Z' }), makeEvent({ at: '2026-06-19T23:05:06Z' })];
    const s = computeStats(events, NOW);
    expect(s.eligibleGaps).toBe(1);
    expect(s.longestGapDays).toBeCloseTo((Date.parse('2026-06-19T23:05:06Z') - Date.parse('2026-06-19T02:50:28Z')) / 86_400_000, 9);
  });

  it('reports the latest as date-only when the newest record has no exact time', () => {
    const events = [makeEvent({ at: '2026-06-01T00:00:00Z' }), makeEvent({ on: '2026-06-09', dateTimezone: 'unknown' })];
    const s = computeStats(events, NOW);
    expect(s.latest.kind).toBe('date');
    expect(s.sinceLatestMs).toBeNull();
  });

  it('reports an ambiguous latest group when the newest events share a date and cannot be ordered', () => {
    const events = [makeEvent({ id: 'a', at: '2026-06-09T10:00:00Z' }), makeEvent({ id: 'b', on: '2026-06-09', dateTimezone: 'unknown' })];
    const s = computeStats(events, NOW);
    expect(s.latest.kind).toBe('ambiguous');
    if (s.latest.kind === 'ambiguous') expect(s.latest.events.map((e) => e.id).sort()).toEqual(['a', 'b']);
  });

  it('clamps clock skew: a latest event slightly in the future has zero age, never negative', () => {
    const s = computeStats([makeEvent({ at: '2026-09-17T12:00:30Z' })], NOW);
    expect(s.sinceLatestMs).toBe(0);
  });
});

describe('relativeParts', () => {
  it('buckets coarse units', () => {
    expect(relativeParts(5_000)).toEqual({ unit: 'second', value: 5 });
    expect(relativeParts(5 * 86_400_000)).toEqual({ unit: 'day', value: 5 });
    expect(relativeParts(14 * 86_400_000)).toEqual({ unit: 'week', value: 2 });
    expect(relativeParts(-1000).value).toBe(0);
  });
});
