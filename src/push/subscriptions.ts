// Push subscription validation and storage.

import { isLocale } from '../i18n';
import type { Locale } from '../domain/types';

export interface StoredSubscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  locale: Locale;
}

/** Push services this deployment will send to. Anything else is rejected at subscription time. */
export const ALLOWED_PUSH_HOST_SUFFIXES = [
  'fcm.googleapis.com',
  'android.googleapis.com',
  'updates.push.services.mozilla.com',
  'push.services.mozilla.com',
  'web.push.apple.com',
  'push.apple.com',
  'notify.windows.com',
  'push.samsungosp.com',
];

const B64URL = /^[A-Za-z0-9_-]+$/;

function b64urlLength(s: string): number {
  return Math.floor((s.replace(/=+$/, '').length * 3) / 4);
}

function isAllowedHost(host: string): boolean {
  return ALLOWED_PUSH_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

function isPrivateHost(host: string): boolean {
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return true; // any literal IPv4
  if (host.startsWith('[')) return true; // IPv6 literal
  return false;
}

export type SubscriptionValidation = { ok: true; subscription: Omit<StoredSubscription, 'id'> } | { ok: false; error: string };

export function validateSubscription(input: unknown, localeHint?: unknown): SubscriptionValidation {
  if (!input || typeof input !== 'object') return { ok: false, error: 'subscription must be an object' };
  const sub = input as Record<string, unknown>;
  const endpoint = typeof sub.endpoint === 'string' ? sub.endpoint : '';
  if (!endpoint || endpoint.length > 2048) return { ok: false, error: 'endpoint missing or too long' };
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return { ok: false, error: 'endpoint is not a valid URL' };
  }
  if (url.protocol !== 'https:') return { ok: false, error: 'endpoint must use https' };
  if (url.username || url.password) return { ok: false, error: 'endpoint must not contain credentials' };
  if (isPrivateHost(url.hostname) || !isAllowedHost(url.hostname)) return { ok: false, error: 'endpoint host is not a supported push service' };
  const keys = sub.keys && typeof sub.keys === 'object' ? (sub.keys as Record<string, unknown>) : null;
  const p256dh = keys && typeof keys.p256dh === 'string' ? keys.p256dh : '';
  const auth = keys && typeof keys.auth === 'string' ? keys.auth : '';
  if (!B64URL.test(p256dh) || b64urlLength(p256dh) !== 65) return { ok: false, error: 'keys.p256dh must be a base64url-encoded 65-byte P-256 public key' };
  if (!B64URL.test(auth) || b64urlLength(auth) !== 16) return { ok: false, error: 'keys.auth must be a base64url-encoded 16-byte secret' };
  const locale: Locale = isLocale(typeof localeHint === 'string' ? localeHint : undefined) ? (localeHint as Locale) : 'en';
  return { ok: true, subscription: { endpoint: url.toString(), p256dh, auth, locale } };
}

export async function subscriptionId(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function upsertSubscription(db: D1Database, sub: Omit<StoredSubscription, 'id'>, now: Date): Promise<StoredSubscription> {
  const id = await subscriptionId(sub.endpoint);
  await db
    .prepare(
      `INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, locale, created_at, active, revoked_at, last_error)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, NULL, NULL)
       ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, locale = excluded.locale,
         active = 1, revoked_at = NULL, last_error = NULL,
         created_at = CASE WHEN push_subscriptions.active = 1 THEN push_subscriptions.created_at ELSE excluded.created_at END`,
    )
    .bind(id, sub.endpoint, sub.p256dh, sub.auth, sub.locale, now.toISOString())
    .run();
  return { id, ...sub };
}

export async function deactivateSubscription(db: D1Database, endpoint: string, now: Date, reason = 'unsubscribed'): Promise<boolean> {
  const res = await db
    .prepare('UPDATE push_subscriptions SET active = 0, revoked_at = ?1, last_error = ?2 WHERE endpoint = ?3 AND active = 1')
    .bind(now.toISOString(), reason, endpoint)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function deactivateSubscriptionById(db: D1Database, id: string, now: Date, reason: string): Promise<void> {
  await db.prepare('UPDATE push_subscriptions SET active = 0, revoked_at = ?1, last_error = ?2 WHERE id = ?3').bind(now.toISOString(), reason, id).run();
}

export async function isSubscriptionActive(db: D1Database, endpoint: string): Promise<boolean> {
  const row = await db.prepare('SELECT active FROM push_subscriptions WHERE endpoint = ?1').bind(endpoint).first<{ active: number }>();
  return !!row && row.active === 1;
}

export async function countActiveSubscriptions(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE active = 1').first<{ n: number }>();
  return row?.n ?? 0;
}
