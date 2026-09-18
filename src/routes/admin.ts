// Private publication endpoint used by the local editorial commands.
// Authenticated with CONTENT_PUBLISH_TOKEN (Bearer). Never linked from public pages.

import { Hono } from 'hono';
import { eventContentHash, findEvent, isQualifyingReset, loadContent } from '../domain/content';
import { resetEventSchema } from '../domain/schema';
import type { ResetEvent } from '../domain/types';
import { siteConfig, type Env } from '../env';
import { createAlert, drainPushJobs, hasResetAlert } from '../push/delivery';
import { countActiveSubscriptions } from '../push/subscriptions';
import { problem, readJson, timingSafeEqual } from '../util/http';

export const admin = new Hono<{ Bindings: Env }>();

admin.use('*', async (c, next) => {
  c.header('cache-control', 'no-store');
  const token = c.env.CONTENT_PUBLISH_TOKEN;
  if (!token || token.length < 16) return problem(c, 503, 'publish_disabled', 'Publication endpoint is not configured.');
  const header = c.req.header('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!presented || !timingSafeEqual(presented, token)) return problem(c, 401, 'unauthorized', 'Missing or invalid publication token.');
  await next();
});

type Mode = 'publish' | 'backfill' | 'correct';
type AlertPolicy = 'default' | 'none' | 'correction';

interface PublishRequest {
  eventId: string;
  mode: Mode;
  alertPolicy: AlertPolicy;
  late: boolean;
  event: ResetEvent;
}

function parsePublishRequest(value: unknown): { ok: true; req: PublishRequest } | { ok: false; error: string } {
  if (!value || typeof value !== 'object') return { ok: false, error: 'body must be an object' };
  const v = value as Record<string, unknown>;
  const mode = v.mode;
  if (mode !== 'publish' && mode !== 'backfill' && mode !== 'correct') return { ok: false, error: 'mode must be publish, backfill or correct' };
  const alertPolicy = v.alertPolicy ?? (mode === 'backfill' ? 'none' : mode === 'correct' ? 'none' : 'default');
  if (alertPolicy !== 'default' && alertPolicy !== 'none' && alertPolicy !== 'correction') return { ok: false, error: 'alertPolicy must be default, none or correction' };
  if (mode === 'backfill' && alertPolicy !== 'none') return { ok: false, error: 'backfill never sends alerts; alertPolicy must be none' };
  if (mode === 'correct' && alertPolicy === 'default') return { ok: false, error: 'corrections use alertPolicy none or correction' };
  const parsed = resetEventSchema.safeParse(v.event);
  if (!parsed.success) return { ok: false, error: `event is invalid: ${parsed.error.issues.map((i) => i.message).join('; ')}` };
  const event = parsed.data as ResetEvent;
  if (typeof v.eventId !== 'string' || v.eventId !== event.id) return { ok: false, error: 'eventId must match event.id' };
  return { ok: true, req: { eventId: event.id, mode, alertPolicy, late: v.late === true, event } };
}

admin.post('/publish', async (c) => {
  const body = await readJson(c, 256 * 1024);
  if (!body.ok) return problem(c, 400, 'invalid_body', body.error);
  const parsed = parsePublishRequest(body.value);
  if (!parsed.ok) return problem(c, 400, 'invalid_request', parsed.error);
  const { req } = parsed;
  const content = loadContent();
  const deployed = findEvent(content.events, req.eventId);
  if (!deployed) return problem(c, 409, 'not_deployed', `Event ${req.eventId} is not part of the deployed content. Deploy the content first, then publish.`);
  const localHash = eventContentHash(req.event);
  const deployedHash = eventContentHash(deployed);
  if (localHash !== deployedHash) {
    return problem(c, 409, 'content_mismatch', `Local event revision ${req.event.revision} (${localHash}) differs from the deployed revision ${deployed.revision} (${deployedHash}). Deploy first or pull the latest content.`);
  }
  if (deployed.editorialStatus !== 'published') return problem(c, 409, 'not_published', 'The deployed event is not marked as published.');

  const now = new Date();
  const db = c.env.DB;
  const existing = await db
    .prepare('SELECT content_hash, mode, alert_policy, published_at FROM publications WHERE event_id = ?1 AND revision = ?2')
    .bind(req.eventId, req.event.revision)
    .first<{ content_hash: string; mode: string; alert_policy: string; published_at: string }>();
  let recorded = false;
  if (existing) {
    if (existing.content_hash !== deployedHash) return problem(c, 409, 'revision_conflict', `Revision ${req.event.revision} was already recorded with a different content hash. Bump the revision.`);
  } else {
    await db
      .prepare('INSERT OR IGNORE INTO publications (event_id, revision, content_hash, mode, alert_policy, event_status, published_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
      .bind(req.eventId, req.event.revision, deployedHash, req.mode, req.alertPolicy, req.event.eventStatus, now.toISOString())
      .run();
    recorded = true;
  }

  const cfg = siteConfig(c.env);
  let alert: { created: boolean; alertId: number | null; jobs: number; reason?: string } | null = null;
  const backfilled = await db.prepare("SELECT 1 AS x FROM publications WHERE event_id = ?1 AND mode = 'backfill'").bind(req.eventId).first();
  const previouslyAnnounced = await db.prepare("SELECT 1 AS x FROM publications WHERE event_id = ?1 AND event_status = 'announced'").bind(req.eventId).first();

  if (req.mode === 'publish' && req.alertPolicy === 'default') {
    if (!isQualifyingReset(req.event)) alert = { created: false, alertId: null, jobs: 0, reason: 'not a confirmed usage reset; no default alert' };
    else if (backfilled) alert = { created: false, alertId: null, jobs: 0, reason: 'event was imported as history; alerts suppressed' };
    else if (await hasResetAlert(db, req.eventId)) alert = { created: false, alertId: null, jobs: 0, reason: 'a reset alert was already sent for this event; use a correction if subscribers must be told' };
    else {
      // Freshness is judged from the announcement, except when this publication confirms a reset that
      // was previously published as announced: the confirmation itself is the news.
      const announced = req.event.time.precision === 'exact' && req.event.time.announcedAt ? Date.parse(req.event.time.announcedAt) : Date.parse(`${req.event.time.announcedOn}T12:00:00Z`);
      const ageHours = previouslyAnnounced ? 0 : (now.getTime() - announced) / 3_600_000;
      if (ageHours > cfg.alertMaxAgeHours && !req.late) {
        alert = { created: false, alertId: null, jobs: 0, reason: `announcement is ${Math.round(ageHours)}h old (limit ${cfg.alertMaxAgeHours}h); pass late=true to alert anyway` };
      } else {
        alert = await createAlert(db, req.event, 'reset', now, now);
      }
    }
  } else if (req.mode === 'correct' && req.alertPolicy === 'correction') {
    alert = await createAlert(db, req.event, 'correction', now, now);
  } else {
    alert = { created: false, alertId: null, jobs: 0, reason: req.mode === 'backfill' ? 'backfill never alerts' : 'silent publication' };
  }

  return c.json({
    ok: true,
    eventId: req.eventId,
    revision: req.event.revision,
    contentHash: deployedHash,
    recorded,
    alreadyRecorded: !recorded,
    mode: req.mode,
    alertPolicy: req.alertPolicy,
    alert,
    activeSubscriptions: await countActiveSubscriptions(db),
    alertsPaused: cfg.alertsPaused,
    browserAlertsEnabled: cfg.browserAlerts.enabled,
  });
});

admin.get('/ledger', async (c) => {
  const db = c.env.DB;
  const publications = await db.prepare('SELECT event_id, revision, content_hash, mode, alert_policy, event_status, published_at FROM publications ORDER BY id').all();
  const alerts = await db.prepare('SELECT id, event_id, alert_revision, kind, cutoff_at, created_at FROM alerts ORDER BY id').all();
  const jobs = await db.prepare('SELECT status, COUNT(*) AS n FROM push_jobs GROUP BY status').all<{ status: string; n: number }>();
  const recent = await db
    .prepare('SELECT id, alert_id, status, attempts, next_attempt_at, last_error, created_at, sent_at FROM push_jobs ORDER BY id DESC LIMIT 50')
    .all();
  return c.json({
    publications: publications.results,
    alerts: alerts.results,
    jobs: Object.fromEntries((jobs.results ?? []).map((r) => [r.status, r.n])),
    recentJobs: recent.results,
    activeSubscriptions: await countActiveSubscriptions(db),
    contentRevision: loadContent().revision,
  });
});

admin.post('/drain', async (c) => {
  const result = await drainPushJobs(c.env, { limit: 50 });
  return c.json(result);
});
