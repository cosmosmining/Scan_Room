/**
 * Assemble the browser extensions from the shared SDK + Chrome web assets.
 *
 *   1. (re)build @mozu/scan-sdk            → packages/scan-sdk/dist
 *   2. vendor the ESM bundle into Chrome   → extensions/chrome/vendor
 *   3. generate toolbar icons              → extensions/chrome/icons
 *   4. mirror the web assets into Safari   → extensions/safari/Resources
 *
 * Run: `node extensions/build.mjs`  (from the repo root)
 */
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const sdk = join(root, 'packages', 'scan-sdk');
const chrome = join(here, 'chrome');
const safariResources = join(here, 'safari', 'Resources');

// 1. Build the SDK bundle (best-effort; skip if esbuild isn't installed yet).
try {
  execFileSync('node', ['build.mjs'], { cwd: sdk, stdio: 'inherit' });
} catch {
  console.warn('· skipped SDK rebuild (run `npm install && npm run build` in packages/scan-sdk)');
}

// 2. Vendor the ESM bundle into Chrome.
const bundle = join(sdk, 'dist', 'mozu-scan-sdk.js');
if (!existsSync(bundle)) throw new Error(`SDK bundle missing: ${bundle}. Build the SDK first.`);
mkdirSync(join(chrome, 'vendor'), { recursive: true });
cpSync(bundle, join(chrome, 'vendor', 'mozu-scan-sdk.js'));

// 3. Generate icons into Chrome.
execFileSync('node', [join(here, 'tools', 'make-icons.mjs'), join(chrome, 'icons')], {
  stdio: 'inherit',
});

// 4. Mirror the Chrome web assets into the Safari extension's Resources.
const WEB_ASSETS = [
  'manifest.json',
  'popup.html',
  'popup.js',
  'scanner.html',
  'scanner.js',
  'styles.css',
  'vendor',
  'icons',
];
rmSync(safariResources, { recursive: true, force: true });
mkdirSync(safariResources, { recursive: true });
for (const asset of WEB_ASSETS) {
  const src = join(chrome, asset);
  if (!existsSync(src)) continue;
  cpSync(src, join(safariResources, asset), { recursive: statSync(src).isDirectory() });
}

const count = (dir) => readdirSync(dir, { recursive: true }).length;
console.log(`✓ Chrome ready (${count(chrome)} entries) · Safari Resources mirrored (${count(safariResources)} entries)`);
