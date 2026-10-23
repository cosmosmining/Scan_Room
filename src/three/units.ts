import type { Room } from '@/lib/types';

/**
 * The scene is authored in millimetres (matching the domain) inside a group
 * scaled by MM_TO_M, so Three.js renders in metres — better for camera,
 * lighting, and shadow precision. Camera / controls / lights live in metre
 * space (outside that group), so anything passed to them is converted here.
 */
export const MM_TO_M = 0.001;

export const mmToM = (mm: number): number => mm * MM_TO_M;

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Footprint bounds in millimetres. */
export function roomBounds(room: Room): Bounds {
  const xs = room.footprint.map((p) => p.x);
  const zs = room.footprint.map((p) => p.z);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
  };
}

/** Room centre in METRES (for camera target), lifted to eye-ish height. */
export function roomCenterM(room: Room, y = 0.9): [number, number, number] {
  const b = roomBounds(room);
  return [((b.minX + b.maxX) / 2) * MM_TO_M, y, ((b.minZ + b.maxZ) / 2) * MM_TO_M];
}
