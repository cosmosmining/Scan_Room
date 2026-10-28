/**
 * The furniture catalogue — `apps/ios/MozuScanner/Design/Model/Catalog.swift`
 * and `MozuModels.swift`, in millimetres.
 *
 * The iPad's design mode places furniture freely inside the scanned room: real
 * MOZU cabinets (KT/KF/KH/W, whose sizes are the true bounding boxes from each
 * model's STEP file) plus a set of home furnishings so a scanned room can be
 * furnished, not just fitted. The web had no equivalent at all, so a room
 * designed on an iPad could not be opened, checked, or changed on a laptop.
 *
 * Sizes are `width × height × depth` in millimetres — the web app's unit —
 * converted once here from the metres the Swift catalogue is authored in.
 */

import type { SurfaceFinish } from '@/systems/aesthetic/finishes';
import type { LayoutObstacle } from '@/systems/layout/types';

export interface FurnitureItem {
  id: string;
  name: string;
  /** Display grouping, e.g. "Kitchen · Base", "Seating". */
  category: string;
  /** Width × height × depth, millimetres. */
  size: { width: number; height: number; depth: number };
  /** Default finish when first placed; undefined keeps the part colours. */
  defaultFinish?: SurfaceFinish;
}

/** A furniture instance placed in the room — the iPad's `PlacedFurniture`. */
export interface PlacedFurniture {
  id: string;
  itemId: string;
  /** Floor point under the footprint centre, millimetres. Base sits at y = 0. */
  position: { x: number; z: number };
  /** Yaw about +Y, radians. */
  rotationY: number;
  /** Per-instance finish override; undefined keeps the item's own materials. */
  finish?: SurfaceFinish;
  /**
   * A MEASURED size, for a piece the scan found rather than one picked from the
   * catalogue. A scanned sofa is whatever size that sofa is; forcing it to the
   * catalogue's sofa would be inventing a measurement, and the whole point of
   * carrying it over is that it is a measurement.
   */
  size?: { width: number; height: number; depth: number };
  /** What the scan called it, e.g. "sofa" — shown instead of a catalogue name. */
  label?: string;
  /** True when this came from a scan. Drawn as a measurement, not a product. */
  scanned?: boolean;
  /**
   * Set for a scanned COLUMN: structure, not furniture. Drawn solid in the wall
   * finish, kept by "Clear all", and round when the scan says it is round.
   */
  column?: 'round' | 'box';
}

/**
 * A local footprint offset turned by a yaw about +Y, into room (x, z) — the
 * SAME turn three.js applies for `rotation.y` (local +X → (cos, −sin)).
 *
 * The plan used to turn furniture the ordinary 2D way, (cos, +sin): the
 * opposite sense. At 90° steps a box looks identical either way, which is how
 * it survived, but every front tick pointed backwards — a sofa set against the
 * left wall faced INTO the wall — and any other angle was mirrored between the
 * plan and the 3D view. Every view of a placed piece goes through this.
 */
export function yawOffset(local: { x: number; z: number }, rotationY: number): { x: number; z: number } {
  const c = Math.cos(rotationY);
  const s = Math.sin(rotationY);
  return { x: local.x * c + local.z * s, z: -local.x * s + local.z * c };
}

/** The catalogue item behind a placed piece — absent for a scanned one. */
export const SCANNED_ITEM_ID = '__scanned__';

/**
 * The columns among the placed pieces, as the obstacles the cabinet layout
 * packs clear of. Only columns: they are structure. The rest of the scanned
 * furniture is mostly going out before the kitchen goes in.
 */
export function columnObstacles(items: PlacedFurniture[]): LayoutObstacle[] {
  return items
    .filter((i) => i.column && i.size)
    .map((i) => ({
      id: i.id,
      center: { x: i.position.x, z: i.position.z },
      width: i.size!.width,
      depth: i.size!.depth,
      // A placed piece's yaw turns the other way from the plan-sense yaw the
      // scan (and the layout) use — see `applyRoomGeometry`.
      rotation: -i.rotationY,
      shape: i.column === 'round' ? ('round' as const) : ('box' as const),
    }));
}

