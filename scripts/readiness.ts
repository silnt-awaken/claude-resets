// npm run readiness — maintainer readiness report from wrangler.jsonc vars + .dev.vars.
// Values of secrets are never printed.

import { readiness, type ConfigVars } from '../src/config';
import { readDevVars, readWranglerVars } from './lib';

const vars = { ...readWranglerVars(), ...readDevVars(), ...process.env } as ConfigVars;
const report = readiness(vars, true);
const icon = { ok: '✔', off: '○', missing: '✖', invalid: '✖' } as const;
for (const item of report.items) {
  console.log(`${icon[item.status]} ${item.key.padEnd(24)} ${item.status.padEnd(8)} ${item.message}`);
}
console.log(report.ok ? '\nReady: no missing or invalid required settings.' : '\nNot ready: fix the ✖ items above before launch. Optional (○) items can stay off.');
process.exit(report.ok ? 0 : 1);
