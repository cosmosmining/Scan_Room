/**
 * "Need advice" — the furniture recommender, ported from
 * `Design/AI/FurnitureRecommender.swift`.
 *
 * Given the room and the catalogue this produces a handful of ready-to-place
 * sets, each laid out along the room's longest wall. Pure and deterministic:
 * same room + catalogue in, same sets out. No network, no randomness — which is
 * what makes it testable and safe to call on every tap.
 *
 * LAYOUT MODEL. The longest wall is the "primary run". Items pack left to right
 * along it, each pushed inward by half its depth so its back sits against the
 * wall, and yawed so its front faces into the room. Packing stops when the next
 * item would overshoot, so a set never spills past the wall it was laid against.
 *
 * Millimetres throughout, as the rest of the web app is.
 */

import type { Room, Vec3 } from '@/lib/types';
import { FURNITURE_ITEMS, type FurnitureItem, type PlacedFurniture } from './catalog';

export interface FurnitureRecommendation {
  id: string;
  title: string;
  rationale: string;
  /** Positioned instances, base at y = 0, laid along the primary wall. */
  items: Omit<PlacedFurniture, 'id'>[];
}

interface PrimaryRun {
  start: { x: number; z: number };
  /** Unit vector along the wall, start → end. */
  along: { x: number; z: number };
  /** Unit vector into the room interior. */
  inward: { x: number; z: number };
  /** Millimetres. */
  length: number;
}

const centroid = (poly: Vec3[]) =>
  poly.length === 0
    ? { x: 0, z: 0 }
    : {
        x: poly.reduce((a, p) => a + p.x, 0) / poly.length,
        z: poly.reduce((a, p) => a + p.z, 0) / poly.length,
      };

/** The longest wall, with the geometry the layouts need. */
function primaryRun(room: Room): PrimaryRun | null {
  let best: { wall: Room['walls'][number]; length: number } | null = null;
  for (const wall of room.walls) {
    const length = Math.hypot(wall.end.x - wall.start.x, wall.end.z - wall.start.z);
    if (!best || length > best.length) best = { wall, length };
  }
  if (!best || best.length < 1) return null;

  const { wall, length } = best;
  const along = { x: (wall.end.x - wall.start.x) / length, z: (wall.end.z - wall.start.z) / length };
  const c = centroid(room.footprint);
  const mid = { x: (wall.start.x + wall.end.x) / 2, z: (wall.start.z + wall.end.z) / 2 };
  let inward = { x: -along.z, z: along.x };
  if (inward.x * (c.x - mid.x) + inward.z * (c.z - mid.z) < 0) inward = { x: -inward.x, z: -inward.z };

  return { start: { x: wall.start.x, z: wall.start.z }, along, inward, length };
}

/**
 * Yaw so an item's FRONT faces into the room. Items front their local −Z, and
 * yaw about +Y maps −Z to (sin yaw, cos yaw), so this aims −Z at the normal.
 */
const facingYaw = (inward: { x: number; z: number }) => Math.atan2(inward.x, inward.z);

function place(
  item: FurnitureItem,
  run: PrimaryRun,
  centreAlong: number,
): Omit<PlacedFurniture, 'id'> {
  const depthOffset = item.size.depth / 2;
  return {
    itemId: item.id,
    position: {
      x: run.start.x + run.along.x * centreAlong + run.inward.x * depthOffset,
      z: run.start.z + run.along.z * centreAlong + run.inward.z * depthOffset,
    },
    rotationY: facingYaw(run.inward),
  };
}

/**
 * Greedily pack `fillers` along the run, finishing with `terminator` if it
 * still fits. Space for the terminator is reserved up front, so a run never
 * packs fillers into the slot the end cabinet needs.
 */
function pack(
  run: PrimaryRun,
  fillers: FurnitureItem[],
  terminator?: FurnitureItem,
): Omit<PlacedFurniture, 'id'>[] {
  if (fillers.length === 0) return [];
  const out: Omit<PlacedFurniture, 'id'>[] = [];
  const reserve = terminator?.size.width ?? 0;
  let cursor = 0;
  let i = 0;

  for (;;) {
    const item = fillers[i % fillers.length];
    const w = item.size.width;
    if (cursor + w + reserve > run.length + 0.1) break;
    out.push(place(item, run, cursor + w / 2));
    cursor += w;
    i += 1;
  }

  if (terminator && cursor + terminator.size.width <= run.length + 0.1) {
    out.push(place(terminator, run, cursor + terminator.size.width / 2));
  }
  return out;
}

