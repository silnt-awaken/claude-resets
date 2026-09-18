import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Tests run inside workerd with a real (local) D1 so the Worker runtime, SQL and Web Crypto
// behave exactly as in production. Fake credentials below are test-only.
export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, 'migrations'));
  return {
    plugins: [
      cloudflareTest({
        main: './src/index.tsx',
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            SITE_URL: 'http://test.local',
            GOAL_ENABLED: 'false',
            GOAL_WALLET: '',
            GOAL_USDC_ACCOUNT: '',
            TELEGRAM_CHANNEL_URL: '',
            CONTENT_PUBLISH_TOKEN: 'test-publish-token-0123456789',
            REACTION_SECRET: 'test-reaction-secret',
            BROWSER_ALERTS_ENABLED: 'true',
            VAPID_SUBJECT: 'mailto:test@example.com',
            VAPID_PUBLIC_KEY: 'BIsZkqvHDwW1HL_15HWO9MTJlfq3itMZSIPuQjyyqdDFIdNQytQVi8BvwdUzFhiljZstlTYQvP-_9VAzNlBiu8g',
            VAPID_PRIVATE_KEY: 'PX-xFqwOsfuZkC1a8SoUCS3hpxzvXA3yxeOHpdQM8s0',
          },
        },
      }),
    ],
    test: {
      setupFiles: ['./test/apply-migrations.ts'],
      include: ['test/**/*.test.ts'],
    },
  };
});
