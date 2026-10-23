/**
 * Furniture geometry, ported from `scripts/ios/gen-usdz.mjs`.
 *
 * The iPad's home furnishings are not modelled meshes — they are composed
 * boxes with PBR materials, authored by that script and packed into USDZ. So
 * the same box list rendered in Three.js is not an approximation of the iPad's
 * sofa: it IS the iPad's sofa, down to the leg positions and the roughness.
 * That is the whole reason to port the boxes rather than convert 14 MB of USDZ
 * to glTF and hope the two pipelines agree.
 *
 * MOZU's real cabinets (KT/KF/KH/W) do ship as authored USDZ, which has no web
 * equivalent, so those get a carcass-front-plinth-handle build sized from the
 * catalogue's true bounding box. It reads as a cabinet and it is the right
 * size; it is not claimed to be the modelled door.
 *
 * Units: millimetres, base at y = 0, centred on the footprint in X and Z —
 * the same frame `PlacedFurniture.position` uses.
 */

import { furnitureItem, type FurnitureItem } from './catalog';

export interface Part {
  /** Centre, millimetres. */
  c: [number, number, number];
  /** Full size, millimetres. */
  s: [number, number, number];
  color: string;
  roughness: number;
  metalness: number;
}

interface Mat { color: string; roughness: number; metalness?: number }

const WOOD: Mat = { color: '#755436', roughness: 0.6 };
const OAK: Mat = { color: '#a88052', roughness: 0.6 };
const WALNUT: Mat = { color: '#4d3321', roughness: 0.5 };
const FABRIC_GREY: Mat = { color: '#8c8f94', roughness: 0.95 };
const METAL: Mat = { color: '#9e9ea3', roughness: 0.3, metalness: 1 };
const WHITE: Mat = { color: '#e6e6e0', roughness: 0.8 };
const GREEN: Mat = { color: '#528042', roughness: 0.8 };
const RUG: Mat = { color: '#bd5c57', roughness: 0.95 };
const POT: Mat = { color: '#664d3d', roughness: 0.8 };

/** Metres in (as authored in the Swift-side generator), millimetres out. */
const grp = (mat: Mat, boxes: { c: [number, number, number]; s: [number, number, number] }[]): Part[] =>
  boxes.map((b) => ({
    c: [b.c[0] * 1000, b.c[1] * 1000, b.c[2] * 1000],
    s: [b.s[0] * 1000, b.s[1] * 1000, b.s[2] * 1000],
    color: mat.color,
    roughness: mat.roughness,
    metalness: mat.metalness ?? 0,
  }));

