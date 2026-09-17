import { describe, expect, it } from 'vitest';
import resets from '../content/resets.json';
import sources from '../content/sources.json';
import sponsors from '../content/sponsors.json';
import research from '../content/research-queue.json';
import review from '../content/review.json';
import { announcedResets, eventUtcDay, isQualifyingReset, loadContent, otherAnnouncements, qualifyingResets, withdrawnResets } from '../src/domain/content';
import { validateContent } from '../src/domain/schema';
import { computeStats } from '../src/domain/stats';
import { makeEvent, snapshotFor } from './fixtures';

describe('bundled content', () => {
  it('validates and loads', () => {
    const result = validateContent({ events: resets, sources, sponsors, research, review });
    expect(result.ok, result.ok ? '' : result.errors.join('\n')).toBe(true);
    const content = loadContent();
    expect(content.events.length).toBeGreaterThan(0);
    expect(content.sources).toHaveLength(7);
  });

  it('seeds exactly the verified reset history with exact timestamps decoded from post ids', () => {
    const content = loadContent();
    const resetsOnly = qualifyingResets(content.events);
    expect(resetsOnly).toHaveLength(12);
    expect(resetsOnly.every((e) => e.time.precision === 'exact')).toBe(true);
    const sep4 = content.events.find((e) => e.id === '2026-09-04-max-weekly')!;
    expect(sep4.audience.plans).toEqual(['max']);
    expect(sep4.windows).toEqual(['weekly']);
    const sep1 = content.events.find((e) => e.id === '2026-09-01-all-users')!;
    expect(sep1.audience.plans).toBe('all');
    expect(sep1.windows).toEqual(['five_hour', 'weekly']);
    const jun9 = content.events.find((e) => e.id === '2026-06-09-all-users')!;
    expect(jun9.sources.map((s) => s.role).sort()).toEqual(['original', 'relay']);
    const jul16 = content.events.find((e) => e.id === '2026-07-16-all-users')!;
    expect(eventUtcDay(jul16)).toBe('2026-07-16');
    const policy = content.events.find((e) => e.kind === 'policy_change')!;
    expect(isQualifyingReset(policy)).toBe(false);
    expect(otherAnnouncements(content.events).map((e) => e.id)).toContain(policy.id);
  });

  it('derives the latest tracked reset from the data', () => {
    const stats = computeStats(qualifyingResets(loadContent().events), new Date('2026-09-17T12:00:00Z'));
    expect(stats.latest.kind).toBe('exact');
    if (stats.latest.kind === 'exact') expect(stats.latest.event.id).toBe('2026-09-04-max-weekly');
    expect(stats.total).toBe(12);
    expect(stats.eligibleGaps).toBe(11);
  });
});

describe('classification fixtures', () => {
  const maxWeekly = makeEvent({ id: 'max-weekly', at: '2026-09-04T20:08:45Z', audience: { scope: 'limited', statement: 'everyone on a Claude Max plan', plans: ['max'] }, windows: ['weekly'] });
  const allTwoWindow = makeEvent({ id: 'all-two', at: '2026-09-01T18:35:27Z' });
  const promotion = makeEvent({ id: 'promo', kind: 'credit', at: '2026-08-01T00:00:00Z' });
  const outage = makeEvent({ id: 'outage', kind: 'incident', at: '2026-08-02T00:00:00Z' });
  const future = makeEvent({
    id: 'future',
    eventStatus: 'announced',
    at: '2026-09-10T00:00:00Z',
    schedule: { statedAt: '2026-09-12T00:00:00Z', statedWindow: null },
  });
  const retracted = makeEvent({ id: 'retracted', eventStatus: 'retracted', at: '2026-08-15T00:00:00Z', correction: { kind: 'retraction', reason: 'Source clarified no reset happened.', at: '2026-08-16T00:00:00Z' } });
  const relayed = makeEvent({
    id: 'relayed',
    at: '2026-06-09T21:48:01Z',
    sources: [
      { url: 'https://x.com/OfficialDevs/status/1', sourceId: 'official', handle: 'OfficialDevs', displayName: 'Official Devs', kind: 'x_post', role: 'original', evidenceSummary: 'original', verificationMethod: 'fixture', verifiedAt: '2026-09-01' },
      { url: 'https://x.com/teammember/status/2', sourceId: 'member', handle: 'teammember', displayName: 'Team Member', kind: 'x_post', role: 'relay', evidenceSummary: 'relay', verificationMethod: 'fixture', verifiedAt: '2026-09-01' },
      { url: 'https://x.com/teammember/status/3', sourceId: 'member', handle: 'teammember', displayName: 'Team Member', kind: 'x_post', role: 'relay', evidenceSummary: 'repost', verificationMethod: 'fixture', verifiedAt: '2026-09-01' },
    ],
  });
  const events = [maxWeekly, allTwoWindow, promotion, outage, future, retracted, relayed];

  it('counts only confirmed discretionary resets, merging relays into one event', () => {
    const content = snapshotFor(events);
    const counted = qualifyingResets(content.events).map((e) => e.id).sort();
    expect(counted).toEqual(['all-two', 'max-weekly', 'relayed']);
    expect(announcedResets(content.events).map((e) => e.id)).toEqual(['future']);
    expect(withdrawnResets(content.events).map((e) => e.id)).toEqual(['retracted']);
    expect(otherAnnouncements(content.events).map((e) => e.id).sort()).toEqual(['outage', 'promo']);
  });

  it('rejects the same source post recorded under two events', () => {
    const dup = makeEvent({ id: 'dup', at: '2026-06-09T22:00:00Z', sources: [{ ...relayed.sources[0]! }] });
    const result = validateContent({ events: [relayed, dup], sources: snapshotFor([]).sources, sponsors: [], research: [], review: { lastSourceReviewAt: '2026-09-01T00:00:00Z', note: '' } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('\n')).toMatch(/already used/);
  });

  it('rejects an announced event without a schedule and a retraction without a reason', () => {
    const bad1 = makeEvent({ eventStatus: 'announced' });
    const bad2 = makeEvent({ eventStatus: 'retracted' });
    const result = validateContent({ events: [bad1, bad2], sources: snapshotFor([]).sources, sponsors: [], research: [], review: { lastSourceReviewAt: '2026-09-01T00:00:00Z', note: '' } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('\n')).toMatch(/schedule/);
      expect(result.errors.join('\n')).toMatch(/correction/);
    }
  });

  it('rejects an exact record without a timestamp and a date record without a timezone', () => {
    const bad1 = makeEvent({ time: { precision: 'exact' } });
    const bad2 = makeEvent({ time: { precision: 'date', announcedOn: '2026-06-01' } });
    const result = validateContent({ events: [bad1, bad2], sources: snapshotFor([]).sources, sponsors: [], research: [], review: { lastSourceReviewAt: '2026-09-01T00:00:00Z', note: '' } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('\n')).toMatch(/announcedAt/);
      expect(result.errors.join('\n')).toMatch(/dateTimezone/);
    }
  });
});
