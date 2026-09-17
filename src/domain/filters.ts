// Audience / window filters shared by the homepage, the public API and the MCP tools.
// One definition so every surface agrees on what "Max" or "weekly" means.

import type { Plan, ResetEvent } from './types';

export const AUDIENCE_FILTERS = ['all', 'broad', 'max', 'pro', 'team'] as const;
export type AudienceFilter = (typeof AUDIENCE_FILTERS)[number];

export const WINDOW_FILTERS = ['any', 'five_hour', 'weekly'] as const;
export type WindowFilter = (typeof WINDOW_FILTERS)[number];

export interface Filters {
  audience: AudienceFilter;
  window: WindowFilter;
}

export const DEFAULT_FILTERS: Filters = { audience: 'all', window: 'any' };

export interface FilterError {
  parameter: string;
  message: string;
}

export interface ParsedFilters {
  filters: Filters;
  errors: FilterError[];
}

/** Parse filters from query parameters. Unknown values produce errors instead of silently defaulting. */
export function parseFilters(get: (key: string) => string | null | undefined): ParsedFilters {
  const errors: FilterError[] = [];
  let audience: AudienceFilter = 'all';
  let window: WindowFilter = 'any';

  const a = get('audience');
  if (a != null && a !== '') {
    if ((AUDIENCE_FILTERS as readonly string[]).includes(a)) audience = a as AudienceFilter;
    else errors.push({ parameter: 'audience', message: `audience must be one of: ${AUDIENCE_FILTERS.join(', ')}` });
  }
  const w = get('window');
  if (w != null && w !== '') {
    if ((WINDOW_FILTERS as readonly string[]).includes(w)) window = w as WindowFilter;
    else errors.push({ parameter: 'window', message: `window must be one of: ${WINDOW_FILTERS.join(', ')}` });
  }
  return { filters: { audience, window }, errors };
}

/**
 * Whether the event's stated audience includes the given plan.
 * "all users / everyone" includes every plan. "all subscribers" includes every paid plan.
 * An unspecified audience never matches a plan filter: unknown eligibility is not eligibility.
 */
export function planIncluded(ev: ResetEvent, plan: Plan): boolean {
  const plans = ev.audience.plans;
  if (plans === 'all') return true;
  if (plans === 'subscribers') return plan !== 'free';
  if (plans === 'unspecified') return false;
  return plans.includes(plan);
}

export function matchesAudience(ev: ResetEvent, filter: AudienceFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'broad':
      return ev.audience.scope === 'broad';
    case 'max':
      return planIncluded(ev, 'max');
    case 'pro':
      return planIncluded(ev, 'pro');
    case 'team':
      return planIncluded(ev, 'team');
  }
}

export function matchesWindow(ev: ResetEvent, filter: WindowFilter): boolean {
  if (filter === 'any') return true;
  return ev.windows.includes(filter);
}

export function matchesFilters(ev: ResetEvent, filters: Filters): boolean {
  return matchesAudience(ev, filters.audience) && matchesWindow(ev, filters.window);
}

export function applyFilters(events: ResetEvent[], filters: Filters): ResetEvent[] {
  return events.filter((ev) => matchesFilters(ev, filters));
}

export function isDefaultFilters(filters: Filters): boolean {
  return filters.audience === 'all' && filters.window === 'any';
}

/** Query string (including the leading `?`) for non-default filters, or an empty string. */
export function filtersToQuery(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.audience !== 'all') params.set('audience', filters.audience);
  if (filters.window !== 'any') params.set('window', filters.window);
  const s = params.toString();
  return s ? `?${s}` : '';
}