/**
 * The size to draw a placed piece at: its measured size when it has one, else
 * its catalogue size. Every view must go through this, or a scanned object is
 * hit-tested at one size and drawn at another.
 */
export function placedSize(placed: PlacedFurniture): { width: number; height: number; depth: number } {
  if (placed.size) return placed.size;
  const item = FURNITURE_ITEMS.find((i) => i.id === placed.itemId);
  return item?.size ?? { width: 600, height: 600, depth: 600 };
}

/** What to call a placed piece on screen. */
export function placedName(placed: PlacedFurniture): string {
  if (placed.label) return placed.label;
  return FURNITURE_ITEMS.find((i) => i.id === placed.itemId)?.name ?? placed.itemId;
}

const m = (w: number, h: number, d: number) => ({
  width: Math.round(w * 1000),
  height: Math.round(h * 1000),
  depth: Math.round(d * 1000),
});

/** `MozuModels.items` — the real product range. */
export const MOZU_ITEMS: FurnitureItem[] = [
  { id: 'KT01', name: 'Tall Cabinet KT01', category: 'Kitchen · Tall', size: m(0.605, 2.35, 0.936) },
  { id: 'KT02', name: 'Tall Cabinet KT02', category: 'Kitchen · Tall', size: m(0.605, 2.35, 1.128) },
  { id: 'KT03', name: 'Tall Cabinet KT03', category: 'Kitchen · Tall', size: m(0.604, 2.35, 0.759) },
  { id: 'KT04', name: 'Tall Cabinet KT04', category: 'Kitchen · Tall', size: m(0.6, 2.35, 0.842) },
  { id: 'KT05', name: 'Tall Cabinet KT05', category: 'Kitchen · Tall', size: m(0.603, 2.35, 1.167) },
  { id: 'KT06', name: 'Tall Cabinet KT06', category: 'Kitchen · Tall', size: m(0.906, 2.35, 0.835) },
  { id: 'KF01', name: 'Base Cabinet KF01', category: 'Kitchen · Base', size: m(0.455, 0.8, 0.6) },
  { id: 'KF02', name: 'Base Cabinet KF02', category: 'Kitchen · Base', size: m(0.455, 0.8, 0.607) },
  { id: 'KF03', name: 'Base Cabinet KF03', category: 'Kitchen · Base', size: m(0.45, 0.8, 0.601) },
  { id: 'KF04', name: 'Base Cabinet KF04', category: 'Kitchen · Base', size: m(0.564, 0.66, 0.477) },
  { id: 'KF05', name: 'Base Cabinet KF05', category: 'Kitchen · Base', size: m(0.9, 0.832, 0.614) },
  { id: 'KF06', name: 'Base Cabinet KF06', category: 'Kitchen · Base', size: m(0.9, 0.8, 0.6) },
  { id: 'KF07', name: 'Base Cabinet KF07', category: 'Kitchen · Base', size: m(0.9, 0.8, 0.6) },
  { id: 'KF08', name: 'Base Cabinet KF08', category: 'Kitchen · Base', size: m(1, 0.8, 0.6) },
  { id: 'KH01', name: 'Wall Cabinet KH01', category: 'Kitchen · Wall', size: m(0.455, 0.8, 0.597) },
  { id: 'KH02', name: 'Wall Cabinet KH02', category: 'Kitchen · Wall', size: m(0.909, 0.8, 0.537) },
  { id: 'KH03', name: 'Wall Cabinet KH03', category: 'Kitchen · Wall', size: m(0.455, 0.8, 0.597) },
  { id: 'KH04', name: 'Wall Cabinet KH04', category: 'Kitchen · Wall', size: m(0.9, 0.71, 0.333) },
  { id: 'W04', name: 'Wardrobe W04', category: 'Wardrobe · Main', size: m(0.56, 2.4, 0.9) },
  { id: 'W05', name: 'Wardrobe W05', category: 'Wardrobe · Main', size: m(0.58, 2.4, 0.9) },
  { id: 'W06', name: 'Wardrobe W06', category: 'Wardrobe · Main', size: m(0.58, 2.4, 0.9) },
  { id: 'W07', name: 'Wardrobe W07', category: 'Wardrobe · Main', size: m(0.58, 2.4, 0.9) },
  { id: 'W08', name: 'Wardrobe W08', category: 'Wardrobe · Main', size: m(0.58, 2.4, 0.9) },
  { id: 'W09', name: 'Wardrobe W09', category: 'Wardrobe · Main', size: m(0.58, 2.4, 0.9) },
  { id: 'W10', name: 'Wardrobe W10', category: 'Wardrobe · Main', size: m(0.56, 2.4, 0.9) },
  { id: 'W_ADJ1', name: 'Side Cabinet ADJ1', category: 'Wardrobe · Side', size: m(0.45, 0.5, 0.58) },
  { id: 'W_ADJ2', name: 'Side Cabinet ADJ2', category: 'Wardrobe · Side', size: m(0.9, 0.5, 0.58) },
  { id: 'W01', name: 'Side Cabinet W01', category: 'Wardrobe · Side', size: m(0.53, 2.35, 0.3) },
  { id: 'W02', name: 'Side Cabinet W02', category: 'Wardrobe · Side', size: m(0.45, 2.35, 0.58) },
  { id: 'W03', name: 'Side Cabinet W03', category: 'Wardrobe · Side', size: m(0.45, 2.35, 0.58) },
];

