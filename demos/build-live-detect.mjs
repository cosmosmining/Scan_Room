/**
 * Build demos/live-detect.html — a single self-contained page that runs the
 * REAL detectors compiled from src/, so the demo can never drift from the app.
 *
 *   node demos/build-live-detect.mjs
 *
 * Serve it over HTTPS (or localhost) — browsers only grant camera access to a
 * secure origin, iOS Safari included.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const tmp = mkdtempSync(join(tmpdir(), 'mozu-demo-'));
const entry = join(tmp, 'entry.ts');
const bundle = join(tmp, 'detectors.js');

writeFileSync(entry, [
  "export { detectSockets } from '@/systems/scan/fixtureDetector';",
  "export { detectPipes } from '@/systems/scan/pipeDetector';",
].join('\n'));

execFileSync(join(root, 'node_modules/.bin/esbuild'), [
  entry, '--bundle', '--format=iife', '--global-name=MOZU',
  '--platform=browser', '--target=es2018',
  `--alias:@=${join(root, 'src')}`, `--outfile=${bundle}`,
], { stdio: 'inherit' });

const page = readFileSync(join(here, 'live-detect.template.html'), 'utf8');
if (!page.includes('__BUNDLE__')) throw new Error('template lost its __BUNDLE__ marker');
const out = join(here, 'live-detect.html');
writeFileSync(out, page.replace('__BUNDLE__', readFileSync(bundle, 'utf8')));
console.log('wrote', out);
