/**
 * Parametric STEP (ISO 10303-21, AP214) generator for a rectangular furniture
 * solid — a cabinet / wardrobe carcass of W (x) × H (y) × D (z) millimetres.
 *
 * Why hand-generate STEP: it gives us a real, manufacturing-grade B-rep input to
 * prove the STEP → mesh → placement pipeline end to end, with no native CAD
 * dependency. The topology is a closed manifold shell of 6 planar ADVANCED_FACEs.
 *
 * Orientation scheme (the part that makes a valid B-rep): every edge is stored
 * once, directed low→high vertex index. A face loop traversing an edge a→b uses
 * ORIENTED_EDGE orientation `.T.` when a<b (matches the stored direction) and
 * `.F.` otherwise. Face loops are wound CCW about each face's outward normal, so
 * ADVANCED_FACE.same_sense is `.T.` throughout.
 */

// Box corners: 0..3 front (z=0), 4..7 back (z=D); y is up.
const CORNERS = (w, h, d) => [
  [0, 0, 0], [w, 0, 0], [w, h, 0], [0, h, 0],
  [0, 0, d], [w, 0, d], [w, h, d], [0, h, d],
];

// 12 unique edges, stored low→high.
const EDGES = [
  [0, 1], [1, 2], [2, 3], [0, 3],
  [4, 5], [5, 6], [6, 7], [4, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

// Six faces: CCW loop about the outward normal; refTo = first-edge target (an
// in-plane direction for the surface placement's ref_direction).
const FACES = [
  { loop: [0, 3, 2, 1], normal: [0, 0, -1], refTo: 3 }, // front  z=0
  { loop: [4, 5, 6, 7], normal: [0, 0, 1], refTo: 5 },  // back   z=D
  { loop: [0, 1, 5, 4], normal: [0, -1, 0], refTo: 1 }, // bottom y=0
  { loop: [3, 7, 6, 2], normal: [0, 1, 0], refTo: 7 },  // top    y=H
  { loop: [0, 4, 7, 3], normal: [-1, 0, 0], refTo: 4 }, // left   x=0
  { loop: [1, 2, 6, 5], normal: [1, 0, 0], refTo: 2 },  // right  x=W
];

const num = (n) => {
  const r = Math.round(n * 1e6) / 1e6;
  return Number.isInteger(r) ? `${r}.` : `${r}`;
};
const triple = (v) => `(${v.map(num).join(',')})`;
const unit = (v) => {
  const l = Math.hypot(...v) || 1;
  return v.map((c) => c / l);
};

export function genStepBox({
  name,
  width,
  height,
  depth,
  timestamp = '2026-06-29T00:00:00',
}) {
  const w = width;
  const h = height;
  const d = depth;
  const V = CORNERS(w, h, d);

  let id = 0;
  const lines = [];
  const ref = (body) => {
    id += 1;
    lines.push(`#${id}=${body};`);
    return `#${id}`;
  };

  // ── product / context boilerplate ──
  const appCtx = ref(`APPLICATION_CONTEXT('automotive_design')`);
  ref(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2010,${appCtx})`);
  const prodCtx = ref(`PRODUCT_CONTEXT('',${appCtx},'mechanical')`);
  const product = ref(`PRODUCT('${name}','${name}','',(${prodCtx}))`);
  const formation = ref(`PRODUCT_DEFINITION_FORMATION('','',${product})`);
  const pdCtx = ref(`PRODUCT_DEFINITION_CONTEXT('part definition',${appCtx},'design')`);
  const pd = ref(`PRODUCT_DEFINITION('design','',${formation},${pdCtx})`);
  const pds = ref(`PRODUCT_DEFINITION_SHAPE('','',${pd})`);

  // ── units + geometric context (millimetres) ──
  const lenUnit = ref(`(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))`);
  const angUnit = ref(`(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))`);
  const solUnit = ref(`(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())`);
  const unc = ref(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(0.01),${lenUnit},'distance_accuracy_value','')`);
  const geoCtx = ref(
    `(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${unc}))` +
      `GLOBAL_UNIT_ASSIGNED_CONTEXT((${lenUnit},${angUnit},${solUnit}))REPRESENTATION_CONTEXT('Context #1','3D'))`,
  );

  // ── vertices ──
  const vPoint = V.map((p) => ref(`CARTESIAN_POINT('',${triple(p)})`));
  const vertex = vPoint.map((p) => ref(`VERTEX_POINT('',${p})`));

  // ── edges (one EDGE_CURVE per unique edge, directed low→high) ──
  const edgeCurve = {};
  for (const [a, b] of EDGES) {
    const dir = unit([V[b][0] - V[a][0], V[b][1] - V[a][1], V[b][2] - V[a][2]]);
    const len = Math.hypot(V[b][0] - V[a][0], V[b][1] - V[a][1], V[b][2] - V[a][2]);
    const dRef = ref(`DIRECTION('',${triple(dir)})`);
    const vec = ref(`VECTOR('',${dRef},${num(len)})`);
    const line = ref(`LINE('',${vPoint[a]},${vec})`);
    edgeCurve[`${a},${b}`] = ref(`EDGE_CURVE('',${vertex[a]},${vertex[b]},${line},.T.)`);
  }

  const orientedEdge = (a, b) => {
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    const orient = a < b ? '.T.' : '.F.';
    return ref(`ORIENTED_EDGE('',*,*,${edgeCurve[key]},${orient})`);
  };

  // ── faces ──
  const faceRefs = FACES.map((f) => {
    const oes = f.loop.map((v, i) => orientedEdge(v, f.loop[(i + 1) % 4]));
    const loop = ref(`EDGE_LOOP('',(${oes.join(',')}))`);
    const bound = ref(`FACE_OUTER_BOUND('',${loop},.T.)`);
    const origin = f.loop[0];
    const refDir = unit([
      V[f.refTo][0] - V[origin][0],
      V[f.refTo][1] - V[origin][1],
      V[f.refTo][2] - V[origin][2],
    ]);
    const axis = ref(`DIRECTION('',${triple(f.normal)})`);
    const rdir = ref(`DIRECTION('',${triple(refDir)})`);
    const placement = ref(`AXIS2_PLACEMENT_3D('',${vPoint[origin]},${axis},${rdir})`);
    const plane = ref(`PLANE('',${placement})`);
    return ref(`ADVANCED_FACE('',(${bound}),${plane},.T.)`);
  });

  // ── solid + shape representation ──
  const shell = ref(`CLOSED_SHELL('',(${faceRefs.join(',')}))`);
  const solid = ref(`MANIFOLD_SOLID_BREP('${name}',${shell})`);
  const brepRep = ref(`ADVANCED_BREP_SHAPE_REPRESENTATION('',(${solid}),${geoCtx})`);
  ref(`SHAPE_DEFINITION_REPRESENTATION(${pds},${brepRep})`);

  const stamp = timestamp;
  const header = [
    'ISO-10303-21;',
    'HEADER;',
    `FILE_DESCRIPTION(('MOZU furniture carcass: ${name} ${w}x${h}x${d} mm'),'2;1');`,
    `FILE_NAME('${name}.step','${stamp}',('MOZU'),('MOZU'),'mozu-gen-step-box','MOZU configurator','');`,
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
    'ENDSEC;',
    'DATA;',
  ].join('\n');

  return `${header}\n${lines.join('\n')}\nENDSEC;\nEND-ISO-10303-21;\n`;
}

// ── CLI: node scripts/cad/gen-step-box.mjs <name> <w> <h> <d> <out.step> ──
if (import.meta.url === `file://${process.argv[1]}`) {
  const { writeFileSync } = await import('node:fs');
  const [name, w, h, d, out] = process.argv.slice(2);
  if (!out) {
    console.error('usage: gen-step-box.mjs <name> <width> <height> <depth> <out.step>');
    process.exit(1);
  }
  const step = genStepBox({
    name,
    width: Number(w),
    height: Number(h),
    depth: Number(d),
  });
  writeFileSync(out, step);
  console.log(`wrote ${out} (${step.length} bytes)`);
}
