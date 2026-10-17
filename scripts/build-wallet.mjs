import { build } from 'esbuild';
await build({
  entryPoints: ['scripts/browser/goal-transaction.ts'],
  outfile: 'public/vendor/goal-transaction.js',
  bundle: true, format: 'iife', platform: 'browser', target: 'es2022', minify: true,
  supported: { 'template-literal': false },
  legalComments: 'linked',
});
