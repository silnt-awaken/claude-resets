// Durable push alert creation and delivery.
//
// - createAlert() runs at publication time: one `alerts` row per (event, alertRevision, kind),
//   fanned out into `push_jobs` for subscriptions that existed at the consent cutoff.
// - drainPushJobs() runs from the cron trigger: leases a bounded batch, sends, and records
//   sent / retry / failed / expired. Overlapping invocations cannot double-send a leased job.

import { buildPushPayload, type PushSubscription, type VapidKeys } from '@block65/webcrypto-web-push';
import { findEvent, loadContent } from '../domain/content';
import type { Locale, ResetEvent } from '../domain/types';
import { siteConfig, type Env } from '../env';
import { localizePath } from '../i18n';
import { deactivateSubscriptionById, type StoredSubscription } from './subscriptions';

export interface PushPayloadBody {
  title: string;
  body: string;
  url: string;
  tag: string;
}

export interface PushTransport {
  send(subscription: StoredSubscription, payload: PushPayloadBody, vapid: VapidKeys): Promise<{ status: number }>;
}

/** Real Web Push delivery over the Push API with VAPID (RFC 8291 / 8292), using Web Crypto in the Worker. */
export const webPushTransport: PushTransport = {
  async send(subscription, payload, vapid) {
    const sub: PushSubscription = { endpoint: subscription.endpoint, expirationTime: null, keys: { p256dh: subscription.p256dh, auth: subscription.auth } };
    const request = await buildPushPayload({ data: JSON.stringify(payload), options: { ttl: 6 * 3600, urgency: 'high', topic: payload.tag.slice(0, 32) } }, sub, vapid);
    const res = await fetch(subscription.endpoint, request);
    return { status: res.status };
  },
};

export interface CreateAlertResult {
  created: boolean;
  alertId: number | null;
  jobs: number;
  reason?: string;
}

/**
 * Create the alert row and fan out jobs. Idempotent: a second call for the same
 * (event, alertRevision, kind) creates nothing and enqueues nothing.
 * `kind: 'correction'` targets only recipients of the original reset alert that are still active.
 */
