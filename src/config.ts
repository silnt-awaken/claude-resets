// Public site configuration parsed from plain string variables. No Worker types here so the
// maintainer scripts (Node) can reuse it. Bindings live in src/env.ts.

import { isSolanaAddress } from './goal/base58';
import { SOLANA } from './goal/solana';

export interface ConfigVars {
  SITE_NAME?: string;
  SITE_URL?: string;
  OWNER_NAME?: string;
  OWNER_X_URL?: string;
  PROJECT_X_URL?: string;
  REPO_URL?: string;
  SUPPORT_URL?: string;
  SUPPORT_CONTACT_EMAIL?: string;
  TELEGRAM_CHANNEL_URL?: string;
  BROWSER_ALERTS_ENABLED?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_SUBJECT?: string;
  ALERTS_PAUSED?: string;
  REACTION_COOLDOWN_HOURS?: string;
  ALERT_MAX_AGE_HOURS?: string;
  // community goal: USDC on Solana, sent to the operator's wallet; the draw is automatic
  GOAL_ENABLED?: string;
  /** Comma-separated Solana JSON-RPC endpoints, tried in order. */
  GOAL_SOLANA_RPC?: string;
  GOAL_EXPLORER_URL?: string;
  /** The operator's Solana wallet that receives contributions (base58). */
  GOAL_WALLET?: string;
  /** That wallet's USDC token account (the address transfers actually land in). */
  GOAL_USDC_ACCOUNT?: string;
  GOAL_USDC_MINT?: string;
  GOAL_TARGET_USD?: string;
  /** Comma-separated wallets excluded from the draw (the operator's). Their money still counts on the meter. */
  GOAL_EXCLUDED_WALLETS?: string;
  // secrets (values are never rendered)
  CONTENT_PUBLISH_TOKEN?: string;
  VAPID_PRIVATE_KEY?: string;
  REACTION_SECRET?: string;
  /** Optional keyed Solana RPC URL (e.g. a free Helius/QuickNode endpoint), tried before GOAL_SOLANA_RPC. Keep it a secret: the key is in the URL. */
  GOAL_SOLANA_RPC_PRIVATE?: string;
}

export interface SiteConfig {
  siteName: string;
  /** Origin without trailing slash, e.g. https://example.com */
  siteUrl: string;
  ownerName: string;
  ownerXUrl: string | null;
  projectXUrl: string | null;
  repoUrl: string | null;
  supportUrl: string | null;
  supportProvider: string | null;
  supportContactEmail: string | null;
  telegramChannelUrl: string | null;
  browserAlerts: { enabled: boolean; publicKey: string | null; reason: string | null };
  alertsPaused: boolean;
  goal: GoalConfig;
  reactionCooldownHours: number;
  alertMaxAgeHours: number;
  publishConfigured: boolean;
}

export interface GoalConfig {
  /** True only when GOAL_ENABLED is true and the wallet and its USDC account are valid Solana addresses. */
  live: boolean;
  /** Reason the goal is not live (shown only to maintainers). */
  reason: string | null;
  /** Comma-separated JSON-RPC endpoints, tried in order. */
  rpcUrl: string;
  explorerUrl: string;
  wallet: string | null;
  usdcAccount: string | null;
  usdcMint: string;
  targetUsd: number;
  /** Wallets that never win (always includes the operator's wallet). */
  excludedWallets: string[];
}

export function goalConfig(env: ConfigVars): GoalConfig {
  const wallet = isSolanaAddress(env.GOAL_WALLET?.trim()) ? env.GOAL_WALLET!.trim() : null;
  const usdcAccount = isSolanaAddress(env.GOAL_USDC_ACCOUNT?.trim()) ? env.GOAL_USDC_ACCOUNT!.trim() : null;
  const usdcMint = isSolanaAddress(env.GOAL_USDC_MINT?.trim()) ? env.GOAL_USDC_MINT!.trim() : SOLANA.usdcMint;
  const enabled = bool(env.GOAL_ENABLED);
  let reason: string | null = null;
  if (!enabled) reason = 'GOAL_ENABLED is not true';
  else if (!wallet) reason = 'GOAL_WALLET is missing or not a Solana address';
  else if (!usdcAccount) reason = 'GOAL_USDC_ACCOUNT is missing or not a Solana address';
  const rpcList = [env.GOAL_SOLANA_RPC_PRIVATE ?? '', ...(env.GOAL_SOLANA_RPC ?? '').split(',')].map((u) => httpsUrlOrNull(u.trim())).filter((u): u is string => !!u);
  const excluded = new Set((env.GOAL_EXCLUDED_WALLETS ?? '').split(',').map((a) => a.trim()).filter((a) => isSolanaAddress(a)));
  if (wallet) excluded.add(wallet);
  return {
    live: reason === null,
    reason,
    rpcUrl: rpcList.length ? rpcList.join(',') : SOLANA.rpc,
    explorerUrl: httpsUrlOrNull(env.GOAL_EXPLORER_URL)?.replace(/\/$/, '') ?? SOLANA.explorer,
    wallet,
    usdcAccount,
    usdcMint,
    targetUsd: positiveNumber(env.GOAL_TARGET_USD, 200),
    excludedWallets: [...excluded],
  };
}

