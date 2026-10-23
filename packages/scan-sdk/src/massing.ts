/**
 * Massing model — the white "box scan" volume that builds up during a LiDAR
 * capture (walls as slabs, the floor as a thin slab, detected furniture — the
 * closet — as boxes). Shared so the iOS RoomPlan app, the browser extensions and
 * the web app all render the same model from one {@link RoomScan}.
 *
 * Millimetres, Y-up. The wall convention (rotationY = atan2(-dz, dx)) matches the
 * MOZU web app's `RoomShell`/`MassingModel`, so the box model renders flush with
 * the live room everywhere.
 */
import { bounds as polygonBounds } from './geometry';
import type { Millimeters, RoomScan, ScanObject } from './types';

export type MassingKind = 'wall' | 'floor' | 'object';

export interface MassingVec3 {
  x: Millimeters;
  y: Millimeters;
  z: Millimeters;
}

export interface MassingBox {
  kind: MassingKind;
  center: MassingVec3;
  size: { x: Millimeters; y: Millimeters; z: Millimeters };
  /** Y rotation aligning the box's local +x with its run (radians). */
  rotationY: number;
  label?: string;
}

export interface MassingModel {
  boxes: MassingBox[];
  bounds: { min: MassingVec3; max: MassingVec3 };
}

const DEFAULT_WALL_THICKNESS = 100;

const OBJECT_HEIGHTS: Record<string, number> = {
  refrigerator: 1800,
  fridge: 1800,
  wardrobe: 2000,
  closet: 2000,
  storage: 1800,
  cabinet: 900,
  counter: 900,
  table: 750,
  sofa: 850,
  bed: 600,
};

const objectHeight = (o: ScanObject): number =>
  o.height ?? OBJECT_HEIGHTS[o.category.toLowerCase()] ?? 800;

/**
 * Build the box massing model from a scan: a slab per polygon edge (wall), a
 * floor slab, and a labelled box per detected object.
 */
export function buildMassing(
  scan: RoomScan,
  opts: { wallThickness?: Millimeters; includeFloor?: boolean } = {},
): MassingModel {
  const thickness = opts.wallThickness ?? DEFAULT_WALL_THICKNESS;
  const boxes: MassingBox[] = [];

  const poly = scan.polygon;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    if (length < 1) continue;
    boxes.push({
      kind: 'wall',
      center: { x: (a.x + b.x) / 2, y: scan.height / 2, z: (a.z + b.z) / 2 },
      size: { x: length, y: scan.height, z: thickness },
      rotationY: Math.atan2(-dz, dx),
    });
  }

  const bounds = polygonBounds(poly);
  if (opts.includeFloor !== false) {
    boxes.push({
      kind: 'floor',
      center: {
        x: (bounds.minX + bounds.maxX) / 2,
        y: -30,
        z: (bounds.minZ + bounds.maxZ) / 2,
      },
      size: { x: bounds.maxX - bounds.minX, y: 60, z: bounds.maxZ - bounds.minZ },
      rotationY: 0,
    });
  }

  let maxY = scan.height;
  for (const obj of scan.objects) {
    const h = objectHeight(obj);
    maxY = Math.max(maxY, h);
    boxes.push({
      kind: 'object',
      center: { x: obj.center.x, y: h / 2, z: obj.center.z },
      size: { x: obj.width, y: h, z: obj.depth },
      rotationY: obj.rotation,
      label: obj.category,
    });
  }

  return {
    boxes,
    bounds: {
      min: { x: bounds.minX, y: 0, z: bounds.minZ },
      max: { x: bounds.maxX, y: maxY, z: bounds.maxZ },
    },
  };
}
