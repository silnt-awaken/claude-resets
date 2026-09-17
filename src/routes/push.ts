import { Hono } from 'hono';
import { siteConfig, type Env } from '../env';
import { deactivateSubscription, isSubscriptionActive, upsertSubscription, validateSubscription } from '../push/subscriptions';
import { clientIp, problem, readJson } from '../util/http';
import { rateLimit } from '../util/ratelimit';

export const push = new Hono<{ Bindings: Env }>();

push.use('*', async (c, next) => {
  const rl = rateLimit(`push:${clientIp(c)}`, 30, 60_000);
  if (!rl.allowed) return problem(c, 429, 'rate_limited', 'Too many requests. Please slow down.', { retryAfter: rl.retryAfterSeconds });
  c.header('cache-control', 'no-store');
  await next();
});

push.post('/subscriptions', async (c) => {
  const cfg = siteConfig(c.env);
  if (!cfg.browserAlerts.enabled) return problem(c, 503, 'push_unavailable', 'Browser alerts are not available yet.');
  const body = await readJson(c, 8192);
  if (!body.ok) return problem(c, body.error === 'payload too large' ? 413 : 400, 'invalid_body', body.error);
  const input = body.value as Record<string, unknown>;
  const validation = validateSubscription(input.subscription ?? input, input.locale);
  if (!validation.ok) return problem(c, 400, 'invalid_subscription', validation.error, { parameter: 'subscription' });
  try {
    const now = new Date();
    const stored = await upsertSubscription(c.env.DB, validation.subscription, now);
    const previous = typeof input.previousEndpoint === 'string' ? input.previousEndpoint : null;
    if (previous && previous !== stored.endpoint) await deactivateSubscription(c.env.DB, previous, now, 'replaced by pushsubscriptionchange');
    return c.json({ id: stored.id, active: true }, 201);
  } catch (err) {
    console.error('subscription store failed', err);
    return problem(c, 503, 'push_unavailable', 'Could not store the subscription right now.');
  }
});

push.post('/subscriptions/check', async (c) => {
  const body = await readJson(c, 4096);
  if (!body.ok) return problem(c, 400, 'invalid_body', body.error);
  const endpoint = (body.value as Record<string, unknown>).endpoint;
  if (typeof endpoint !== 'string' || endpoint.length > 2048) return problem(c, 400, 'invalid_body', 'endpoint required', { parameter: 'endpoint' });
  try {
    return c.json({ active: await isSubscriptionActive(c.env.DB, endpoint) });
  } catch (err) {
    console.error('subscription check failed', err);
    return problem(c, 503, 'push_unavailable', 'Could not check the subscription right now.');
  }
});

push.delete('/subscriptions', async (c) => {
  const body = await readJson(c, 4096);
  if (!body.ok) return problem(c, 400, 'invalid_body', body.error);
  const endpoint = (body.value as Record<string, unknown>).endpoint;
  if (typeof endpoint !== 'string' || endpoint.length > 2048) return problem(c, 400, 'invalid_body', 'endpoint required', { parameter: 'endpoint' });
  try {
    const removed = await deactivateSubscription(c.env.DB, endpoint, new Date());
    return c.json({ removed });
  } catch (err) {
    console.error('unsubscribe failed', err);
    return problem(c, 503, 'push_unavailable', 'Could not remove the subscription right now.');
  }
});