/** `FurnitureCatalog.homeItems` — the generated home furnishings. */
export const HOME_ITEMS: FurnitureItem[] = [
  { id: 'cabinet_tall', name: 'Tall Wardrobe', category: 'Storage', size: m(0.45, 2.35, 0.58) },
  { id: 'bookshelf', name: 'Oak Bookshelf', category: 'Storage', size: m(0.84, 2.0, 0.3) },
  { id: 'tv_console', name: 'TV Console', category: 'Storage', size: m(1.6, 0.5, 0.41) },
  { id: 'sofa_3seat', name: '3-Seat Sofa', category: 'Seating', size: m(2.12, 0.9, 0.95) },
  { id: 'dining_chair', name: 'Dining Chair', category: 'Seating', size: m(0.45, 0.925, 0.45) },
  { id: 'dining_table', name: 'Dining Table', category: 'Tables', size: m(1.5, 0.755, 0.85) },
  { id: 'coffee_table', name: 'Coffee Table', category: 'Tables', size: m(1.1, 0.43, 0.6) },
  { id: 'bed_queen', name: 'Queen Bed', category: 'Bedroom', size: m(1.7, 1.05, 2.1) },
  { id: 'planter', name: 'Plant', category: 'Decor', size: m(0.525, 1.2, 0.5) },
  { id: 'rug', name: 'Area Rug', category: 'Decor', size: m(2.4, 0.02, 1.6) },
];

export const FURNITURE_ITEMS: FurnitureItem[] = [...MOZU_ITEMS, ...HOME_ITEMS];

/** `FurnitureCatalog.categories`, in the iPad's order. */
export const FURNITURE_CATEGORIES: string[] = [
  'Kitchen · Base', 'Kitchen · Wall', 'Kitchen · Tall',
  'Wardrobe · Main', 'Wardrobe · Side',
  'Seating', 'Tables', 'Storage', 'Bedroom', 'Decor',
];

export const furnitureItem = (id: string): FurnitureItem | undefined =>
  FURNITURE_ITEMS.find((i) => i.id === id);

/**
 * The real model, converted from the iPad's own USDZ by
 * `scripts/usdz-to-glb.py` — same geometry, same materials, same size. Three.js
 * cannot read USDZ and 29 of the 40 are binary USD crate files, so the
 * conversion runs once and its output is committed; nobody needs USD tooling to
 * build the site.
 *
 * Authored in millimetres with the base at y = 0 and the footprint centred, so
 * it drops straight onto a `PlacedFurniture.position`.
 */
export const furnitureModelUrl = (id: string): string => `/models/mozu/${id}.glb`;

export const furnitureIn = (category: string): FurnitureItem[] =>
  FURNITURE_ITEMS.filter((i) => i.category === category);
