// Durable push alert creation and delivery.
//
// - createAlert() runs at publication time: one `alerts` row per (event, alertRevision, kind),
//   fanned out into `push_jobs` for subscriptions that existed at the consent cutoff. Both
//   statements run in one D1 batch (transaction), so an alert can never exist without its jobs.
// - drainPushJobs() runs from the cron trigger: leases a bounded batch, sends, and records
//   sent / retry / failed / expired. A job is only finalised by the drain that still holds
//   its lease, so overlapping or slow runs cannot double-send.

import { buildPushPayload, type PushSubscription, type VapidKeys } from '@block65/webcrypto-web-push';
import { findEvent, hashString, loadContent } from '../domain/content';
import type { Locale, ResetEvent } from '../domain/types';
import { siteConfig, type Env } from '../env';
import { localizePath } from '../i18n';
import { deleteSubscriptionById, type StoredSubscription } from './subscriptions';

export interface PushPayloadBody {
  title: string;
  body: string;
  url: string;
  tag: string;
}

export interface PushTransport {
  send(subscription: StoredSubscription, payload: PushPayloadBody, vapid: VapidKeys): Promise<{ status: number }>;
}

export const PUSH_FETCH_TIMEOUT_MS = 10_000;
export const LEASE_MS = 5 * 60_000;

