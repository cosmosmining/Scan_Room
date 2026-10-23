/**
 * Pure 2D floor-plane geometry (millimetres, X-right / Z-forward). No
 * dependencies and no browser APIs — safe to import anywhere (incl. SSR) and
 * trivially unit-testable.
 */
import type { Vec2 } from './types';

export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, z: a.z - b.z });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, z: a.z + b.z });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, z: a.z * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.z * b.z;
export const length = (a: Vec2): number => Math.hypot(a.x, a.z);
export const distance = (a: Vec2, b: Vec2): number => length(sub(a, b));
export const midpoint = (a: Vec2, b: Vec2): Vec2 => scale(add(a, b), 0.5);

export function normalize(a: Vec2): Vec2 {
  const l = length(a);
  return l > 1e-9 ? { x: a.x / l, z: a.z / l } : { x: 0, z: 0 };
}

/** Rotate a vector −90° about +Y. */
export const perpCW = (a: Vec2): Vec2 => ({ x: a.z, z: -a.x });
/** Rotate a vector +90° about +Y. */
export const perpCCW = (a: Vec2): Vec2 => ({ x: -a.z, z: a.x });

/** Signed polygon area; positive winding is counter-clockwise in this plane. */
export function signedArea(points: Vec2[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    area += p.x * q.z - q.x * p.z;
  }
  return area / 2;
}

/** Absolute polygon area (square millimetres). */
export const polygonArea = (points: Vec2[]): number => Math.abs(signedArea(points));

/** Total edge length of the closed polygon (millimetres). */
export function perimeter(points: Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    sum += distance(points[i], points[(i + 1) % points.length]);
  }
  return sum;
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

export interface Bounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  width: number;
  depth: number;
}

export function bounds(points: Vec2[]): Bounds {
  const xs = points.map((p) => p.x);
  const zs = points.map((p) => p.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  return { minX, minZ, maxX, maxZ, width: maxX - minX, depth: maxZ - minZ };
}

/**
 * Drop consecutive duplicate / near-collinear vertices so a hand-tapped or
 * sensor-captured trace becomes clean walls. `epsilon` (mm) is the merge radius
 * for coincident points; `straightness` is the max cross-product (mm²) below
 * which three points count as a straight run and the middle one is removed.
 */
export function simplifyPolygon(
  points: Vec2[],
  epsilon = 30,
  straightness = 6_000,
): Vec2[] {
  const merged: Vec2[] = [];
  for (const p of points) {
    const last = merged[merged.length - 1];
    if (!last || distance(last, p) > epsilon) merged.push(p);
  }
  // Merge wrap-around duplicate.
  if (merged.length > 1 && distance(merged[0], merged[merged.length - 1]) <= epsilon) {
    merged.pop();
  }
  if (merged.length < 4) return merged;

  const out: Vec2[] = [];
  const n = merged.length;
  for (let i = 0; i < n; i++) {
    const prev = merged[(i - 1 + n) % n];
    const cur = merged[i];
    const next = merged[(i + 1) % n];
    const a = sub(cur, prev);
    const b = sub(next, cur);
    const cross = Math.abs(a.x * b.z - a.z * b.x); // ‖a×b‖, mm²-ish
    if (cross > straightness) out.push(cur); // keep real corners only
  }
  return out.length >= 3 ? out : merged;
}

/** Ensure counter-clockwise winding so outward normals point out of the room. */
export function ensureCCW(points: Vec2[]): Vec2[] {
  return signedArea(points) < 0 ? [...points].reverse() : points;
}
