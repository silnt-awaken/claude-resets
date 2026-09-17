// npm run outbox -- [--env production] [--drain]
// Shows the publication ledger, alerts and push job states. --drain triggers one delivery
// batch (the same code the cron trigger runs). Subscriber endpoints are never printed.

import { adminRequest, flagString, parseArgs, resolveTarget } from './lib';

const { flags } = parseArgs(process.argv.slice(2));
const target = resolveTarget(flags);

if (flags.drain === true) {
  const res = await adminRequest(target, '/admin/drain', { method: 'POST', body: '{}' });
  console.log(`drain (${res.status}):`, JSON.stringify(res.body));
}

const res = await adminRequest(target, '/admin/ledger');
if (res.status !== 200) {
  console.error(`ledger request failed (${res.status})`, res.body);
  process.exit(1);
}
const ledger = res.body as {
  publications: Array<{ event_id: string; revision: number; mode: string; alert_policy: string; published_at: string }>;
  alerts: Array<{ id: number; event_id: string; alert_revision: number; kind: string; cutoff_at: string; created_at: string }>;
  jobs: Record<string, number>;
  recentJobs: Array<{ id: number; alert_id: number; status: string; attempts: number; next_attempt_at: string; last_error: string | null; sent_at: string | null }>;
  activeSubscriptions: number;
  contentRevision: string;
};
console.log(`Target ${target.name} (${target.baseUrl}) · content revision ${ledger.contentRevision} · active subscriptions ${ledger.activeSubscriptions}`);
console.log('\nPublications:');
for (const p of ledger.publications) console.log(`  ${p.published_at}  ${p.event_id}  r${p.revision}  ${p.mode}/${p.alert_policy}`);
if (!ledger.publications.length) console.log('  (none)');
console.log('\nAlerts:');
for (const a of ledger.alerts) console.log(`  #${a.id}  ${a.created_at}  ${a.event_id}  ${a.kind}  alertRev ${a.alert_revision}  cutoff ${a.cutoff_at}`);
if (!ledger.alerts.length) console.log('  (none)');
console.log('\nJobs by status:', JSON.stringify(ledger.jobs));
console.log('\nRecent jobs:');
for (const j of ledger.recentJobs.slice(0, 20)) console.log(`  #${j.id} alert ${j.alert_id} ${j.status} attempts=${j.attempts} next=${j.next_attempt_at} sent=${j.sent_at ?? '—'} ${j.last_error ? `error="${j.last_error}"` : ''}`);
if (!ledger.recentJobs.length) console.log('  (none)');
void flagString;