const inCategory = (category: string, catalog: FurnitureItem[]) =>
  catalog.filter((i) => i.category === category);

const widest = (items: FurnitureItem[]) =>
  items.reduce<FurnitureItem | undefined>((a, b) => (!a || b.size.width > a.size.width ? b : a), undefined);

const narrowest = (items: FurnitureItem[]) =>
  items.reduce<FurnitureItem | undefined>((a, b) => (!a || b.size.width < a.size.width ? b : a), undefined);

function firstItem(category: string, catalog: FurnitureItem[], needle?: string) {
  const pool = inCategory(category, catalog);
  if (needle) return pool.find((i) => i.name.toLowerCase().includes(needle.toLowerCase()));
  return pool[0];
}

/** Base cabinets filling the run, then a tall larder at the end if it fits. */
function kitchenLayout(run: PrimaryRun, catalog: FurnitureItem[]) {
  const filler = widest(inCategory('Kitchen · Base', catalog));
  if (!filler) return [];
  return pack(run, [filler], narrowest(inCategory('Kitchen · Tall', catalog)));
}

/** Wardrobe main cabinets filling the run, finished with a side cabinet. */
function wardrobeLayout(run: PrimaryRun, catalog: FurnitureItem[]) {
  const filler = widest(inCategory('Wardrobe · Main', catalog));
  if (!filler) return [];
  return pack(run, [filler], narrowest(inCategory('Wardrobe · Side', catalog)));
}

/** A sofa against the wall, a rug under it, a coffee table in front, a plant. */
function livingLayout(run: PrimaryRun, catalog: FurnitureItem[]) {
  const sofa = firstItem('Seating', catalog, 'Sofa') ?? firstItem('Seating', catalog);
  if (!sofa) return [];

  const out: Omit<PlacedFurniture, 'id'>[] = [];
  const sofaCentre = sofa.size.width <= run.length ? run.length / 2 : sofa.size.width / 2;
  const sofaPlaced = place(sofa, run, sofaCentre);
  out.push(sofaPlaced);

  const yaw = facingYaw(run.inward);
  const from = (offset: number) => ({
    x: sofaPlaced.position.x + run.inward.x * offset,
    z: sofaPlaced.position.z + run.inward.z * offset,
  });

  const rug = firstItem('Decor', catalog, 'Rug');
  if (rug) {
    out.push({
      itemId: rug.id,
      position: from(sofa.size.depth / 2 + rug.size.depth / 2 + 50),
      rotationY: yaw,
    });
  }

  const coffee = firstItem('Tables', catalog, 'Coffee') ?? firstItem('Tables', catalog);
  if (coffee) {
    // 450mm of walking room between the sofa front and the table.
    out.push({
      itemId: coffee.id,
      position: from(sofa.size.depth / 2 + 450 + coffee.size.depth / 2),
      rotationY: yaw,
    });
  }

  const plant = firstItem('Decor', catalog, 'Plant');
  if (plant) {
    out.push(place(plant, run, Math.max(run.length - plant.size.width / 2, plant.size.width / 2)));
  }

  return out;
}

const BUILDERS: {
  id: string;
  title: string;
  rationale: string;
  build: (run: PrimaryRun, catalog: FurnitureItem[]) => Omit<PlacedFurniture, 'id'>[];
}[] = [
  {
    id: 'rec_kitchen',
    title: 'MOZU Kitchen',
    rationale:
      'Base cabinets run the length of your longest wall, finished with a tall larder unit. Wall units sit above and are added in the editor.',
    build: kitchenLayout,
  },
  {
    id: 'rec_wardrobe',
    title: 'MOZU Wardrobe',
    rationale:
      'Full-height wardrobe modules fill the wall, with a low side cabinet to finish the run.',
    build: wardrobeLayout,
  },
  {
    id: 'rec_living',
    title: 'Living',
    rationale:
      'A sofa against the wall, a coffee table in front, a rug to anchor the zone and a plant in the corner.',
    build: livingLayout,
  },
];

/** Up to three sets laid along the room's longest wall. Empty sets are dropped. */
export function recommendFurniture(
  room: Room,
  catalog: FurnitureItem[] = FURNITURE_ITEMS,
): FurnitureRecommendation[] {
  const run = primaryRun(room);
  if (!run) return [];
  return BUILDERS.flatMap(({ id, title, rationale, build }) => {
    const items = build(run, catalog);
    return items.length > 0 ? [{ id, title, rationale, items }] : [];
  });
}
