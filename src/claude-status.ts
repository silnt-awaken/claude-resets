import { z } from 'zod';

export const CLAUDE_STATUS_SOURCE = 'https://status.claude.com/api/v2/summary.json';
export const CLAUDE_STATUS_CACHE = 'https://clauderesets.com/__cache/claude-status-v1';
export const CLAUDE_STATUS_TTL = 60;

const summarySchema = z.object({
  page: z.object({ updated_at: z.string().datetime({ offset: true }) }),
  status: z.object({ indicator: z.string() }),
  components: z.array(z.object({ id: z.string(), status: z.string() })).min(1),
  incidents: z.array(z.object({ name: z.string().min(1).max(500), status: z.string(), shortlink: z.string().optional() })),
});

const services = [
  { id: 'rwppv331jlwc', key: 'claude' },
  { id: 'yyzkbfz2thpt', key: 'code' },
  { id: 'k8w3r06qmzrp', key: 'api' },
] as const;
const states = ['operational', 'degraded_performance', 'partial_outage', 'major_outage', 'under_maintenance'] as const;
export type ServiceState = typeof states[number] | 'unknown';
export type OverallState = 'operational' | 'issues' | 'maintenance' | 'unknown';
export interface ClaudeServiceStatus {
  state: OverallState;
  checked_at: string;
  source_updated_at: string;
  source_url: string;
  services: { key: typeof services[number]['key']; state: ServiceState }[];
  incidents: { title: string; url: string }[];
}

export function summarizeClaudeStatus(input: unknown, now = new Date()): ClaudeServiceStatus {
  const summary = summarySchema.parse(input);
  const componentStates = summary.components.map(({ status }) => states.includes(status as typeof states[number]) ? status as ServiceState : 'unknown');
  const active = summary.incidents.filter(({ status }) => !['resolved', 'postmortem'].includes(status));
  const issues = ['minor', 'major', 'critical'].includes(summary.status.indicator)
    || componentStates.some((state) => ['degraded_performance', 'partial_outage', 'major_outage'].includes(state)) || active.length > 0;
  const maintenance = summary.status.indicator === 'maintenance' || componentStates.includes('under_maintenance');
  const selected = services.map(({ id, key }) => ({ key, state: componentStates[summary.components.findIndex((component) => component.id === id)] ?? 'unknown' }));
  const unknown = componentStates.includes('unknown') || selected.some(({ state }) => state === 'unknown')
    || !['none', 'minor', 'major', 'critical', 'maintenance'].includes(summary.status.indicator);
  return {
    state: issues ? 'issues' : maintenance ? 'maintenance' : unknown ? 'unknown' : 'operational',
    checked_at: now.toISOString(),
    source_updated_at: summary.page.updated_at,
    source_url: 'https://status.claude.com/',
    services: selected,
    // Always link to the official page. Provider content is text, never HTML or an arbitrary URL.
    incidents: active.slice(0, 3).map(({ name }) => ({ title: name, url: 'https://status.claude.com/' })),
  };
}

/** A fixed upstream and short edge cache keep visitors' requests private and bounded. */
export async function fetchClaudeStatus(): Promise<ClaudeServiceStatus> {
  const response = await fetch(CLAUDE_STATUS_SOURCE, {
    headers: { accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(4000),
  });
  if (!response.ok) throw new Error('Claude status feed unavailable');
  return summarizeClaudeStatus(await response.json());
}
