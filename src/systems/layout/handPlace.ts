/**
 * Where a unit lands when a person drops it — shared by the 2D plan and the 3D
 * scene so a cabinet dragged in one view sits exactly where it would in the
 * other. Two views that disagree about what a drop means is worse than either
 * one being wrong.
 *
 * Near a wall the unit SEATS against it: back to the wall, turned to face into
 * the room, at the same standoff the packer uses. Out on open floor it stays
 * where it was dropped, unturned — which is how an island gets placed.
 *
 * Millimetres, floor plane.
 */

import type { Room, Vec3 } from '@/lib/types';
import { inwardNormal, rotationYFromNormal, type Vec2 } from './geometry2d';

/** Closer than this to a wall and the unit seats against it. */
export const SNAP_REACH = 900;

export interface HandPlacement {
  position: Vec3;
  rotationY: number;
  /** The wall it seated against, or null when it was left on open floor. */
  wallId: string | null;
}

/**
 * Resolve a dropped point into a placement.
 *
 * `rotationY` keeps the unit's current yaw when nothing is near enough to snap
 * to, so nudging an island 50mm does not also spin it back to zero.
 */
export function placeByHand(
  room: Room,
  point: { x: number; z: number },
  depth: number,
  currentRotationY = 0,
): HandPlacement {
  let best: { wallId: string; x: number; z: number; distance: number; normal: Vec2 } | null = null;
  const footprint: Vec2[] = room.footprint.map((p) => ({ x: p.x, z: p.z }));

  for (const wall of room.walls) {
    const dx = wall.end.x - wall.start.x;
    const dz = wall.end.z - wall.start.z;
    const lengthSq = dx * dx + dz * dz;
    if (lengthSq < 1) continue;
    const raw = ((point.x - wall.start.x) * dx + (point.z - wall.start.z) * dz) / lengthSq;
    const t = Math.min(Math.max(raw, 0), 1);
    const cx = wall.start.x + dx * t;
    const cz = wall.start.z + dz * t;
    const distance = Math.hypot(point.x - cx, point.z - cz);
    if (best && distance >= best.distance) continue;
    best = {
      wallId: wall.id,
      x: cx,
      z: cz,
      distance,
      normal: inwardNormal(
        { x: wall.start.x, z: wall.start.z },
        { x: wall.end.x, z: wall.end.z },
        footprint,
      ),
    };
  }

  if (!best || best.distance > SNAP_REACH) {
    return { position: { x: point.x, y: 0, z: point.z }, rotationY: currentRotationY, wallId: null };
  }

  // Back against the wall: push in by half the unit's depth, so its rear face
  // is on the wall line rather than its centre.
  const half = depth / 2;
  return {
    position: {
      x: best.x + best.normal.x * half,
      y: 0,
      z: best.z + best.normal.z * half,
    },
    rotationY: rotationYFromNormal(best.normal),
    wallId: best.wallId,
  };
}