export async function createAlert(
  db: D1Database,
  event: ResetEvent,
  kind: 'reset' | 'correction',
  cutoff: Date,
  now: Date,
): Promise<CreateAlertResult> {
  const inserted = await db
    .prepare('INSERT OR IGNORE INTO alerts (event_id, alert_revision, kind, cutoff_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(event.id, event.alertRevision, kind, cutoff.toISOString(), now.toISOString())
    .run();
  const row = await db
    .prepare('SELECT id FROM alerts WHERE event_id = ?1 AND alert_revision = ?2 AND kind = ?3')
    .bind(event.id, event.alertRevision, kind)
    .first<{ id: number }>();
  if (!row) return { created: false, alertId: null, jobs: 0, reason: 'alert row missing' };
  if ((inserted.meta.changes ?? 0) === 0) return { created: false, alertId: row.id, jobs: 0, reason: 'alert already exists' };

  let fanout;
  if (kind === 'reset') {
    fanout = await db
      .prepare(
        `INSERT OR IGNORE INTO push_jobs (alert_id, subscription_id, status, attempts, next_attempt_at, created_at)
         SELECT ?1, id, 'pending', 0, ?2, ?2 FROM push_subscriptions WHERE active = 1 AND created_at <= ?3`,
      )
      .bind(row.id, now.toISOString(), cutoff.toISOString())
      .run();
  } else {
    fanout = await db
      .prepare(
        `INSERT OR IGNORE INTO push_jobs (alert_id, subscription_id, status, attempts, next_attempt_at, created_at)
         SELECT ?1, s.id, 'pending', 0, ?2, ?2
         FROM push_subscriptions s
         JOIN push_jobs j ON j.subscription_id = s.id AND j.status = 'sent'
         JOIN alerts a ON a.id = j.alert_id AND a.event_id = ?3 AND a.kind = 'reset'
         WHERE s.active = 1`,
      )
      .bind(row.id, now.toISOString(), event.id)
      .run();
  }
  return { created: true, alertId: row.id, jobs: fanout.meta.changes ?? 0 };
}

export interface DrainOptions {
  now?: Date;
  limit?: number;
  transport?: PushTransport;
  maxAttempts?: number;
}

export interface DrainResult {
  leased: number;
  sent: number;
  retried: number;
  failed: number;
  expired: number;
  skipped: number;
  paused: boolean;
}

interface LeasedJob {
  id: number;
  alert_id: number;
  subscription_id: string;
  attempts: number;
}

interface JobContext {
  alert_created_at: string;
  alert_kind: string;
  event_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  locale: string;
  active: number;
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

export function buildPayload(event: ResetEvent, locale: Locale, siteName: string, kind: string): PushPayloadBody {
  const tr = locale === 'en' ? null : event.translations[locale];
  const title = tr?.title ?? event.title;
  const summary = tr?.summary ?? event.summary;
  const prefix = kind === 'correction' ? '[Correction] ' : '';
  return {
    title: truncate(`${prefix}${siteName}: ${title}`, 110),
    body: truncate(summary, 180),
    url: localizePath(locale, `/resets/${event.id}`),
    tag: `claude-reset-${event.id}-${kind}`,
  };
}

function backoffSeconds(attempt: number): number {
  return Math.min(3600, 30 * 2 ** Math.max(0, attempt - 1));
}

export async function drainPushJobs(env: Env, options: DrainOptions = {}): Promise<DrainResult> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 50;
  const maxAttempts = options.maxAttempts ?? 6;
  const cfg = siteConfig(env);
  const result: DrainResult = { leased: 0, sent: 0, retried: 0, failed: 0, expired: 0, skipped: 0, paused: cfg.alertsPaused };
  if (cfg.alertsPaused) return result;
  if (!cfg.browserAlerts.enabled) return result;
  const transport = options.transport ?? webPushTransport;
  const vapid: VapidKeys = { subject: env.VAPID_SUBJECT!, publicKey: env.VAPID_PUBLIC_KEY!, privateKey: env.VAPID_PRIVATE_KEY! };
  const db = env.DB;
  const nowIso = now.toISOString();
  const leaseUntil = new Date(now.getTime() + 5 * 60_000).toISOString();

  const leased = await db
    .prepare(
      `UPDATE push_jobs SET leased_until = ?1, attempts = attempts + 1
       WHERE id IN (
         SELECT id FROM push_jobs
         WHERE status = 'pending' AND next_attempt_at <= ?2 AND (leased_until IS NULL OR leased_until < ?2)
         ORDER BY id LIMIT ?3
       )
       RETURNING id, alert_id, subscription_id, attempts`,
    )
    .bind(leaseUntil, nowIso, limit)
    .all<LeasedJob>();
  const jobs = leased.results ?? [];
  result.leased = jobs.length;
  if (jobs.length === 0) return result;

  const content = loadContent();
  const maxAgeMs = cfg.alertMaxAgeHours * 3_600_000;

  for (const job of jobs) {
    const ctx = await db
      .prepare(
        `SELECT a.created_at AS alert_created_at, a.kind AS alert_kind, a.event_id, s.endpoint, s.p256dh, s.auth, s.locale, s.active
         FROM alerts a, push_subscriptions s WHERE a.id = ?1 AND s.id = ?2`,
      )
      .bind(job.alert_id, job.subscription_id)
      .first<JobContext>();
    const finish = (status: string, error: string | null, nextAttempt?: string) =>
      db
        .prepare('UPDATE push_jobs SET status = ?1, last_error = ?2, leased_until = NULL, next_attempt_at = COALESCE(?3, next_attempt_at), sent_at = CASE WHEN ?1 = ?4 THEN ?5 ELSE sent_at END WHERE id = ?6')
        .bind(status, error, nextAttempt ?? null, 'sent', nowIso, job.id)
        .run();

    if (!ctx) {
      await finish('failed', 'missing alert or subscription');
      result.failed++;
      continue;
    }
    if (ctx.active !== 1) {
      await finish('skipped', 'subscription no longer active');
      result.skipped++;
      continue;
    }
    if (now.getTime() - Date.parse(ctx.alert_created_at) > maxAgeMs) {
      await finish('expired', `alert older than ${cfg.alertMaxAgeHours}h`);
      result.expired++;
      continue;
    }
    const event = findEvent(content.events, ctx.event_id);
    if (!event || event.editorialStatus !== 'published') {
      await finish('skipped', 'event not published in deployed content');
      result.skipped++;
      continue;
    }
    const locale = (['en', 'zh-CN', 'zh-TW', 'ja', 'ko'] as const).includes(ctx.locale as Locale) ? (ctx.locale as Locale) : 'en';
    const payload = buildPayload(event, locale, cfg.siteName, ctx.alert_kind);
    const subscription: StoredSubscription = { id: job.subscription_id, endpoint: ctx.endpoint, p256dh: ctx.p256dh, auth: ctx.auth, locale };
    try {
      const res = await transport.send(subscription, payload, vapid);
      if (res.status >= 200 && res.status < 300) {
        await finish('sent', null);
        result.sent++;
      } else if (res.status === 404 || res.status === 410) {
        await deactivateSubscriptionById(db, job.subscription_id, now, `push service returned ${res.status}`);
        await finish('failed', `subscription gone (${res.status})`);
        result.failed++;
      } else if (job.attempts >= maxAttempts) {
        await finish('failed', `giving up after ${job.attempts} attempts (last status ${res.status})`);
        result.failed++;
      } else {
        const next = new Date(now.getTime() + backoffSeconds(job.attempts) * 1000).toISOString();
        await finish('pending', `status ${res.status}; retry scheduled`, next);
        result.retried++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message.slice(0, 200) : 'send failed';
      if (job.attempts >= maxAttempts) {
        await finish('failed', `giving up after ${job.attempts} attempts (${message})`);
        result.failed++;
      } else {
        const next = new Date(now.getTime() + backoffSeconds(job.attempts) * 1000).toISOString();
        await finish('pending', `${message}; retry scheduled`, next);
        result.retried++;
      }
    }
  }
  return result;
}
