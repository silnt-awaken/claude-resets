// Shared helpers for the editorial commands. Node-only (tsx).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { validateContent } from '../src/domain/schema';
import type { ResearchCandidate, ResetEvent, ReviewState, Sponsor, SourceAccount } from '../src/domain/types';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
export const CONTENT_DIR = path.join(ROOT, 'content');

export interface ContentFiles {
  events: ResetEvent[];
  sources: SourceAccount[];
  sponsors: Sponsor[];
  research: ResearchCandidate[];
  review: ReviewState;
}

export function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

export function writeJson(file: string, value: unknown): void {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function readContent(): ContentFiles {
  return {
    events: readJson(path.join(CONTENT_DIR, 'resets.json')),
    sources: readJson(path.join(CONTENT_DIR, 'sources.json')),
    sponsors: readJson(path.join(CONTENT_DIR, 'sponsors.json')),
    research: readJson(path.join(CONTENT_DIR, 'research-queue.json')),
    review: readJson(path.join(CONTENT_DIR, 'review.json')),
  };
}

export function writeEvents(events: ResetEvent[]): void {
  writeJson(path.join(CONTENT_DIR, 'resets.json'), events);
}

export function validateFiles(files: ContentFiles) {
  return validateContent(files);
}

/** Minimal argv parser: --key value, --flag, positional. */
export function parseArgs(argv: string[]): { flags: Record<string, string | true>; positional: string[] } {
  const flags: Record<string, string | true> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const eq = key.indexOf('=');
      if (eq >= 0) flags[key.slice(0, eq)] = key.slice(eq + 1);
      else if (i + 1 < argv.length && !argv[i + 1]!.startsWith('--')) flags[key] = argv[++i]!;
      else flags[key] = true;
    } else positional.push(a);
  }
  return { flags, positional };
}

export function flagString(flags: Record<string, string | true>, key: string): string | undefined {
  const v = flags[key];
  return typeof v === 'string' ? v : undefined;
}

/** Read KEY=VALUE pairs from .dev.vars (local secrets). */
export function readDevVars(): Record<string, string> {
  const file = path.join(ROOT, '.dev.vars');
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    out[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
  }
  return out;
}

/** Public vars from wrangler.jsonc (comments stripped). */
export function readWranglerVars(): Record<string, string> {
  // Strip whole-line `//` comments only, so `https://` inside string values survives.
  const raw = readFileSync(path.join(ROOT, 'wrangler.jsonc'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  const cfg = JSON.parse(raw) as { vars?: Record<string, string> };
  return cfg.vars ?? {};
}

export interface Target {
  name: 'local' | 'production';
  baseUrl: string;
  token: string | null;
}

/** Resolve the publication target. Local is the default; production must be requested explicitly. */
export function resolveTarget(flags: Record<string, string | true>): Target {
  const envName = flagString(flags, 'env') === 'production' ? 'production' : 'local';
  const dev = readDevVars();
  if (envName === 'local') {
    return { name: 'local', baseUrl: flagString(flags, 'url') ?? 'http://localhost:8787', token: process.env.CONTENT_PUBLISH_TOKEN ?? dev.CONTENT_PUBLISH_TOKEN ?? null };
  }
  const vars = readWranglerVars();
  return { name: 'production', baseUrl: flagString(flags, 'url') ?? vars.SITE_URL ?? '', token: process.env.CONTENT_PUBLISH_TOKEN ?? null };
}

export async function adminRequest(target: Target, pathName: string, init: RequestInit = {}): Promise<{ status: number; body: unknown }> {
  if (!target.token) throw new Error('CONTENT_PUBLISH_TOKEN is not set (put it in .dev.vars for local, or export it for production).');
  if (!target.baseUrl) throw new Error('No base URL. Set SITE_URL in wrangler.jsonc or pass --url.');
  const res = await fetch(`${target.baseUrl}${pathName}`, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${target.token}`, ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { status: res.status, body };
}

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Decode the creation time of an X post id (Snowflake, epoch 2010-11-04T01:42:54.657Z). */
export function decodeXPostTime(statusId: string): string | null {
  if (!/^\d{15,20}$/.test(statusId)) return null;
  const ms = (BigInt(statusId) >> 22n) + 1288834974657n;
  const d = new Date(Number(ms));
  return Number.isFinite(d.getTime()) ? d.toISOString().replace(/\.\d{3}Z$/, 'Z') : null;
}

export function parseXStatusUrl(url: string): { handle: string; id: string } | null {
  const m = url.match(/^https:\/\/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d{15,20})/);
  return m ? { handle: m[1]!, id: m[2]! } : null;
}

export function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}
