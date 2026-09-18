import { en, type Dict } from './en';
import { zhCN } from './zh-CN';
import { zhTW } from './zh-TW';
import { ja } from './ja';
import { ko } from './ko';
import { LOCALES, type Locale } from '../domain/types';

export type { Dict } from './en';
export { LOCALES } from '../domain/types';
export type { Locale } from '../domain/types';

export const dictionaries: Record<Locale, Dict> = { en, 'zh-CN': zhCN, 'zh-TW': zhTW, ja, ko };

export function isLocale(value: string | undefined | null): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}

export function dict(locale: Locale): Dict {
  return dictionaries[locale];
}

/** URL prefix for a locale: '' for English, '/zh-CN' etc. otherwise. */
export function localePrefix(locale: Locale): string {
  return locale === 'en' ? '' : `/${locale}`;
}

/** Prefix an app path ('/', '/sources', '/resets/x') with the locale segment. */
export function localizePath(locale: Locale, path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  if (locale === 'en') return p;
  return p === '/' ? `/${locale}` : `/${locale}${p}`;
}

/** Split an incoming pathname into locale and locale-free path. */
export function stripLocale(pathname: string): { locale: Locale; path: string } {
  const m = pathname.match(/^\/(zh-CN|zh-TW|ja|ko)(\/.*)?$/);
  if (m && isLocale(m[1])) return { locale: m[1], path: m[2] && m[2] !== '/' ? m[2] : '/' };
  return { locale: 'en', path: pathname || '/' };
}

/** Replace {name} placeholders. Missing values are left visible so they show up in tests. */
export function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) => (key in vars ? String(vars[key]) : m));
}

export function intlLocale(locale: Locale): string {
  switch (locale) {
    case 'en':
      return 'en-US';
    case 'zh-CN':
      return 'zh-CN';
    case 'zh-TW':
      return 'zh-TW';
    case 'ja':
      return 'ja-JP';
    case 'ko':
      return 'ko-KR';
  }
}

export function ogLocale(locale: Locale): string {
  switch (locale) {
    case 'en':
      return 'en_US';
    case 'zh-CN':
      return 'zh_CN';
    case 'zh-TW':
      return 'zh_TW';
    case 'ja':
      return 'ja_JP';
    case 'ko':
      return 'ko_KR';
  }
}

/** "Sep 4, 2026, 20:08 UTC" style, always UTC (the client rewrites to local time when JS runs). */
export function formatUtcDateTime(iso: string, locale: Locale): string {
  const d = new Date(iso);
  const s = new Intl.DateTimeFormat(intlLocale(locale), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).format(d);
  return `${s} UTC`;
}

/** Calendar date without time, rendered in UTC so a date-only record never shifts. */
export function formatDate(day: string, locale: Locale): string {
  const d = new Date(`${day}T00:00:00Z`);
  return new Intl.DateTimeFormat(intlLocale(locale), { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(d);
}

export function formatMonthYear(year: number, month: number, locale: Locale): string {
  const d = new Date(Date.UTC(year, month - 1, 1));
  return new Intl.DateTimeFormat(intlLocale(locale), { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(d);
}

/** Relative age like "5 days ago", localized. */
export function formatRelative(ms: number, locale: Locale): string {
  const rtf = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: 'always' });
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return rtf.format(-s, 'second');
  const m = Math.floor(s / 60);
  if (m < 60) return rtf.format(-m, 'minute');
  const h = Math.floor(m / 60);
  if (h < 24) return rtf.format(-h, 'hour');
  const d = Math.floor(h / 24);
  if (d < 7) return rtf.format(-d, 'day');
  if (d < 30) return rtf.format(-Math.floor(d / 7), 'week');
  if (d < 365) return rtf.format(-Math.floor(d / 30), 'month');
  return rtf.format(-Math.floor(d / 365), 'year');
}

/** Relative age for a date-only record, at day granularity (never invents hours or minutes). */
export function formatRelativeDays(day: string, now: Date, locale: Locale): string {
  const rtf = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: 'always' });
  const today = now.toISOString().slice(0, 10);
  const days = Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000));
  if (days < 7) return rtf.format(-days, 'day');
  if (days < 30) return rtf.format(-Math.floor(days / 7), 'week');
  if (days < 365) return rtf.format(-Math.floor(days / 30), 'month');
  return rtf.format(-Math.floor(days / 365), 'year');
}

export function formatNumber(n: number, locale: Locale): string {
  return new Intl.NumberFormat(intlLocale(locale)).format(n);
}
