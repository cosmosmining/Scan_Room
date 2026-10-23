import type { Vec3 } from '@/lib/types';
import { createId } from '@/lib/utils';
import type { RoomGeometry } from './types';

/**
 * The "box massing" model — the white, RoomPlan-style volume that builds up as
 * you scan (walls as slabs, furniture as boxes; the closet/wardrobe is the tall
 * box in the reference video). It is the visual artefact of Phase 1 (Spatial
 * Capture): a simplified solid the user sees forming, then rotates, before
 * "Go to planning". Pure geometry — the renderer (three) and the iOS app both
 * draw the same model.
 */

export type MassingKind = 'wall' | 'floor' | 'object';

/** One box of the massing model. */
export interface MassingBox {
  id: string;
  kind: MassingKind;
  /** Box centre in world space (mm, Y-up). */
  center: Vec3;
  /** Full extents along the box's local x / y / z (mm). */
  size: { x: number; y: number; z: number };
  /** Y rotation aligning the box's local +x with its run (radians). */
  rotationY: number;
  /** Optional semantic label (e.g. 'wardrobe', 'refrigerator'). */
  label?: string;
}

export interface MassingModel {
  boxes: MassingBox[];
  bounds: { min: Vec3; max: Vec3 };
}

/** A captured furniture footprint to include as a box (closets, appliances…). */
export interface MassingObject {
  category: string;
  center: { x: number; z: number };
  width: number;
  depth: number;
  height?: number;
  rotationY?: number;
}

/** Sensible box heights (mm) when a captured object doesn't report one. */
const OBJECT_HEIGHTS: Record<string, number> = {
  refrigerator: 1800,
  fridge: 1800,
  wardrobe: 2000,
  closet: 2000,
  cabinet: 900,
  counter: 900,
  worktop: 900,
  table: 750,
  sofa: 850,
  bed: 600,
  appliance: 850,
};

const objectHeight = (category: string, given?: number): number =>
  given ?? OBJECT_HEIGHTS[category.toLowerCase()] ?? 800;

/**
 * Build the massing model from a captured room geometry plus any detected
 * objects. Walls become oriented slabs; the floor becomes a thin slab; each
 * object becomes a labelled box. Matches `RoomShell`'s wall convention
 * (rotationY = atan2(-dz, dx)) so it renders flush with the live room.
 */
export function buildMassing(
  geometry: Pick<RoomGeometry, 'walls' | 'footprint' | 'height'>,
  objects: MassingObject[] = [],
  opts: { includeFloor?: boolean; floorThickness?: number } = {},
): MassingModel {
  const boxes: MassingBox[] = [];

  for (const wall of geometry.walls) {
    const dx = wall.end.x - wall.start.x;
    const dz = wall.end.z - wall.start.z;
    const length = Math.hypot(dx, dz);
    if (length < 1) continue;
    boxes.push({
      id: createId('mass'),
      kind: 'wall',
      center: {
        x: (wall.start.x + wall.end.x) / 2,
        y: wall.height / 2,
        z: (wall.start.z + wall.end.z) / 2,
      },
      size: { x: length, y: wall.height, z: wall.thickness },
      rotationY: Math.atan2(-dz, dx),
    });
  }

  if (opts.includeFloor !== false) {
    const b = footprintBounds(geometry.footprint);
    const thickness = opts.floorThickness ?? 60;
    boxes.push({
      id: createId('mass'),
      kind: 'floor',
      center: { x: (b.minX + b.maxX) / 2, y: -thickness / 2, z: (b.minZ + b.maxZ) / 2 },
      size: { x: b.maxX - b.minX, y: thickness, z: b.maxZ - b.minZ },
      rotationY: 0,
    });
  }

  for (const obj of objects) {
    const h = objectHeight(obj.category, obj.height);
    boxes.push({
      id: createId('mass'),
      kind: 'object',
      center: { x: obj.center.x, y: h / 2, z: obj.center.z },
      size: { x: obj.width, y: h, z: obj.depth },
      rotationY: obj.rotationY ?? 0,
      label: obj.category,
    });
  }

  return { boxes, bounds: modelBounds(boxes, geometry.footprint, geometry.height) };
}

function footprintBounds(footprint: Vec3[]) {
  const xs = footprint.map((p) => p.x);
  const zs = footprint.map((p) => p.z);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
  };
}

function modelBounds(
  boxes: MassingBox[],
  footprint: Vec3[],
  height: number,
): { min: Vec3; max: Vec3 } {
  const b = footprintBounds(footprint);
  let maxY = height;
  for (const box of boxes) maxY = Math.max(maxY, box.center.y + box.size.y / 2);
  return {
    min: { x: b.minX, y: 0, z: b.minZ },
    max: { x: b.maxX, y: maxY, z: b.maxZ },
  };
}
