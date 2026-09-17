// Worker bindings. Public settings come from wrangler.jsonc `vars`; secrets from .dev.vars / `wrangler secret`.

import type { ConfigVars } from './config';

export interface Env extends ConfigVars {
  DB: D1Database;
  ASSETS: Fetcher;
}

export { siteConfig, readiness, httpsUrlOrNull, supportProviderFor } from './config';
export type { SiteConfig, ReadinessItem, ConfigVars } from './config';
