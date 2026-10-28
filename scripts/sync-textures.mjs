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
 * The browser gets them as WebP, not PNG: the same pixels to within what the
 * eye can see (worst texture 37.9 dB PSNR at quality 85; none has alpha), at
 * 2.4 MB for the library instead of 26 MB. The 3D view's first load fetched
 * 2.4 MB of PNG for a handful of finishes; it is now a tenth of that. The
 * iPad keeps the PNGs — it reads them from its own bundle, not the network.
 *
 * Existing files are left alone unless the source is newer, which keeps a warm
 * `next dev` from re-encoding the library on every restart.
 */

import { mkdir, readdir, stat } from 'node:fs/promises';
import sharp from 'sharp';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'apps/ios/MozuScanner/Resources/Textures');
const destination = join(root, 'public/textures');

/** Quality 85: invisible on a lit surface, a tenth of the PNG. */
const WEBP_QUALITY = 85;

// The encoded file is smaller than its source by design, so only age says
// whether it is stale.
const newer = async (from, to) => {
  try {
    const [a, b] = await Promise.all([stat(from), stat(to)]);
    return a.mtimeMs > b.mtimeMs;
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
  let encoded = 0;
  for (const name of names) {
    const from = join(source, name);
    const to = join(destination, name.replace(/\.png$/, '.webp'));
    if (!(await newer(from, to))) continue;
    await sharp(from).webp({ quality: WEBP_QUALITY }).toFile(to);
    encoded += 1;
  }
  console.log(`[textures] ${names.length} in the library, ${encoded} encoded to public/textures as WebP`);
}

await main();
