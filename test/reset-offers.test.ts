import { afterEach, describe, expect, it } from 'vitest';
import { __setContentForTests, activeResetOffers, loadContent, qualifyingResets } from '../src/domain/content';
import { resetEventSchema } from '../src/domain/schema';
import { computeStatus } from '../src/domain/service';
import { DEFAULT_FILTERS } from '../src/domain/filters';
import type { StatusResponse } from '../src/routes/api-schemas';
import { makeEvent, snapshotFor } from './fixtures';
import { json, request } from './helpers';

afterEach(() => __setContentForTests(null));

describe('subscriber-redeemed reset offers', () => {
  const offer = makeEvent({ id: 'saved-reset', kind: 'credit', on: '2026-09-22', resetOffer: { expiresOn: '2026-10-22' }, audience: { scope: 'limited', statement: 'subscription users', plans: 'subscribers' }, windows: ['unspecified'] });

  it('keeps the saved reset out of applied-reset history, totals and latest-reset timing', () => {
    const content = loadContent();
    const status = computeStatus(content, DEFAULT_FILTERS, new Date('2026-09-23T12:00:00Z'));
    expect(status.offers.map((e) => e.id)).toEqual(['2026-09-22-opus-5-5-reset']);
    expect(status.stats.total).toBe(12);
    expect(status.latest?.id).toBe('2026-09-04-max-weekly');
    expect(qualifyingResets(content.events).some((e) => e.resetOffer)).toBe(false);
    expect(status.offers[0]!.windows).toEqual(['unspecified']);
  });

  it('lists the offer through its stated expiry date but never before announcement or after withdrawal', () => {
    expect(activeResetOffers([offer], new Date('2026-09-21T23:59:59Z'))).toHaveLength(0);
    expect(activeResetOffers([offer], new Date('2026-09-22T12:00:00Z'))).toHaveLength(1);
    expect(activeResetOffers([offer], new Date('2026-10-22T23:59:59Z'))).toHaveLength(1);
    expect(activeResetOffers([offer], new Date('2026-10-23T00:00:00Z'))).toHaveLength(0);
    for (const eventStatus of ['announced', 'cancelled', 'retracted'] as const) {
      expect(activeResetOffers([{ ...offer, eventStatus }], new Date('2026-09-23T12:00:00Z'))).toHaveLength(0);
    }
    expect(activeResetOffers([{ ...offer, editorialStatus: 'draft' }], new Date('2026-09-23T12:00:00Z'))).toHaveLength(0);
  });

  it('does not imply eligibility for an unspecified reset window', () => {
    const content = snapshotFor([offer]);
    const now = new Date('2026-09-23T12:00:00Z');
    expect(computeStatus(content, { audience: 'max', window: 'any' }, now).offers).toHaveLength(1);
    expect(computeStatus(content, { audience: 'max', window: 'weekly' }, now).offers).toHaveLength(0);
  });

  it('rejects misclassified credits and impossible expiry dates', () => {
    expect(resetEventSchema.safeParse({ ...offer, kind: 'usage_reset' }).success).toBe(false);
    expect(resetEventSchema.safeParse({ ...offer, resetOffer: { expiresOn: '2026-09-21' } }).success).toBe(false);
    expect(resetEventSchema.safeParse({ ...offer, resetOffer: { expiresOn: '2026-02-30' } }).success).toBe(false);
  });

  it('publishes the card, source link, and separate API offer without changing the reset count', async () => {
    const evergreen = { ...offer, resetOffer: { expiresOn: '2099-10-22' } };
    __setContentForTests(snapshotFor([evergreen]));
    const html = await (await request('/')).text();
    expect(html).toContain('data-role="reset-offer"');
    expect(html).toContain('Expires Oct 22, 2099');
    expect(html).toContain('https://claude.ai/settings/usage');
    const status = await json<StatusResponse>('/api/v1/status');
    expect(status.body.data.reset_offers[0]!.reset_offer?.expires_on).toBe('2099-10-22');
    expect(status.body.data.stats.total).toBe(0);
    expect(status.body.data.latest_reset).toBeNull();
  });

  it('keeps expired offers in the feed and detail page, with no redeem link or active homepage card', async () => {
    const expired = makeEvent({ id: 'expired-credit', kind: 'credit', on: '2000-01-01', resetOffer: { expiresOn: '2000-02-01' } });
    __setContentForTests(snapshotFor([expired]));
    expect(await (await request('/')).text()).not.toContain('data-role="reset-offer"');
    const page = await (await request('/resets/expired-credit')).text();
    expect(page).toContain('Expired Feb 1, 2000');
    expect(page).not.toContain('href="https://claude.ai/settings/usage"');
    const feed = await (await request('/feed.xml')).text();
    expect(feed).toContain('/resets/expired-credit');
    expect(feed).toContain('Subscriber-redeemed reset credit');
  });
});
