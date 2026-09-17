// UTC contribution-style calendar: 53 week columns (Sunday..Saturday) ending in the
// current UTC week. Only events whose UTC day is established are placed on a cell.

import { eventUtcDay } from './content';
import type { AudienceScope, ResetEvent } from './types';

export type CellState = 'outside' | 'none' | 'broad' | 'limited' | 'future';

export interface CalendarEventRef {
  id: string;
  scope: AudienceScope;
}

export interface CalendarCell {
  date: string; // YYYY-MM-DD (UTC)
  weekday: number; // 0 = Sunday
  state: CellState;
  events: CalendarEventRef[];
}

export interface MonthLabel {
  column: number;
  year: number;
  month: number; // 1..12
}

export interface CalendarGrid {
  weeks: CalendarCell[][];
  months: MonthLabel[];
  startDate: string;
  endDate: string;
  todayUtc: string;
  /** Events that could not be placed on a specific UTC day. */
  unplaced: ResetEvent[];
}

export function utcDayString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  const t = Date.parse(`${day}T00:00:00Z`);
  return new Date(t + n * 86_400_000).toISOString().slice(0, 10);
}

export function weekdayOf(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

export function buildCalendar(events: ResetEvent[], now: Date, coverageStart: string, weeks = 53): CalendarGrid {
  const todayUtc = utcDayString(now);
  const endDate = addDays(todayUtc, 6 - weekdayOf(todayUtc)); // Saturday of the current UTC week
  const startDate = addDays(endDate, -(weeks * 7 - 1)); // Sunday, `weeks` weeks earlier

  const byDay = new Map<string, CalendarEventRef[]>();
  const unplaced: ResetEvent[] = [];
  for (const e of events) {
    const day = eventUtcDay(e);
    if (!day) {
      unplaced.push(e);
      continue;
    }
    const list = byDay.get(day) ?? [];
    list.push({ id: e.id, scope: e.audience.scope });
    byDay.set(day, list);
  }

  const grid: CalendarCell[][] = [];
  const months: MonthLabel[] = [];
  for (let w = 0; w < weeks; w++) {
    const week: CalendarCell[] = [];
    for (let d = 0; d < 7; d++) {
      const date = addDays(startDate, w * 7 + d);
      const refs = byDay.get(date) ?? [];
      let state: CellState;
      if (refs.length > 0) state = refs.some((r) => r.scope === 'broad') ? 'broad' : 'limited';
      else if (date > todayUtc) state = 'future';
      else if (date < coverageStart) state = 'outside';
      else state = 'none';
      week.push({ date, weekday: d, state, events: refs });
      if (date.endsWith('-01')) {
        months.push({ column: w, year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) });
      }
    }
    grid.push(week);
  }

  return { weeks: grid, months, startDate, endDate, todayUtc, unplaced };
}
