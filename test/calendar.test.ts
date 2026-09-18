import { describe, expect, it } from 'vitest';
import { addDays, buildCalendar, weekdayOf } from '../src/domain/calendar';
import { makeEvent } from './fixtures';

const COVERAGE = '2026-04-16';

describe('buildCalendar', () => {
  it('builds 53 Sunday-to-Saturday columns ending in the current UTC week', () => {
    const now = new Date('2026-09-17T12:00:00Z'); // Thursday
    const grid = buildCalendar([], now, COVERAGE);
    expect(grid.weeks).toHaveLength(53);
    expect(grid.weeks.every((w) => w.length === 7)).toBe(true);
    expect(weekdayOf(grid.startDate)).toBe(0);
    expect(weekdayOf(grid.endDate)).toBe(6);
    expect(grid.endDate).toBe('2026-09-19');
    expect(grid.todayUtc).toBe('2026-09-17');
    const last = grid.weeks[52]!;
    expect(last[4]!.state).toBe('none'); // Thursday = today, in coverage
    expect(last[5]!.state).toBe('future');
    expect(last[6]!.state).toBe('future');
  });

  it('marks days before coverage as outside, not as no-reset', () => {
    const now = new Date('2026-09-17T12:00:00Z');
    const grid = buildCalendar([], now, COVERAGE);
    const cell = grid.weeks.flat().find((c) => c.date === '2026-04-15')!;
    expect(cell.state).toBe('outside');
    expect(grid.weeks.flat().find((c) => c.date === '2026-04-16')!.state).toBe('none');
  });

  it('places the July 16 03:58 UTC post on the UTC day July 16, not July 15', () => {
    const now = new Date('2026-09-17T12:00:00Z');
    const e = makeEvent({ at: '2026-07-16T03:58:48Z' });
    const grid = buildCalendar([e], now, COVERAGE);
    const cells = grid.weeks.flat();
    expect(cells.find((c) => c.date === '2026-07-16')!.events).toHaveLength(1);
    expect(cells.find((c) => c.date === '2026-07-15')!.events).toHaveLength(0);
    expect(cells.find((c) => c.date === '2026-07-16')!.state).toBe('broad');
  });

  it('distinguishes limited-scope days and keeps several events on one day', () => {
    const now = new Date('2026-09-17T12:00:00Z');
    const a = makeEvent({ at: '2026-06-19T02:50:28Z', audience: { scope: 'limited', statement: 'affected users', plans: ['pro', 'max'] } });
    const b = makeEvent({ at: '2026-06-19T20:00:00Z', audience: { scope: 'limited', statement: 'Max', plans: ['max'] } });
    const grid = buildCalendar([a, b], now, COVERAGE);
    const cell = grid.weeks.flat().find((c) => c.date === '2026-06-19')!;
    expect(cell.events).toHaveLength(2);
    expect(cell.state).toBe('limited');
  });

  it('leaves a date-only event with an unresolved UTC day off the grid but reports it', () => {
    const now = new Date('2026-09-17T12:00:00Z');
    const e = makeEvent({ on: '2026-07-01', dateTimezone: 'unknown' });
    const grid = buildCalendar([e], now, COVERAGE);
    expect(grid.weeks.flat().some((c) => c.events.length > 0)).toBe(false);
    expect(grid.unplaced.map((x) => x.id)).toEqual([e.id]);
  });

  it('places a date-only event whose UTC day is established', () => {
    const now = new Date('2026-09-17T12:00:00Z');
    const e = makeEvent({ on: '2026-07-01', dateTimezone: 'UTC', utcDayResolved: true });
    const grid = buildCalendar([e], now, COVERAGE);
    expect(grid.weeks.flat().find((c) => c.date === '2026-07-01')!.events).toHaveLength(1);
    expect(grid.unplaced).toHaveLength(0);
  });

  it('handles a leap day and year boundary in UTC', () => {
    const now = new Date('2028-03-05T00:00:00Z');
    const e = makeEvent({ at: '2028-02-29T23:59:59Z' });
    const grid = buildCalendar([e], now, '2027-01-01');
    const cells = grid.weeks.flat();
    expect(cells.find((c) => c.date === '2028-02-29')!.events).toHaveLength(1);
    expect(cells.some((c) => c.date === '2027-12-31')).toBe(true);
    expect(cells.some((c) => c.date === '2028-01-01')).toBe(true);
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-12-31', 1)).toBe('2028-01-01');
  });

  it('labels each month at the column holding its first day', () => {
    const now = new Date('2026-09-17T12:00:00Z');
    const grid = buildCalendar([], now, COVERAGE);
    const sep = grid.months.find((m) => m.year === 2026 && m.month === 9)!;
    expect(grid.weeks[sep.column]!.some((c) => c.date === '2026-09-01')).toBe(true);
    expect(grid.months.length).toBeGreaterThanOrEqual(12);
  });

  it('does not place events after today even if data claims a future date', () => {
    const now = new Date('2026-09-17T12:00:00Z');
    const grid = buildCalendar([makeEvent({ at: '2026-09-18T01:00:00Z' })], now, COVERAGE);
    expect(grid.weeks.flat().filter((c) => c.date > '2026-09-17').every((c) => c.state === 'future' && c.events.length === 0)).toBe(true);
    expect(grid.unplaced).toHaveLength(1);
  });
});
