/**
 * Generate realistic furniture as .usdz (composed boxes + UsdPreviewSurface PBR
 * materials) so the iOS app ships a furnished "new home" catalogue out of the box.
 *
 * USDZ = an uncompressed (STORE) zip of a single `model.usda`, with the file data
 * 64-byte aligned (Apple USD requirement) — packed here without external tools.
 *
 *   node scripts/ios/gen-usdz.mjs <outDir>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── USDA authoring (boxes → mesh, grouped by material) ──
const f = (n) => (Number.isInteger(n) ? `${n}` : `${Math.round(n * 1e5) / 1e5}`);

// A box centred at c with full size s → {points, quads}.
function box(c, s) {
  const [x, y, z] = [s[0] / 2, s[1] / 2, s[2] / 2];
  const p = [
    [c[0] - x, c[1] - y, c[2] - z], [c[0] + x, c[1] - y, c[2] - z],
    [c[0] + x, c[1] - y, c[2] + z], [c[0] - x, c[1] - y, c[2] + z],
    [c[0] - x, c[1] + y, c[2] - z], [c[0] + x, c[1] + y, c[2] - z],
    [c[0] + x, c[1] + y, c[2] + z], [c[0] - x, c[1] + y, c[2] + z],
  ];
  const quads = [
    [0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4],
    [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7],
  ];
  return { points: p, quads };
}

function meshForGroup(name, group) {
  const points = [];
  const counts = [];
  const indices = [];
  for (const b of group.boxes) {
    const base = points.length;
    const { points: bp, quads } = box(b.c, b.s);
    points.push(...bp);
    for (const q of quads) {
      counts.push(4);
      indices.push(...q.map((i) => i + base));
    }
  }
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const zs = points.map((p) => p[2]);
  const ext = `[(${f(Math.min(...xs))}, ${f(Math.min(...ys))}, ${f(Math.min(...zs))}), (${f(Math.max(...xs))}, ${f(Math.max(...ys))}, ${f(Math.max(...zs))})]`;
  const [r, g, bl] = group.color;
  return `
    def Mesh "${name}" (prepend apiSchemas = ["MaterialBindingAPI"])
    {
        rel material:binding = </Root/Materials/${name}_mat>
        uniform bool doubleSided = 1
        float3[] extent = ${ext}
        int[] faceVertexCounts = [${counts.join(', ')}]
        int[] faceVertexIndices = [${indices.join(', ')}]
        point3f[] points = [${points.map((p) => `(${f(p[0])}, ${f(p[1])}, ${f(p[2])})`).join(', ')}]
        uniform token subdivisionScheme = "none"
    }`;
}

function materialForGroup(name, group) {
  const [r, g, b] = group.color;
  return `
    def Material "${name}_mat"
    {
        token outputs:surface.connect = </Root/Materials/${name}_mat/Surface.outputs:surface>
        def Shader "Surface"
        {
            uniform token info:id = "UsdPreviewSurface"
            color3f inputs:diffuseColor = (${f(r)}, ${f(g)}, ${f(b)})
            float inputs:roughness = ${f(group.roughness ?? 0.7)}
            float inputs:metallic = ${f(group.metallic ?? 0)}
            int inputs:useSpecularWorkflow = 0
            token outputs:surface
        }
    }`;
}

function buildUsda(groups) {
  const meshes = groups.map((g, i) => meshForGroup(`part${i}`, g)).join('\n');
  const mats = groups.map((g, i) => materialForGroup(`part${i}`, g)).join('\n');
  return `#usda 1.0
(
    defaultPrim = "Root"
    metersPerUnit = 1
    upAxis = "Y"
)

def Xform "Root" (kind = "component")
{
    def Scope "Geom"
    {${meshes}
    }
    def Scope "Materials"
    {${mats}
    }
}
`;
}

// ── USDZ packing (STORE zip, 64-byte aligned data) ──
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32fixed(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function packUsdz(usdaText) {
  const name = Buffer.from('model.usda', 'ascii');
  const data = Buffer.from(usdaText, 'utf8');
  const crc = crc32fixed(data);

  // Align file data to 64 bytes using an extra field of padding.
  const headerBase = 30 + name.length;
  let pad = (64 - (headerBase % 64)) % 64;
  if (pad > 0 && pad < 4) pad += 64; // extra field needs at least its 4-byte tag
  const extra = Buffer.alloc(pad);
  if (pad >= 4) {
    extra.writeUInt16LE(0x1986, 0); // benign header id
    extra.writeUInt16LE(pad - 4, 2);
  }

  const lfh = Buffer.alloc(30);
  lfh.writeUInt32LE(0x04034b50, 0);
  lfh.writeUInt16LE(20, 4); // version needed
  lfh.writeUInt16LE(0, 6); // flags
  lfh.writeUInt16LE(0, 8); // method = store
  lfh.writeUInt16LE(0, 10); // time
  lfh.writeUInt16LE(0, 12); // date
  lfh.writeUInt32LE(crc, 14);
  lfh.writeUInt32LE(data.length, 18);
  lfh.writeUInt32LE(data.length, 22);
  lfh.writeUInt16LE(name.length, 26);
  lfh.writeUInt16LE(extra.length, 28);

  const local = Buffer.concat([lfh, name, extra, data]);

  const cdh = Buffer.alloc(46);
  cdh.writeUInt32LE(0x02014b50, 0);
  cdh.writeUInt16LE(20, 4); // version made by
  cdh.writeUInt16LE(20, 6); // version needed
  cdh.writeUInt16LE(0, 8);
  cdh.writeUInt16LE(0, 10); // method store
  cdh.writeUInt16LE(0, 12);
  cdh.writeUInt16LE(0, 14);
  cdh.writeUInt32LE(crc, 16);
  cdh.writeUInt32LE(data.length, 20);
  cdh.writeUInt32LE(data.length, 24);
  cdh.writeUInt16LE(name.length, 28);
  cdh.writeUInt16LE(0, 30); // extra len in central dir
  cdh.writeUInt16LE(0, 32);
  cdh.writeUInt16LE(0, 34);
  cdh.writeUInt16LE(0, 36);
  cdh.writeUInt32LE(0, 38);
  cdh.writeUInt32LE(0, 42); // offset of local header
  const central = Buffer.concat([cdh, name]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(local.length, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([local, central, eocd]);
}

// ── Furniture (metres; built with base at y = 0) ──
const WOOD = { color: [0.46, 0.33, 0.21], roughness: 0.6 };
const OAK = { color: [0.66, 0.5, 0.32], roughness: 0.6 };
const FABRIC_GREY = { color: [0.55, 0.56, 0.58], roughness: 0.95 };
const FABRIC_BEIGE = { color: [0.79, 0.72, 0.6], roughness: 0.95 };
const METAL = { color: [0.62, 0.62, 0.64], roughness: 0.3, metallic: 1 };
const WHITE = { color: [0.9, 0.9, 0.88], roughness: 0.8 };
const GREEN = { color: [0.32, 0.5, 0.26], roughness: 0.8 };
const RUGCOL = { color: [0.74, 0.36, 0.34], roughness: 0.95 };

const grp = (mat, boxes) => ({ ...mat, boxes });

const PIECES = {
  sofa_3seat: () => [
    grp(FABRIC_GREY, [
      { c: [0, 0.2, 0], s: [2.1, 0.4, 0.95] },
      { c: [0, 0.55, -0.37], s: [2.1, 0.7, 0.2] },
      { c: [-0.98, 0.4, 0], s: [0.16, 0.55, 0.95] },
      { c: [0.98, 0.4, 0], s: [0.16, 0.55, 0.95] },
      { c: [-0.6, 0.46, 0.05], s: [0.62, 0.16, 0.78] },
      { c: [0, 0.46, 0.05], s: [0.62, 0.16, 0.78] },
      { c: [0.6, 0.46, 0.05], s: [0.62, 0.16, 0.78] },
    ]),
    grp(WOOD, [
      { c: [-0.95, 0.05, -0.4], s: [0.08, 0.1, 0.08] },
      { c: [0.95, 0.05, -0.4], s: [0.08, 0.1, 0.08] },
      { c: [-0.95, 0.05, 0.4], s: [0.08, 0.1, 0.08] },
      { c: [0.95, 0.05, 0.4], s: [0.08, 0.1, 0.08] },
    ]),
  ],
  bed_queen: () => [
    grp(WOOD, [
      { c: [0, 0.15, 0], s: [1.7, 0.3, 2.1] },
      { c: [0, 0.6, -1.0], s: [1.7, 0.9, 0.1] },
    ]),
    grp(WHITE, [
      { c: [0, 0.42, 0.05], s: [1.6, 0.22, 1.95] },
      { c: [-0.4, 0.56, -0.7], s: [0.65, 0.14, 0.4] },
      { c: [0.4, 0.56, -0.7], s: [0.65, 0.14, 0.4] },
    ]),
  ],
  dining_table: () => [
    grp(OAK, [{ c: [0, 0.73, 0], s: [1.5, 0.05, 0.85] }]),
    grp(WOOD, [
      { c: [-0.68, 0.36, -0.36], s: [0.07, 0.72, 0.07] },
      { c: [0.68, 0.36, -0.36], s: [0.07, 0.72, 0.07] },
      { c: [-0.68, 0.36, 0.36], s: [0.07, 0.72, 0.07] },
      { c: [0.68, 0.36, 0.36], s: [0.07, 0.72, 0.07] },
    ]),
  ],
  dining_chair: () => [
    grp(OAK, [
      { c: [0, 0.46, 0], s: [0.45, 0.05, 0.45] },
      { c: [0, 0.7, -0.2], s: [0.45, 0.45, 0.05] },
    ]),
    grp(WOOD, [
      { c: [-0.19, 0.23, -0.19], s: [0.05, 0.46, 0.05] },
      { c: [0.19, 0.23, -0.19], s: [0.05, 0.46, 0.05] },
      { c: [-0.19, 0.23, 0.19], s: [0.05, 0.46, 0.05] },
      { c: [0.19, 0.23, 0.19], s: [0.05, 0.46, 0.05] },
    ]),
  ],
  coffee_table: () => [
    grp(WALNUTtop(), [{ c: [0, 0.4, 0], s: [1.1, 0.06, 0.6] }]),
    grp(METAL, [
      { c: [-0.48, 0.19, -0.24], s: [0.05, 0.38, 0.05] },
      { c: [0.48, 0.19, -0.24], s: [0.05, 0.38, 0.05] },
      { c: [-0.48, 0.19, 0.24], s: [0.05, 0.38, 0.05] },
      { c: [0.48, 0.19, 0.24], s: [0.05, 0.38, 0.05] },
    ]),
  ],
  bookshelf: () => [
    grp(OAK, [
      { c: [-0.4, 1.0, 0], s: [0.04, 2.0, 0.3] },
      { c: [0.4, 1.0, 0], s: [0.04, 2.0, 0.3] },
      { c: [0, 0.02, 0], s: [0.84, 0.04, 0.3] },
      { c: [0, 0.5, 0], s: [0.84, 0.04, 0.3] },
      { c: [0, 1.0, 0], s: [0.84, 0.04, 0.3] },
      { c: [0, 1.5, 0], s: [0.84, 0.04, 0.3] },
      { c: [0, 1.98, 0], s: [0.84, 0.04, 0.3] },
      { c: [0, 1.0, -0.14], s: [0.84, 2.0, 0.02] },
    ]),
  ],
  tv_console: () => [
    grp(WALNUTtop(), [
      { c: [0, 0.25, 0], s: [1.6, 0.5, 0.4] },
      { c: [0, 0.25, 0.205], s: [1.5, 0.4, 0.01] },
    ]),
  ],
  planter: () => [
    grp({ color: [0.4, 0.3, 0.24], roughness: 0.8 }, [{ c: [0, 0.2, 0], s: [0.35, 0.4, 0.35] }]),
    grp(GREEN, [
      { c: [0, 0.65, 0], s: [0.5, 0.6, 0.5] },
      { c: [0.1, 0.95, 0.05], s: [0.35, 0.5, 0.35] },
    ]),
  ],
  rug: () => [grp(RUGCOL, [{ c: [0, 0.01, 0], s: [2.4, 0.02, 1.6] }])],
};

function WALNUTtop() {
  return { color: [0.3, 0.2, 0.13], roughness: 0.5 };
}

// ── run ──
const outDir = resolve(process.argv[2] ?? '.');
mkdirSync(outDir, { recursive: true });
const manifest = [];
for (const [id, build] of Object.entries(PIECES)) {
  const groups = build();
  const usda = buildUsda(groups);
  const usdz = packUsdz(usda);
  writeFileSync(resolve(outDir, `${id}.usdz`), usdz);
  // bbox for the catalogue
  const pts = groups.flatMap((g) => g.boxes.flatMap((b) => {
    const h = b.s.map((v) => v / 2);
    return [[b.c[0] - h[0], b.c[1] - h[1], b.c[2] - h[2]], [b.c[0] + h[0], b.c[1] + h[1], b.c[2] + h[2]]];
  }));
  const mn = [0, 1, 2].map((k) => Math.min(...pts.map((p) => p[k])));
  const mx = [0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k])));
  const size = [0, 1, 2].map((k) => Math.round((mx[k] - mn[k]) * 1000) / 1000);
  manifest.push({ id, size, bytes: usdz.length });
  console.log(`✓ ${id}.usdz  ${size.join(' × ')} m  (${usdz.length} B)`);
}
writeFileSync(resolve(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