/** Real Web Push delivery over the Push API with VAPID (RFC 8291 / 8292), using Web Crypto in the Worker. */
export const webPushTransport: PushTransport = {
  async send(subscription, payload, vapid) {
    const sub: PushSubscription = { endpoint: subscription.endpoint, expirationTime: null, keys: { p256dh: subscription.p256dh, auth: subscription.auth } };
    // Topic: at most 32 URL-safe characters; hashed so reset and correction pushes never collide.
    const topic = `${payload.tag.includes('-correction') ? 'c' : 'r'}-${hashString(payload.tag)}`.slice(0, 32);
    const request = await buildPushPayload({ data: JSON.stringify(payload), options: { ttl: 6 * 3600, urgency: 'high', topic } }, sub, vapid);
    const res = await fetch(subscription.endpoint, { ...request, signal: AbortSignal.timeout(PUSH_FETCH_TIMEOUT_MS) });
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
 * Create the alert row and fan out jobs atomically. Idempotent: a second call for the same
 * (event, alertRevision, kind) creates nothing and enqueues nothing, because the fan-out uses
 * the cutoff stored on the alert row and jobs are unique per (alert, subscription).
 * `kind: 'correction'` targets only recipients of the original reset alert that are still subscribed.
 */
export async function createAlert(db: D1Database, event: ResetEvent, kind: 'reset' | 'correction', cutoff: Date, now: Date): Promise<CreateAlertResult> {
  const nowIso = now.toISOString();
  const insertAlert = db
    .prepare('INSERT OR IGNORE INTO alerts (event_id, alert_revision, kind, cutoff_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(event.id, event.alertRevision, kind, cutoff.toISOString(), nowIso);
  const alertIdSubquery = `(SELECT id FROM alerts WHERE event_id = ?1 AND alert_revision = ?2 AND kind = ?3)`;
  const fanOut =
    kind === 'reset'
      ? db
          .prepare(
            `INSERT OR IGNORE INTO push_jobs (alert_id, subscription_id, status, attempts, next_attempt_at, created_at)
             SELECT ${alertIdSubquery}, id, 'pending', 0, ?4, ?4 FROM push_subscriptions
             WHERE active = 1 AND created_at <= (SELECT cutoff_at FROM alerts WHERE event_id = ?1 AND alert_revision = ?2 AND kind = ?3)`,
          )
          .bind(event.id, event.alertRevision, kind, nowIso)
      : db
          .prepare(
            `INSERT OR IGNORE INTO push_jobs (alert_id, subscription_id, status, attempts, next_attempt_at, created_at)
             SELECT ${alertIdSubquery}, s.id, 'pending', 0, ?4, ?4
             FROM push_subscriptions s
             JOIN push_jobs j ON j.subscription_id = s.id AND j.status = 'sent'
             JOIN alerts a ON a.id = j.alert_id AND a.event_id = ?1 AND a.kind = 'reset'
             WHERE s.active = 1`,
          )
          .bind(event.id, event.alertRevision, kind, nowIso);
  const [inserted, fanned] = await db.batch([insertAlert, fanOut]);
  const row = await db.prepare('SELECT id FROM alerts WHERE event_id = ?1 AND alert_revision = ?2 AND kind = ?3').bind(event.id, event.alertRevision, kind).first<{ id: number }>();
  if (!row) return { created: false, alertId: null, jobs: 0, reason: 'alert row missing' };
  const created = (inserted?.meta.changes ?? 0) > 0;
  if (!created) return { created: false, alertId: row.id, jobs: 0, reason: 'alert already exists' };
  return { created: true, alertId: row.id, jobs: fanned?.meta.changes ?? 0 };
}

/** True when a reset alert (any alert revision) has already been created for the event. */
export async function hasResetAlert(db: D1Database, eventId: string): Promise<boolean> {
  const row = await db.prepare("SELECT 1 AS x FROM alerts WHERE event_id = ?1 AND kind = 'reset' LIMIT 1").bind(eventId).first();
  return !!row;
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
  /** Jobs whose lease had been taken over by another run before they could be finalised. */
  lost: number;
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
  endpoint: string | null;
  p256dh: string | null;
  auth: string | null;
  locale: string | null;
  active: number | null;
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
  const result: DrainResult = { leased: 0, sent: 0, retried: 0, failed: 0, expired: 0, skipped: 0, lost: 0, paused: cfg.alertsPaused };
  if (cfg.alertsPaused) return result;
  if (!cfg.browserAlerts.enabled) return result;
  const transport = options.transport ?? webPushTransport;
  const vapid: VapidKeys = { subject: env.VAPID_SUBJECT!, publicKey: env.VAPID_PUBLIC_KEY!, privateKey: env.VAPID_PRIVATE_KEY! };
  const db = env.DB;
  const nowIso = now.toISOString();
  // A unique lease token per run: the finalising UPDATE only succeeds while this run still holds the lease.
  const leaseUntil = new Date(now.getTime() + LEASE_MS).toISOString();
  const leaseToken = crypto.randomUUID();

  const leased = await db
    .prepare(
      `UPDATE push_jobs SET leased_until = ?1, lease_token = ?4, attempts = attempts + 1
       WHERE id IN (
         SELECT id FROM push_jobs
         WHERE status = 'pending' AND next_attempt_at <= ?2 AND (leased_until IS NULL OR leased_until < ?2)
         ORDER BY id LIMIT ?3
       )
       RETURNING id, alert_id, subscription_id, attempts`,
    )
    .bind(leaseUntil, nowIso, limit, leaseToken)
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
         FROM alerts a LEFT JOIN push_subscriptions s ON s.id = ?2 WHERE a.id = ?1`,
      )
      .bind(job.alert_id, job.subscription_id)
      .first<JobContext>();
    /** Finalise only while this run still holds the lease. Returns false when another run took over. */
    const finish = async (status: string, error: string | null, nextAttempt?: string): Promise<boolean> => {
      const res = await db
        .prepare(
          `UPDATE push_jobs SET status = ?1, last_error = ?2, leased_until = NULL, lease_token = NULL, next_attempt_at = COALESCE(?3, next_attempt_at),
             sent_at = CASE WHEN ?1 = 'sent' THEN ?4 ELSE sent_at END
           WHERE id = ?5 AND lease_token = ?6`,
        )
        .bind(status, error, nextAttempt ?? null, nowIso, job.id, leaseToken)
        .run();
      if ((res.meta.changes ?? 0) === 0) {
        result.lost++;
        return false;
      }
      return true;
    };

    if (!ctx) {
      if (await finish('failed', 'missing alert')) result.failed++;
      continue;
    }
    if (!ctx.endpoint || ctx.active !== 1) {
      if (await finish('skipped', 'subscription removed')) result.skipped++;
      continue;
    }
    if (now.getTime() - Date.parse(ctx.alert_created_at) > maxAgeMs) {
      if (await finish('expired', `alert older than ${cfg.alertMaxAgeHours}h`)) result.expired++;
      continue;
    }
    const event = findEvent(content.events, ctx.event_id);
    if (!event || event.editorialStatus !== 'published') {
      if (await finish('skipped', 'event not published in deployed content')) result.skipped++;
      continue;
    }
    const locale = (['en', 'zh-CN', 'zh-TW', 'ja', 'ko'] as const).includes(ctx.locale as Locale) ? (ctx.locale as Locale) : 'en';
    const payload = buildPayload(event, locale, cfg.siteName, ctx.alert_kind);
    const subscription: StoredSubscription = { id: job.subscription_id, endpoint: ctx.endpoint, p256dh: ctx.p256dh!, auth: ctx.auth!, locale };
    try {
      const res = await transport.send(subscription, payload, vapid);
      if (res.status >= 200 && res.status < 300) {
        if (await finish('sent', null)) result.sent++;
      } else if (res.status === 404 || res.status === 410) {
        // Record the outcome first so the job row is not swept away with the subscription's pending jobs.
        if (await finish('failed', `subscription gone (${res.status})`)) result.failed++;
        await deleteSubscriptionById(db, job.subscription_id);
      } else if (job.attempts >= maxAttempts) {
        if (await finish('failed', `giving up after ${job.attempts} attempts (last status ${res.status})`)) result.failed++;
      } else {
        const next = new Date(now.getTime() + backoffSeconds(job.attempts) * 1000).toISOString();
        if (await finish('pending', `status ${res.status}; retry scheduled`, next)) result.retried++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message.slice(0, 200) : 'send failed';
      if (job.attempts >= maxAttempts) {
        if (await finish('failed', `giving up after ${job.attempts} attempts (${message})`)) result.failed++;
      } else {
        const next = new Date(now.getTime() + backoffSeconds(job.attempts) * 1000).toISOString();
        if (await finish('pending', `${message}; retry scheduled`, next)) result.retried++;
      }
    }
  }
  return result;
}
