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

/** Even-odd point-in-polygon test in the floor plane. */
export function pointInPolygon(p: Vec2, polygon: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** How far off a wall's midpoint {@link inwardNormal} looks for the room. */
const SIDE_PROBE_MM = 5;

/**
 * Inward unit normal of a wall segment, pointing into the polygon interior.
 *
 * Decided by stepping a few millimetres off the wall's midpoint each way and
 * asking which step lands inside the room. It used to point at the centroid,
 * which is only right for convex rooms: in an L-shaped room the centroid sits
 * on the wrong side of the walls around the inside corner, and cabinets were
 * packed against those walls facing out of the room — outside it. Real scans
 * are often not convex, and their corners can be listed either way round.
 */
export function inwardNormal(start: Vec2, end: Vec2, footprint: Vec2[]): Vec2 {
  const dir = normalize(sub(end, start));
  const cw = perpCW(dir);
  const ccw = perpCCW(dir);
  const mid = scale(add(start, end), 0.5);
  if (footprint.length >= 3) {
    const inCw = pointInPolygon(add(mid, scale(cw, SIDE_PROBE_MM)), footprint);
    const inCcw = pointInPolygon(add(mid, scale(ccw, SIDE_PROBE_MM)), footprint);
    if (inCw !== inCcw) return inCw ? cw : ccw;
  }
  // A wall that is not on the outline (or a degenerate one): best guess.
  const toInterior = sub(centroid(footprint), mid);
  return dot(cw, toInterior) >= 0 ? cw : ccw;
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