const KNOWN_PROVIDERS: Array<[RegExp, string]> = [
  [/(^|\.)buymeacoffee\.com$/i, 'Buy Me a Coffee'],
  [/(^|\.)ko-fi\.com$/i, 'Ko-fi'],
  [/(^|\.)github\.com$/i, 'GitHub Sponsors'],
  [/(^|\.)patreon\.com$/i, 'Patreon'],
  [/(^|\.)paypal\.com$/i, 'PayPal'],
  [/(^|\.)paypal\.me$/i, 'PayPal'],
  [/(^|\.)liberapay\.com$/i, 'Liberapay'],
  [/(^|\.)opencollective\.com$/i, 'Open Collective'],
];

export function httpsUrlOrNull(value: string | undefined | null): string | null {
  if (!value) return null;
  try {
    const u = new URL(value.trim());
    if (u.protocol !== 'https:') return null;
    if (!u.hostname.includes('.')) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function supportProviderFor(url: string | null): string | null {
  if (!url) return null;
  const host = new URL(url).hostname;
  for (const [re, name] of KNOWN_PROVIDERS) if (re.test(host)) return name;
  return null;
}

function bool(value: string | undefined, fallback = false): boolean {
  if (value == null || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function siteConfig(env: ConfigVars): SiteConfig {
  const rawSiteUrl = env.SITE_URL?.trim() || 'http://localhost:8787';
  let siteUrl = 'http://localhost:8787';
  try {
    siteUrl = new URL(rawSiteUrl).origin;
  } catch {
    // keep the localhost fallback; readiness reports the problem
  }
  const supportUrl = httpsUrlOrNull(env.SUPPORT_URL);
  const publicKey = env.VAPID_PUBLIC_KEY?.trim() || null;
  const wantPush = bool(env.BROWSER_ALERTS_ENABLED);
  let pushReason: string | null = null;
  if (!wantPush) pushReason = 'BROWSER_ALERTS_ENABLED is not true';
  else if (!publicKey) pushReason = 'VAPID_PUBLIC_KEY is missing';
  else if (!env.VAPID_PRIVATE_KEY) pushReason = 'VAPID_PRIVATE_KEY secret is missing';
  else if (!env.VAPID_SUBJECT) pushReason = 'VAPID_SUBJECT is missing';

  return {
    siteName: env.SITE_NAME?.trim() || 'Claude Resets',
    siteUrl,
    ownerName: env.OWNER_NAME?.trim() || 'Mike',
    ownerXUrl: httpsUrlOrNull(env.OWNER_X_URL),
    projectXUrl: httpsUrlOrNull(env.PROJECT_X_URL),
    repoUrl: httpsUrlOrNull(env.REPO_URL),
    supportUrl,
    supportProvider: supportProviderFor(supportUrl),
    supportContactEmail: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.SUPPORT_CONTACT_EMAIL ?? '') ? env.SUPPORT_CONTACT_EMAIL!.trim() : null,
    telegramChannelUrl: httpsUrlOrNull(env.TELEGRAM_CHANNEL_URL),
    browserAlerts: { enabled: pushReason === null, publicKey: pushReason === null ? publicKey : null, reason: pushReason },
    alertsPaused: bool(env.ALERTS_PAUSED),
    goal: goalConfig(env),
    reactionCooldownHours: positiveNumber(env.REACTION_COOLDOWN_HOURS, 24),
    alertMaxAgeHours: positiveNumber(env.ALERT_MAX_AGE_HOURS, 72),
    publishConfigured: !!env.CONTENT_PUBLISH_TOKEN && env.CONTENT_PUBLISH_TOKEN.length >= 16,
  };
}

export interface ReadinessItem {
  key: string;
  status: 'ok' | 'missing' | 'invalid' | 'off';
  message: string;
  secret: boolean;
}

/** Maintainer readiness report. Never includes secret values. */
export function readiness(env: ConfigVars, hasDb: boolean): { ok: boolean; items: ReadinessItem[] } {
  const items: ReadinessItem[] = [];
  const cfg = siteConfig(env);
  const add = (key: string, status: ReadinessItem['status'], message: string, secret = false) => items.push({ key, status, message, secret });
  const httpsSite = /^https:\/\//.test(cfg.siteUrl);

  add('SITE_URL', httpsSite ? 'ok' : 'invalid', httpsSite ? cfg.siteUrl : `Using ${cfg.siteUrl}; set the real https origin before launch.`);
  add('SITE_NAME', 'ok', cfg.siteName);
  add('OWNER_NAME', 'ok', cfg.ownerName);
  add('SUPPORT_URL', cfg.supportUrl ? 'ok' : env.SUPPORT_URL ? 'invalid' : 'missing', cfg.supportUrl ? `${cfg.supportUrl}${cfg.supportProvider ? ` (${cfg.supportProvider})` : ''}` : 'Set your existing https coffee/support page; every Tip for coffee link depends on it.');
  add('OWNER_X_URL', cfg.ownerXUrl ? 'ok' : env.OWNER_X_URL ? 'invalid' : 'off', cfg.ownerXUrl ?? 'Optional owner X link not shown.');
  add('PROJECT_X_URL', cfg.projectXUrl ? 'ok' : env.PROJECT_X_URL ? 'invalid' : 'off', cfg.projectXUrl ?? 'Optional project X link not shown in the header.');
  add('REPO_URL', cfg.repoUrl ? 'ok' : env.REPO_URL ? 'invalid' : 'off', cfg.repoUrl ?? 'Optional source-code link not shown.');
  add('SUPPORT_CONTACT_EMAIL', cfg.supportContactEmail ? 'ok' : env.SUPPORT_CONTACT_EMAIL ? 'invalid' : 'off', cfg.supportContactEmail ?? 'Optional sponsorship contact not shown.');
  add('TELEGRAM_CHANNEL_URL', cfg.telegramChannelUrl ? 'ok' : env.TELEGRAM_CHANNEL_URL ? 'invalid' : 'off', cfg.telegramChannelUrl ?? 'Telegram pill shows an unavailable state.');
  add('BROWSER_ALERTS', cfg.browserAlerts.enabled ? 'ok' : 'off', cfg.browserAlerts.enabled ? 'Web Push configured.' : `Browser alerts unavailable: ${cfg.browserAlerts.reason}.`);
  add('VAPID_PRIVATE_KEY', env.VAPID_PRIVATE_KEY ? 'ok' : 'off', env.VAPID_PRIVATE_KEY ? 'present' : 'absent (needed only for browser alerts)', true);
  add('CONTENT_PUBLISH_TOKEN', cfg.publishConfigured ? 'ok' : 'missing', cfg.publishConfigured ? 'present' : 'absent or shorter than 16 characters; publication endpoint disabled.', true);
  add('REACTION_SECRET', env.REACTION_SECRET ? 'ok' : 'missing', env.REACTION_SECRET ? 'present' : 'absent; reactions disabled.', true);
  add('ALERTS_PAUSED', cfg.alertsPaused ? 'off' : 'ok', cfg.alertsPaused ? 'Delivery paused.' : 'Delivery active.');
  add('GOAL_SOLANA_RPC_PRIVATE', httpsUrlOrNull(env.GOAL_SOLANA_RPC_PRIVATE) ? 'ok' : 'off', httpsUrlOrNull(env.GOAL_SOLANA_RPC_PRIVATE) ? 'present; tried before the public endpoints' : 'absent; only the public GOAL_SOLANA_RPC endpoints are used', true);
  add('GOAL', cfg.goal.live ? 'ok' : 'off', cfg.goal.live ? `Live: USDC on Solana to ${cfg.goal.wallet} (token account ${cfg.goal.usdcAccount}), target $${cfg.goal.targetUsd}.` : `Community goal shown as "not open yet": ${cfg.goal.reason}.`);
  add('DB', hasDb ? 'ok' : 'missing', hasDb ? 'D1 bound.' : 'D1 binding missing.');

  const ok = items.every((i) => i.status === 'ok' || i.status === 'off');
  return { ok, items };
}
