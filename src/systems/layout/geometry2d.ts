import type { Millimeters } from '@/lib/types';

/**
 * Floor-plane geometry. Everything here is 2D in the XZ plane (millimetres);
 * the Y axis (height) is handled separately by the layout engine. Pure, no
 * dependencies — unit-testable in isolation.
 */

export interface Vec2 {
  x: number;
  z: number;
}

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, z: a.z + b.z });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, z: a.z - b.z });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, z: a.z * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.z * b.z;
export const length = (a: Vec2): number => Math.hypot(a.x, a.z);
export const distance = (a: Vec2, b: Vec2): number => length(sub(a, b));

export const normalize = (a: Vec2): Vec2 => {
  const l = length(a);
  return l > 1e-9 ? { x: a.x / l, z: a.z / l } : { x: 0, z: 0 };
};

/** Rotate −90° about +Y. */
export const perpCW = (a: Vec2): Vec2 => ({ x: a.z, z: -a.x });
/** Rotate +90° about +Y. */
export const perpCCW = (a: Vec2): Vec2 => ({ x: -a.z, z: a.x });

/** Signed polygon area; positive winding is CCW in the x-right / z-forward plane. */
export function signedArea(points: Vec2[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    area += p.x * q.z - q.x * p.z;
  }
  return area / 2;
}

export function centroid(points: Vec2[]): Vec2 {
  let cx = 0;
  let cz = 0;
  for (const p of points) {
    cx += p.x;
    cz += p.z;
  }
  const n = points.length || 1;
  return { x: cx / n, z: cz / n };
}

/** Inward unit normal of a wall segment, pointing into the polygon interior. */
export function inwardNormal(start: Vec2, end: Vec2, footprint: Vec2[]): Vec2 {
  const dir = normalize(sub(end, start));
  const candidate = perpCW(dir);
  const mid = scale(add(start, end), 0.5);
  const toInterior = sub(centroid(footprint), mid);
  return dot(candidate, toInterior) >= 0 ? candidate : perpCCW(dir);
}

/** Y-rotation (radians) mapping a module's local +Z onto the given world normal. */
export function rotationYFromNormal(normal: Vec2): number {
  return Math.atan2(normal.x, normal.z);
}

/** Oriented bounding box in the floor plane. axisX / axisZ are unit vectors. */
export interface Rect {
  center: Vec2;
  axisX: Vec2;
  axisZ: Vec2;
  halfX: Millimeters;
  halfZ: Millimeters;
}

/**
 * Separating Axis Theorem overlap test for two oriented boxes. Flush-touching
 * counts as NOT overlapping (governed by `epsilon`, in millimetres).
 */
export function rectsOverlap(a: Rect, b: Rect, epsilon = 1): boolean {
  const axes = [a.axisX, a.axisZ, b.axisX, b.axisZ];
  const d = sub(b.center, a.center);
  for (const axis of axes) {
    const ra =
      a.halfX * Math.abs(dot(axis, a.axisX)) +
      a.halfZ * Math.abs(dot(axis, a.axisZ));
    const rb =
      b.halfX * Math.abs(dot(axis, b.axisX)) +
      b.halfZ * Math.abs(dot(axis, b.axisZ));
    if (Math.abs(dot(d, axis)) > ra + rb - epsilon) return false;
  }
  return true;
}
