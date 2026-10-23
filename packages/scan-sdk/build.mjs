/**
 * Bundle @mozu/scan-sdk into dist/ so the browser extensions can load it
 * without a build step:
 *   - dist/mozu-scan-sdk.js         ESM  (import … from '…/mozu-scan-sdk.js')
 *   - dist/mozu-scan-sdk.global.js  IIFE (window.MozuScan), for classic scripts
 *
 * Run: `node build.mjs` (needs esbuild). The committed output keeps the
 * extensions installable straight from the repo.
 */
import { build } from 'esbuild';

const common = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  target: ['es2020'],
  platform: 'browser',
  legalComments: 'none',
};

await build({ ...common, format: 'esm', outfile: 'dist/mozu-scan-sdk.js' });
await build({
  ...common,
  format: 'iife',
  globalName: 'MozuScan',
  outfile: 'dist/mozu-scan-sdk.global.js',
});

console.log('✓ built dist/mozu-scan-sdk.js (esm) + dist/mozu-scan-sdk.global.js (iife)');