const HOME_PARTS: Record<string, () => Part[]> = {
  sofa_3seat: () => [
    ...grp(FABRIC_GREY, [
      { c: [0, 0.2, 0], s: [2.1, 0.4, 0.95] },
      { c: [0, 0.55, -0.37], s: [2.1, 0.7, 0.2] },
      { c: [-0.98, 0.4, 0], s: [0.16, 0.55, 0.95] },
      { c: [0.98, 0.4, 0], s: [0.16, 0.55, 0.95] },
      { c: [-0.6, 0.46, 0.05], s: [0.62, 0.16, 0.78] },
      { c: [0, 0.46, 0.05], s: [0.62, 0.16, 0.78] },
      { c: [0.6, 0.46, 0.05], s: [0.62, 0.16, 0.78] },
    ]),
    ...grp(WOOD, [
      { c: [-0.95, 0.05, -0.4], s: [0.08, 0.1, 0.08] },
      { c: [0.95, 0.05, -0.4], s: [0.08, 0.1, 0.08] },
      { c: [-0.95, 0.05, 0.4], s: [0.08, 0.1, 0.08] },
      { c: [0.95, 0.05, 0.4], s: [0.08, 0.1, 0.08] },
    ]),
  ],
  bed_queen: () => [
    ...grp(WOOD, [
      { c: [0, 0.15, 0], s: [1.7, 0.3, 2.1] },
      { c: [0, 0.6, -1.0], s: [1.7, 0.9, 0.1] },
    ]),
    ...grp(WHITE, [
      { c: [0, 0.42, 0.05], s: [1.6, 0.22, 1.95] },
      { c: [-0.4, 0.56, -0.7], s: [0.65, 0.14, 0.4] },
      { c: [0.4, 0.56, -0.7], s: [0.65, 0.14, 0.4] },
    ]),
  ],
  dining_table: () => [
    ...grp(OAK, [{ c: [0, 0.73, 0], s: [1.5, 0.05, 0.85] }]),
    ...grp(WOOD, [
      { c: [-0.68, 0.36, -0.36], s: [0.07, 0.72, 0.07] },
      { c: [0.68, 0.36, -0.36], s: [0.07, 0.72, 0.07] },
      { c: [-0.68, 0.36, 0.36], s: [0.07, 0.72, 0.07] },
      { c: [0.68, 0.36, 0.36], s: [0.07, 0.72, 0.07] },
    ]),
  ],
  dining_chair: () => [
    ...grp(OAK, [
      { c: [0, 0.46, 0], s: [0.45, 0.05, 0.45] },
      { c: [0, 0.7, -0.2], s: [0.45, 0.45, 0.05] },
    ]),
    ...grp(WOOD, [
      { c: [-0.19, 0.23, -0.19], s: [0.05, 0.46, 0.05] },
      { c: [0.19, 0.23, -0.19], s: [0.05, 0.46, 0.05] },
      { c: [-0.19, 0.23, 0.19], s: [0.05, 0.46, 0.05] },
      { c: [0.19, 0.23, 0.19], s: [0.05, 0.46, 0.05] },
    ]),
  ],
  coffee_table: () => [
    ...grp(WALNUT, [{ c: [0, 0.4, 0], s: [1.1, 0.06, 0.6] }]),
    ...grp(METAL, [
      { c: [-0.48, 0.19, -0.24], s: [0.05, 0.38, 0.05] },
      { c: [0.48, 0.19, -0.24], s: [0.05, 0.38, 0.05] },
      { c: [-0.48, 0.19, 0.24], s: [0.05, 0.38, 0.05] },
      { c: [0.48, 0.19, 0.24], s: [0.05, 0.38, 0.05] },
    ]),
  ],
  bookshelf: () => grp(OAK, [
    { c: [-0.4, 1.0, 0], s: [0.04, 2.0, 0.3] },
    { c: [0.4, 1.0, 0], s: [0.04, 2.0, 0.3] },
    { c: [0, 0.02, 0], s: [0.84, 0.04, 0.3] },
    { c: [0, 0.5, 0], s: [0.84, 0.04, 0.3] },
    { c: [0, 1.0, 0], s: [0.84, 0.04, 0.3] },
    { c: [0, 1.5, 0], s: [0.84, 0.04, 0.3] },
    { c: [0, 1.98, 0], s: [0.84, 0.04, 0.3] },
    { c: [0, 1.0, -0.14], s: [0.84, 2.0, 0.02] },
  ]),
  tv_console: () => grp(WALNUT, [
    { c: [0, 0.25, 0], s: [1.6, 0.5, 0.4] },
    { c: [0, 0.25, 0.205], s: [1.5, 0.4, 0.01] },
  ]),
  planter: () => [
    ...grp(POT, [{ c: [0, 0.2, 0], s: [0.35, 0.4, 0.35] }]),
    ...grp(GREEN, [
      { c: [0, 0.65, 0], s: [0.5, 0.6, 0.5] },
      { c: [0.1, 0.95, 0.05], s: [0.35, 0.5, 0.35] },
    ]),
  ],
  rug: () => grp(RUG, [{ c: [0, 0.01, 0], s: [2.4, 0.02, 1.6] }]),
  cabinet_tall: () => cabinet({ width: 450, height: 2350, depth: 580 }),
};

/**
 * A carcass with a recessed front, a plinth and a bar handle, sized to the
 * item. Wall units get no plinth — they hang.
 */
function cabinet(size: { width: number; height: number; depth: number }, wallHung = false): Part[] {
  const { width: w, height: h, depth: d } = size;
  const plinth = wallHung ? 0 : 90;
  const body = h - plinth;
  const carcass: Mat = { color: '#d7d3cc', roughness: 0.55 };
  const front: Mat = { color: '#e9e5de', roughness: 0.4 };
  const parts: Part[] = [
    { c: [0, plinth + body / 2, -6], s: [w, body, d - 12], ...pbr(carcass) },
    { c: [0, plinth + body / 2, d / 2 - 9], s: [w - 6, body - 6, 18], ...pbr(front) },
  ];
  if (plinth > 0) {
    parts.push({ c: [0, plinth / 2, -20], s: [w - 20, plinth, d - 60], ...pbr({ color: '#4a4a4d', roughness: 0.8 }) });
  }
  parts.push({
    c: [0, plinth + body - 70, d / 2 + 8],
    s: [Math.min(w - 80, 400), 16, 16],
    ...pbr(METAL),
  });
  return parts;
}

const pbr = (m: Mat) => ({ color: m.color, roughness: m.roughness, metalness: m.metalness ?? 0 });

/**
 * The boxes that make up one catalogue item. Falls back to a single box the
 * size of the item, which is what the iPad does for an item with no model.
 */
export function furnitureParts(item: FurnitureItem): Part[] {
  const build = HOME_PARTS[item.id];
  if (build) return build();
  if (/^K[TFH]/.test(item.id) || /^W/.test(item.id)) {
    return cabinet(item.size, item.id.startsWith('KH'));
  }
  return [{
    c: [0, item.size.height / 2, 0],
    s: [item.size.width, item.size.height, item.size.depth],
    ...pbr({ color: '#c9c7c2', roughness: 0.7 }),
  }];
}

export const partsFor = (itemId: string): Part[] => {
  const item = furnitureItem(itemId);
  return item ? furnitureParts(item) : [];
};
