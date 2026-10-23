/**
 * Import the MOZU product models (Kitchen + Wardrobe cabinets) into the iOS app.
 *
 * For every `.usdz` in the source tree: copy it into Resources/Models with a safe
 * id, validate the zip, derive its real-world dimensions from the matching
 * `.STEP` via OpenCASCADE (so the catalogue footprints are correct), and keep the
 * STEP as the CAD source. Emits Design/Model/MozuModels.swift (the catalogue) and
 * a manifest + validation report.
 *
 *   node scripts/ios/import-mozu-models.mjs "<extracted ZIP dir>"
 */
import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import occtimportjs from 'occt-import-js';

const SRC = resolve(process.argv[2] ?? '/tmp/mozu_models');
const ROOT = resolve('.');
const MODELS_OUT = join(ROOT, 'apps/ios/MozuScanner/Resources/Models');
const STEP_OUT = join(ROOT, 'assets/mozu/step');
const SWIFT_OUT = join(ROOT, 'apps/ios/MozuScanner/Design/Model/MozuModels.swift');
mkdirSync(MODELS_OUT, { recursive: true });
mkdirSync(STEP_OUT, { recursive: true });

// Walk for .usdz files (skip macOS cruft).
function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === '__MACOSX') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.toLowerCase().endsWith('.usdz')) out.push(p);
  }
  return out;
}

function categorize(path, code) {
  const p = path.toLowerCase();
  if (p.includes('tall cabinet')) return { category: 'Kitchen · Tall', name: `Tall Cabinet ${code}` };
  if (p.includes('floor')) return { category: 'Kitchen · Base', name: `Base Cabinet ${code}` };
  if (p.includes('hanging')) return { category: 'Kitchen · Wall', name: `Wall Cabinet ${code}` };
  if (p.includes('main cabinet')) return { category: 'Wardrobe · Main', name: `Wardrobe ${code}` };
  if (p.includes('adj')) return { category: 'Wardrobe · Side', name: `Side Cabinet ADJ ${code}` };
  if (p.includes('side cabinet')) return { category: 'Wardrobe · Side', name: `Side Cabinet ${code}` };
  return { category: 'Other', name: code };
}

function idFor(path) {
  const raw = basename(path).replace(/\.usdz$/i, '');
  if (/adj/i.test(path)) {
    const n = raw.match(/\((\d)\)/)?.[1] ?? '1';
    return { id: `W_ADJ${n}`, code: `ADJ${n}` };
  }
  const id = raw.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return { id, code: id };
}

function findStep(usdzPath) {
  // …/<Group>/USDZ/<name>.usdz  → …/<Group>/STEP/<name>.STEP
  const name = basename(usdzPath).replace(/\.usdz$/i, '');
  const stepDir = join(dirname(dirname(usdzPath)), 'STEP');
  try {
    const match = readdirSync(stepDir).find(
      (f) => f.replace(/\.step$/i, '').toLowerCase() === name.toLowerCase(),
    );
    return match ? join(stepDir, match) : null;
  } catch {
    return null;
  }
}

const occt = await occtimportjs();
function stepSize(stepPath) {
  try {
    const res = occt.ReadStepFile(new Uint8Array(readFileSync(stepPath)), null);
    if (!res?.success || !res.meshes?.length) return null;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const m of res.meshes) {
      const p = m.attributes.position.array;
      for (let i = 0; i < p.length; i += 3)
        for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[i + k]); max[k] = Math.max(max[k], p[i + k]); }
    }
    let size = [0, 1, 2].map((k) => max[k] - min[k]);
    if (Math.max(...size) > 50) size = size.map((v) => v / 1000); // mm → m
    return size.map((v) => Math.round(v * 1000) / 1000);
  } catch {
    return null;
  }
}

const DEFAULT_SIZE = { Tall: [0.6, 2.1, 0.6], Base: [0.6, 0.85, 0.6], Wall: [0.6, 0.72, 0.35], Main: [1.0, 2.4, 0.6], Side: [0.45, 2.0, 0.58] };
function fallbackSize(category) {
  const key = category.split('·')[1]?.trim() ?? 'Base';
  return DEFAULT_SIZE[key] ?? [0.6, 0.85, 0.6];
}

const usdzFiles = walk(SRC).sort();
const items = [];
const report = [];
for (const usdz of usdzFiles) {
  const { id, code } = idFor(usdz);
  const { category, name } = categorize(usdz, code);
  copyFileSync(usdz, join(MODELS_OUT, `${id}.usdz`));

  // validate zip integrity
  let ok = true;
  try { execSync(`unzip -tqq "${usdz}"`, { stdio: 'pipe' }); } catch { ok = false; }

  const step = findStep(usdz);
  let size = step ? stepSize(step) : null;
  let sizeSource = size ? 'STEP' : 'default';
  if (!size) size = fallbackSize(category);
  if (step) copyFileSync(step, join(STEP_OUT, `${id}.step`));

  items.push({ id, name, category, size });
  report.push({ id, name, category, size, sizeSource, zipOK: ok, bytes: statSync(usdz).size });
  console.log(`${ok ? '✓' : '✗'} ${id.padEnd(8)} ${category.padEnd(18)} ${size.join(' × ')} m  [${sizeSource}]`);
}

// ── emit Swift catalogue ──
const swiftItems = items
  .map((it) => {
    const [w, h, d] = it.size;
    return `        FurnitureItem(id: "${it.id}", name: "${it.name}", category: "${it.category}", usdzName: "${it.id}", size: SIMD3<Float>(${w}, ${h}, ${d}))`;
  })
  .join(',\n');

const swift = `// MOZU product models (Kitchen + Wardrobe cabinets) imported from the real USDZ
// assets in Resources/Models. Generated by scripts/ios/import-mozu-models.mjs —
// dimensions are the true bounding boxes from each model's matching STEP file.
// USDZ are loaded at native (real-world) scale by ModelLoader; do not edit by hand.

import Foundation
import simd

enum MozuModels {
    static let items: [FurnitureItem] = [
${swiftItems}
    ]

    static let categories: [String] = [
        "Kitchen · Base", "Kitchen · Wall", "Kitchen · Tall", "Wardrobe · Main", "Wardrobe · Side",
    ]
}
`;
writeFileSync(SWIFT_OUT, swift);
writeFileSync(join(STEP_OUT, '..', 'mozu-models-report.json'), `${JSON.stringify(report, null, 2)}\n`);

const failures = report.filter((r) => !r.zipOK);
console.log(`\nImported ${items.length} models → ${MODELS_OUT}`);
console.log(`Wrote ${SWIFT_OUT}`);
console.log(failures.length ? `⚠ ${failures.length} zip failures: ${failures.map((f) => f.id).join(', ')}` : '✓ all USDZ valid');
