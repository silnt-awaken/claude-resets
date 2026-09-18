// npm run goal:round -- open [--title "..."] [--target 200]   open a round (entries start)
// npm run goal:round -- status                                 show pool, entries, round state
// npm run goal:round -- freeze [--blocks 600]                  close entries, announce the draw block
// npm run goal:round -- draw                                   read the draw block hash, pick the winner
// npm run goal:round -- paid --tx 0x…                          record the payout transaction
// npm run goal:round -- cancel --note "..."
// Add --env production --yes to act on the live site. Money moves only when YOU send the payout
// from the pool wallet; this command never holds keys.

import { adminRequest, fail, flagString, parseArgs, resolveTarget } from '../lib';

const { flags, positional } = parseArgs(process.argv.slice(2));
const action = positional[0] ?? 'status';
const target = resolveTarget(flags);
if (target.name === 'production' && flags.yes !== true && action !== 'status') {
  console.log(`About to run "${action}" on PRODUCTION (${target.baseUrl}). Re-run with --yes to confirm.`);
  process.exit(2);
}

if (action === 'status') {
  const res = await fetch(`${target.baseUrl}/api/v1/goal`);
  const s = (await res.json()) as Record<string, unknown>;
  console.log(JSON.stringify(s, null, 2));
  process.exit(0);
}

const body: Record<string, unknown> = { action };
if (action === 'open') {
  if (flagString(flags, 'title')) body.title = flagString(flags, 'title');
  if (flagString(flags, 'target')) body.targetUsd = Number(flagString(flags, 'target'));
}
if (action === 'freeze' && flagString(flags, 'blocks')) body.blocksAhead = Number(flagString(flags, 'blocks'));
if (action === 'paid') body.tx = flagString(flags, 'tx') ?? fail('--tx <hash> is required');
if (action === 'cancel') body.note = flagString(flags, 'note') ?? 'cancelled';

const res = await adminRequest(target, '/admin/goal/rounds', { method: 'POST', body: JSON.stringify(body) });
console.log(`${action} → ${res.status}`);
console.log(typeof res.body === 'string' ? res.body : JSON.stringify(res.body, null, 2));
if (res.status >= 300) process.exit(1);
if (action === 'draw') {
  const r = res.body as { winner: string; winnerIdentity: string; kind: string; drawBlock: number; drawHash: string };
  console.log(`\nWinner: ${r.winner} (${r.kind}). Send the prize in USDG from the pool wallet to ${r.kind === 'wallet' ? r.winnerIdentity : 'the wallet they provide by DM'}, then run: npm run goal:round -- paid --tx <hash>${target.name === 'production' ? ' --env production --yes' : ''}`);
  console.log(`Publish the draw: block ${r.drawBlock}, hash ${r.drawHash}, winner index = hash mod entries.`);
}
