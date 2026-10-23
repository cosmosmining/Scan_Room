import type { Room, Vec3, Wall } from './types';
import { createId } from './utils';

/**
 * A plain rectangular room used to seed the configurator. The full room-setup
 * flow (manual editor + AR scan) replaces this in a later step; both produce
 * the same {@link Room} contract.
 */
export function createDefaultRoom(): Room {
  const width = 4000; // mm
  const depth = 3000; // mm
  const height = 2700; // mm
  const now = new Date().toISOString();

  const corners: Vec3[] = [
    { x: 0, y: 0, z: 0 },
    { x: width, y: 0, z: 0 },
    { x: width, y: 0, z: depth },
    { x: 0, y: 0, z: depth },
  ];

  const walls: Wall[] = corners.map((start, i) => ({
    id: `wall_${i}`,
    start,
    end: corners[(i + 1) % corners.length],
    height,
    thickness: 100,
    openings: [],
  }));

  return {
    id: createId('room'),
    name: 'My Room',
    footprint: corners,
    walls,
    height,
    unitSystem: 'metric',
    source: 'manual',
    createdAt: now,
    updatedAt: now,
  };
}
