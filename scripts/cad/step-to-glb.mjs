/**
 * STEP → GLB + placement metadata.
 *
 * Tessellates a STEP B-rep with OpenCASCADE (occt-import-js / WASM), writes an
 * optimised glTF-binary the Three.js viewer can load, and extracts the
 * axis-aligned bounding box — the exact numbers the MOZU placement engine needs
 * (`ModuleDefinition.dimensions`). The mesh is recentred on its footprint centre
 * with its base at y=0, so it drops straight into the configurator's module
 * placement (which positions modules by footprint centre, sitting on the floor).
 *
 * Usage:
 *   node scripts/cad/step-to-glb.mjs <in.step> <out.glb> [--id <id>] [--name <name>]
 *        [--category <cat>] [--price <minorUnits>] [--def <out.def.json>]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import occtimportjs from 'occt-import-js';
import { Document, NodeIO } from '@gltf-transform/core';

/** Tessellate a STEP file → merged { positions, normals, indices } (mm). */
export async function tessellateStep(stepBytes) {
  const occt = await occtimportjs();
  const result = occt.ReadStepFile(new Uint8Array(stepBytes), null);
  if (!result?.success || !result.meshes?.length) {
    throw new Error('OCCT failed to read STEP file (no meshes).');
  }
  const positions = [];
  const normals = [];
  const indices = [];
  let base = 0;
  for (const mesh of result.meshes) {
    const p = mesh.attributes.position.array;
    const n = mesh.attributes.normal?.array;
    for (let i = 0; i < p.length; i++) positions.push(p[i]);
    for (let i = 0; i < p.length; i++) normals.push(n ? n[i] : 0);
    for (const idx of mesh.index.array) indices.push(idx + base);
    base += p.length / 3;
  }
  return { positions, normals, indices };
}

/** Axis-aligned bbox of a flat positions array. */
export function boundingBox(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], positions[i + k]);
      max[k] = Math.max(max[k], positions[i + k]);
    }
  }
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

/** Recentre on footprint centre (x,z) with the base at y=0 — placement-ready. */
function recentre(positions, bbox) {
  const cx = (bbox.min[0] + bbox.max[0]) / 2;
  const cz = (bbox.min[2] + bbox.max[2]) / 2;
  const minY = bbox.min[1];
  const out = positions.slice();
  for (let i = 0; i < out.length; i += 3) {
    out[i] -= cx;
    out[i + 1] -= minY;
    out[i + 2] -= cz;
  }
  return out;
}

/** Build a single-mesh GLB (POSITION + NORMAL + indices, one PBR material). */
export async function buildGlb({ positions, normals, indices, name, color }) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const pos = doc
    .createAccessor(`${name}_POSITION`)
    .setType('VEC3')
    .setArray(new Float32Array(positions))
    .setBuffer(buffer);
  const nrm = doc
    .createAccessor(`${name}_NORMAL`)
    .setType('VEC3')
    .setArray(new Float32Array(normals))
    .setBuffer(buffer);
  const idx = doc
    .createAccessor(`${name}_indices`)
    .setType('SCALAR')
    .setArray(new Uint32Array(indices))
    .setBuffer(buffer);
  const material = doc
    .createMaterial(`${name}_mat`)
    .setBaseColorFactor(color ?? [0.82, 0.82, 0.8, 1])
    .setRoughnessFactor(0.85)
    .setMetallicFactor(0);
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', pos)
    .setAttribute('NORMAL', nrm)
    .setIndices(idx)
    .setMaterial(material);
  const mesh = doc.createMesh(name).addPrimitive(prim);
  const node = doc.createNode(name).setMesh(mesh);
  doc.createScene(name).addChild(node);
  return new NodeIO().writeBinary(doc);
}

/** Full pipeline: STEP bytes → { glb, dimensions, definition }. */
export async function convertStep(stepBytes, meta = {}) {
  const raw = await tessellateStep(stepBytes);
  const bbox = boundingBox(raw.positions);
  const positions = recentre(raw.positions, bbox);
  const [width, height, depth] = bbox.size.map((n) => Math.round(n * 10) / 10);
  const id = meta.id ?? 'cad-part';
  const glb = await buildGlb({
    positions,
    normals: raw.normals,
    indices: raw.indices,
    name: id,
    color: meta.color,
  });
  const definition = {
    id,
    name: meta.name ?? id,
    category: meta.category ?? 'wardrobe-frame',
    dimensions: { width, height, depth },
    modelUrl: `/models/${id}.glb`,
    stepUrl: `/cad/${id}.step`,
    basePrice: meta.price ?? 0,
    source: 'step',
    triangles: raw.indices.length / 3,
  };
  return { glb, dimensions: { width, height, depth }, definition };
}

// ── CLI ──
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const [input, output] = args.filter((a) => !a.startsWith('--'));
  const flag = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : fallback;
  };
  if (!input || !output) {
    console.error('usage: step-to-glb.mjs <in.step> <out.glb> [--id x --name x --category x --price n --def out.json]');
    process.exit(1);
  }
  const { glb, dimensions, definition } = await convertStep(readFileSync(input), {
    id: flag('id', 'cad-part'),
    name: flag('name'),
    category: flag('category'),
    price: flag('price') ? Number(flag('price')) : undefined,
  });
  writeFileSync(output, Buffer.from(glb));
  console.log(`✓ ${output} (${glb.length} bytes) · ${definition.triangles} tris`);
  console.log(`  dimensions WxHxD mm: ${dimensions.width} x ${dimensions.height} x ${dimensions.depth}`);
  const defOut = flag('def');
  if (defOut) {
    writeFileSync(defOut, JSON.stringify(definition, null, 2));
    console.log(`  wrote ${defOut}`);
  }
}
