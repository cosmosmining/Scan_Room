#!/usr/bin/env node
/**
 * Copy the iPad app's texture library into `public/textures` so the browser
 * serves the SAME bitmaps the iPad renders.
 *
 * They are copied rather than committed twice: 25 MB of PNG in two places in
 * one repository is 25 MB that can drift, and a floor that is oak on an iPad
 * and something-else-called-oak in a browser is the exact bug the shared
 * finish library exists to prevent. `apps/ios/.../Resources/Textures` is the
 * one source; this runs from `predev` and `prebuild`, so a fresh clone that
 * only ever runs `npm run build` still gets them.
 *
 * Existing files are left alone unless the source is newer, which keeps a warm
 * `next dev` from re-copying 25 MB on every restart.
 */

import { cp, mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'apps/ios/MozuScanner/Resources/Textures');
const destination = join(root, 'public/textures');

const newer = async (from, to) => {
  try {
    const [a, b] = await Promise.all([stat(from), stat(to)]);
    return a.mtimeMs > b.mtimeMs || a.size !== b.size;
  } catch {
    return true; // not there yet
  }
};

async function main() {
  let names;
  try {
    names = (await readdir(source)).filter((n) => n.endsWith('.png'));
  } catch {
    // The iOS app is not checked out (a web-only deploy). Not fatal: every
    // finish has an average colour to fall back to.
    console.warn(`[textures] ${source} not found — skipping (finishes fall back to flat colour)`);
    return;
  }

  await mkdir(destination, { recursive: true });
  let copied = 0;
  for (const name of names) {
    const from = join(source, name);
    const to = join(destination, name);
    if (!(await newer(from, to))) continue;
    await cp(from, to);
    copied += 1;
  }
  console.log(`[textures] ${names.length} in the library, ${copied} copied to public/textures`);
}

await main();
