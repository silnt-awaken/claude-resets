// npm run goal:round -- status                        public status JSON (round, meter, draw list)
// npm run goal:round -- paid --tx <signature>         record the USDC payout you sent to the winner
// npm run goal:round -- cancel --note "..."           cancel the open/frozen round; its contributions roll over
// npm run goal:round -- tick                          run the cron step now (sync, freeze, draw, open)
// npm run goal:round -- open [--title "..."] [--target 200]   open a round by hand (the cron does this itself)
// Add --env production --yes to act on the live site. Opening, freezing and drawing are automatic;
// the only manual step is paying the winner from the goal wallet and recording the signature.

import { adminRequest, fail, flagString, parseArgs, resolveTarget } from '../lib';

const { flags, positional } = parseArgs(process.argv.slice(2));
const action = positional[0] ?? 'status';
const target = resolveTarget(flags);
if (target.name === 'production' && flags.yes !== true && action !== 'status') {
  console.log(`About to run "${action}" on PRODUCTION (${target.baseUrl}). Re-run with --yes to confirm.`);
  process.exit(2);
}

if (action === 'status') {
  const status = (await (await fetch(`${target.baseUrl}/api/v1/goal`)).json()) as Record<string, unknown>;
  const contributors = (await (await fetch(`${target.baseUrl}/api/v1/goal/contributors`)).json()) as Record<string, unknown>;
  console.log(JSON.stringify({ ...status, draw_list: contributors }, null, 2));
  const round = status.round as { status: string; winner_wallet: string | null; target_usd: number } | null;
  if (round?.status === 'drawn') {
    console.log(`\nRound is drawn. Send ${round.target_usd} USDC from the goal wallet to ${round.winner_wallet}, then run:\n  npm run goal:round -- paid --tx <signature>${target.name === 'production' ? ' --env production --yes' : ''}`);
  }
  process.exit(0);
}

const body: Record<string, unknown> = { action };
if (action === 'open') {
  if (flagString(flags, 'title')) body.title = flagString(flags, 'title');
  if (flagString(flags, 'target')) body.targetUsd = Number(flagString(flags, 'target'));
}
if (action === 'paid') body.tx = flagString(flags, 'tx') ?? fail('--tx <signature> is required');
if (action === 'cancel') body.note = flagString(flags, 'note') ?? 'cancelled';
if (!['open', 'paid', 'cancel', 'tick'].includes(action)) fail(`unknown action ${action}; use status, paid, cancel, tick or open`);

const res = await adminRequest(target, '/admin/goal/rounds', { method: 'POST', body: JSON.stringify(body) });
console.log(`${action} → ${res.status}`);
console.log(typeof res.body === 'string' ? res.body : JSON.stringify(res.body, null, 2));
if (res.status >= 300) process.exit(1);
