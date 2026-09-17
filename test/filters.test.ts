import { describe, expect, it } from 'vitest';
import { applyFilters, filtersToQuery, matchesAudience, matchesWindow, parseFilters } from '../src/domain/filters';
import { makeEvent, mixedScopeEvents } from './fixtures';

describe('audience filters', () => {
  const [all, maxOnly, unspecified] = mixedScopeEvents();

  it('"all users" includes every plan; unspecified eligibility matches nothing', () => {
    expect(matchesAudience(all!, 'max')).toBe(true);
    expect(matchesAudience(all!, 'pro')).toBe(true);
    expect(matchesAudience(all!, 'team')).toBe(true);
    expect(matchesAudience(unspecified!, 'max')).toBe(false);
    expect(matchesAudience(unspecified!, 'pro')).toBe(false);
    expect(matchesAudience(unspecified!, 'all')).toBe(true);
  });

  it('explicitly Max-scoped resets match Max only', () => {
    expect(matchesAudience(maxOnly!, 'max')).toBe(true);
    expect(matchesAudience(maxOnly!, 'pro')).toBe(false);
    expect(matchesAudience(maxOnly!, 'broad')).toBe(false);
  });

  it('"all subscribers" includes paid plans but not free', () => {
    const subs = makeEvent({ audience: { plans: 'subscribers', statement: 'all subscribers', scope: 'broad' } });
    expect(matchesAudience(subs, 'max')).toBe(true);
    expect(matchesAudience(subs, 'team')).toBe(true);
    expect(matchesAudience(subs, 'broad')).toBe(true);
  });

  it('applies the same rule across the list', () => {
    const ids = applyFilters(mixedScopeEvents(), { audience: 'max', window: 'any' }).map((e) => e.id);
    expect(ids).toEqual(['all-users', 'max-only']);
  });
});

describe('window filters', () => {
  it('matches named windows only', () => {
    const weekly = makeEvent({ windows: ['weekly'] });
    const unspecified = makeEvent({ windows: ['unspecified'] });
    expect(matchesWindow(weekly, 'weekly')).toBe(true);
    expect(matchesWindow(weekly, 'five_hour')).toBe(false);
    expect(matchesWindow(unspecified, 'weekly')).toBe(false);
    expect(matchesWindow(unspecified, 'any')).toBe(true);
  });
});

describe('parseFilters', () => {
  it('defaults and validates', () => {
    expect(parseFilters(() => null).filters).toEqual({ audience: 'all', window: 'any' });
    const bad = parseFilters((k) => (k === 'audience' ? 'enterprise-x' : null));
    expect(bad.errors[0]?.parameter).toBe('audience');
    const ok = parseFilters((k) => (k === 'audience' ? 'max' : k === 'window' ? 'weekly' : null));
    expect(ok.errors).toHaveLength(0);
    expect(filtersToQuery(ok.filters)).toBe('?audience=max&window=weekly');
    expect(filtersToQuery({ audience: 'all', window: 'any' })).toBe('');
  });
});
