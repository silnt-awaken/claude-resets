import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { siteConfig, type Env } from '../env';
import { REACTION_COOKIE, currentReactionEventId, mintIdentity, react, readReactionState, verifyIdentity } from '../reactions';
import { clientIp, problem, readJson } from '../util/http';
import { rateLimit } from '../util/ratelimit';

export const reactions = new Hono<{ Bindings: Env }>();

reactions.get('/', async (c) => {
  try {
    const state = await readReactionState(c.env.DB, currentReactionEventId());
    return c.json(state, 200, { 'cache-control': 'no-store' });
  } catch (err) {
    console.error('reaction count unavailable', err);
    return problem(c, 503, 'reactions_unavailable', 'Reactions are unavailable right now.');
  }
});

reactions.post('/beg', async (c) => {
  const secret = c.env.REACTION_SECRET;
  if (!secret || secret.length < 8) return problem(c, 503, 'reactions_unavailable', 'Reactions are not configured.');
  const rl = rateLimit(`beg:${clientIp(c)}`, 20, 60_000);
  if (!rl.allowed) return problem(c, 429, 'rate_limited', 'Too many requests. Please slow down.', { retryAfter: rl.retryAfterSeconds });
  const cfg = siteConfig(c.env);
  const eventId = currentReactionEventId();
  if (!eventId) return problem(c, 409, 'no_reset', 'There is no published reset to react to.');
  const body = await readJson(c, 2048);
  if (!body.ok || !body.value || typeof body.value !== 'object' || Array.isArray(body.value)) return problem(c, 400, 'invalid_body', 'Expected a JSON object.');
  const suppliedId = (body.value as Record<string, unknown>).eventId;
  if (suppliedId !== undefined && suppliedId !== eventId) return problem(c, 409, 'reset_changed', 'A new reset is on the board. Refresh before reacting.');
  let identity = await verifyIdentity(secret, getCookie(c, REACTION_COOKIE));
  if (!identity) {
    identity = await mintIdentity(secret);
    setCookie(c, REACTION_COOKIE, identity, {
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      secure: cfg.siteUrl.startsWith('https://'),
      maxAge: 60 * 60 * 24 * 400,
    });
  }
  try {
    const outcome = await react(c.env.DB, eventId, identity, cfg.reactionCooldownHours, new Date());
    if (!outcome.accepted) {
      const retry = outcome.cooldownUntil ? Math.max(1, (Date.parse(outcome.cooldownUntil) - Date.now()) / 1000) : 60;
      c.header('retry-after', String(Math.ceil(retry)));
      return c.json({ eventId, accepted: false, count: outcome.count, cooldownUntil: outcome.cooldownUntil }, 429, { 'cache-control': 'no-store' });
    }
    return c.json({ eventId, accepted: true, count: outcome.count, cooldownUntil: outcome.cooldownUntil }, 200, { 'cache-control': 'no-store' });
  } catch (err) {
    console.error('reaction failed', err);
    return problem(c, 503, 'reactions_unavailable', 'Reactions are unavailable right now.');
  }
});
