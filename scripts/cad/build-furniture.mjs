/**
 * Furniture CAD pipeline (one command):
 *   STEP (generated) → tessellate (OCCT) → GLB (public/models) + dimensions.
 *
 * For each item: writes the source `.step` (assets/step + public/cad so it's
 * downloadable), the runtime `.glb` (public/models), and collects a ready-to-use
 * `ModuleDefinition`. The definitions are written to
 * assets/step/catalog-additions.json and are mirrored in
 * src/systems/catalog/data.ts (the STEP-sourced entries).
 *
 *   npm run cad:furniture
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { genStepBox } from './gen-step-box.mjs';
import { convertStep } from './step-to-glb.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const p = (...s) => resolve(ROOT, ...s);
const ensure = (file) => mkdirSync(dirname(file), { recursive: true });

/** The furniture to manufacture from STEP. Width × Height × Depth (mm). */
const ITEMS = [
  { id: 'closet-1000', name: 'Wardrobe Closet 1000', category: 'wardrobe-frame', width: 1000, height: 2000, depth: 600, price: 32000, color: [0.80, 0.71, 0.55, 1] },
  { id: 'cad-base-600', name: 'CAD Base Cabinet 600', category: 'kitchen-base', width: 600, height: 900, depth: 600, price: 21000, color: [0.86, 0.86, 0.84, 1] },
];

const definitions = [];
for (const item of ITEMS) {
  const stepText = genStepBox(item);
  const stepAsset = p('assets/step', `${item.id}.step`);
  const stepPublic = p('public/cad', `${item.id}.step`);
  const glbPath = p('public/models', `${item.id}.glb`);
  [stepAsset, stepPublic, glbPath].forEach(ensure);
  writeFileSync(stepAsset, stepText);
  writeFileSync(stepPublic, stepText);

  const { glb, dimensions, definition } = await convertStep(Buffer.from(stepText), {
    id: item.id,
    name: item.name,
    category: item.category,
    price: item.price,
    color: item.color,
  });
  writeFileSync(glbPath, Buffer.from(glb));
  definitions.push(definition);

  console.log(
    `✓ ${item.id}: ${dimensions.width}×${dimensions.height}×${dimensions.depth} mm` +
      ` · ${definition.triangles} tris · ${glb.length} B glb`,
  );
}

const defsOut = p('assets/step/catalog-additions.json');
writeFileSync(defsOut, `${JSON.stringify(definitions, null, 2)}\n`);
console.log(`\nWrote ${definitions.length} definitions → ${defsOut}`);
