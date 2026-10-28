/**
 * The heart of "scan → floorplan": turn a {@link RoomScan} (an ordered floor
 * polygon plus openings) into a {@link Floorplan} whose every wall carries its
 * auto-captured length, with floor area and perimeter computed. Pure and
 * dependency-free — the same model is rendered to SVG by `floorplanToSvg` and
 * to React by the web app.
 */
import {
  add,
  bounds as computeBounds,
  centroid,
  distance,
  ensureCCW,
  normalize,
  perimeter as computePerimeter,
  perpCW,
  polygonArea,
  scale,
  signedArea,
  simplifyPolygon,
  sub,
} from './geometry';
import { fixtureLabel } from './fixtures';
import type {
  Floorplan,
  FloorplanFixture,
  FloorplanWall,
  RoomScan,
  ScanFixture,
  ScanObject,
  ScanOpening,
  UnitSystem,
  Vec2,
} from './types';

export interface BuildFloorplanInput {
  /** Ordered, closed floor polygon (millimetres). 3+ vertices. */
  polygon: Vec2[];
  height: number;
  unitSystem: UnitSystem;
  openings?: ScanOpening[];
  objects?: ScanObject[];
  fixtures?: ScanFixture[];
  source?: RoomScan['source'];
  confidence?: number;
  /** Clean up near-duplicate / collinear vertices first (default true). */
  simplify?: boolean;
}

/** Build a dimensioned floorplan from a polygon (or a whole {@link RoomScan}). */
export function buildFloorplan(input: BuildFloorplanInput | RoomScan): Floorplan {
  const unitSystem = input.unitSystem;
  const height = input.height;
  const openings = input.openings ?? [];
  const objects = input.objects ?? [];
  const source = input.source ?? 'manual';
  const confidence = input.confidence ?? 1;
  const wantSimplify = 'simplify' in input ? input.simplify !== false : true;

  let points = input.polygon.map((p) => ({ x: p.x, z: p.z }));
  if (wantSimplify) points = simplifyPolygon(points);
  // Orient CCW so per-wall outward normals reliably face out of the room.
  points = ensureCCW(points);

  const ccw = signedArea(points) > 0;
  const walls: FloorplanWall[] = points.map((start, i) => {
    const end = points[(i + 1) % points.length];
    const dir = normalize(sub(end, start));
    // For CCW polygons the outward normal is the clockwise perpendicular.
    const outward = ccw ? perpCW(dir) : { x: -perpCW(dir).x, z: -perpCW(dir).z };
    return {
      index: i,
      start,
      end,
      length: distance(start, end),
      angle: Math.atan2(end.z - start.z, end.x - start.x),
      outward,
    };
  });

  // `points` may have been simplified and/or re-wound CCW, so an incoming
  // `wall` index no longer necessarily refers to the same edge. Re-anchor
  // everything wall-mounted by its real position on the ORIGINAL polygon.
  const sourcePolygon = input.polygon.map((p) => ({ x: p.x, z: p.z }));

  const b = computeBounds(points);
  return {
    points,
    walls,
    openings: remapOpenings(openings, sourcePolygon, walls),
    objects,
    fixtures: placeFixtures(input.fixtures ?? [], sourcePolygon, walls),
    areaMm2: polygonArea(points),
    perimeterMm: computePerimeter(points),
    height,
    bounds: b,
    unitSystem,
    source,
    confidence,
  };
}

/** World point at `offset` along edge `edge` of a polygon (null if no such edge). */
function pointOnEdge(poly: Vec2[], edge: number, offset: number): Vec2 | null {
  if (!Number.isInteger(edge) || edge < 0 || edge >= poly.length) return null;
  const start = poly[edge];
  const end = poly[(edge + 1) % poly.length];
  const len = distance(start, end);
  if (len < 1e-6) return null;
  const dir = normalize(sub(end, start));
  return add(start, scale(dir, Math.max(0, Math.min(offset, len))));
}

/**
 * Anchor a world point to the plan's walls: the nearest wall segment, and how
 * far along that wall the point sits. Immune to the polygon being re-wound or
 * simplified, which is exactly what `buildFloorplan` may have just done.
 */
function nearestWall(p: Vec2, walls: FloorplanWall[]): { wall: number; offset: number } | null {
  let best: { wall: number; offset: number; d: number } | null = null;
  for (const w of walls) {
    if (w.length < 1e-6) continue;
    const dir = normalize(sub(w.end, w.start));
    const t = Math.max(0, Math.min(w.length, dot2(sub(p, w.start), dir)));
    const proj = add(w.start, scale(dir, t));
    const d = distance(p, proj);
    if (!best || d < best.d) best = { wall: w.index, offset: t, d };
  }
  return best ? { wall: best.wall, offset: best.offset } : null;
}

const dot2 = (a: Vec2, b: Vec2): number => a.x * b.x + a.z * b.z;

/**
 * Re-index openings onto the (possibly re-wound) plan walls. An opening is
 * anchored by its MIDPOINT so a reversed wall keeps it in the right place, then
 * its start offset is recovered from that midpoint.
 */
function remapOpenings(
  openings: ScanOpening[],
  source: Vec2[],
  walls: FloorplanWall[],
): ScanOpening[] {
  const out: ScanOpening[] = [];
  for (const op of openings) {
    const mid = pointOnEdge(source, op.wall, op.offset + op.width / 2);
    if (!mid) continue;
    const hit = nearestWall(mid, walls);
    if (!hit) continue;
    out.push({ ...op, wall: hit.wall, offset: Math.max(0, hit.offset - op.width / 2) });
  }
  return out;
}

/**
 * Resolve each fixture onto the plan: find where it really sits on the original
 * polygon, re-anchor it to the matching plan wall, carry the inward normal so a
 * renderer can push the marker off the wall into the room, and bake the label.
 *
 * A fixture naming a wall the scan doesn't have is dropped rather than drawn in
 * the wrong place.
 */
function placeFixtures(
  fixtures: ScanFixture[],
  source: Vec2[],
  walls: FloorplanWall[],
): FloorplanFixture[] {
  const out: FloorplanFixture[] = [];
  for (const f of fixtures) {
    const p = pointOnEdge(source, f.wall, f.offset);
    if (!p) continue;
    const hit = nearestWall(p, walls);
    if (!hit) continue;
    const wall = walls[hit.wall];
    out.push({
      ...f,
      wall: hit.wall,
      offset: hit.offset,
      point: p,
      inward: { x: -wall.outward.x, z: -wall.outward.z },
      text: fixtureLabel(f),
    });
  }
  return out;
}

/** Centre of the plan's corners (millimetres). */
export const floorplanCenter = (fp: Floorplan): Vec2 => centroid(fp.points);

function insidePolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function distanceToWalls(p: Vec2, poly: Vec2[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const len2 = abx * abx + abz * abz;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2)) : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + abx * t), p.z - (a.z + abz * t)));
  }
  return best;
}

/**
 * Where the area label goes: the point of the floor furthest from every wall.
 * The centre of the corners is outside an L-shaped room, or on the wall of
 * its inside corner — which is where the label used to be drawn. A coarse grid
 * over the plan, then a finer one around the best cell; plenty for a label.
 */
export function floorplanLabelPoint(fp: Floorplan): Vec2 {
  const poly = fp.points;
  const fallback = centroid(poly);
  if (poly.length < 3) return fallback;
  const b = computeBounds(poly);
  let best = insidePolygon(fallback, poly) ? fallback : null;
  let bestD = best ? distanceToWalls(best, poly) : -1;
  let cx = (b.minX + b.maxX) / 2;
  let cz = (b.minZ + b.maxZ) / 2;
  let hx = b.width / 2;
  let hz = b.depth / 2;
  const N = 24;
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N; j++) {
        const p = { x: cx - hx + (2 * hx * i) / N, z: cz - hz + (2 * hz * j) / N };
        if (!insidePolygon(p, poly)) continue;
        const d = distanceToWalls(p, poly);
        if (d > bestD + 1e-6) {
          best = p;
          bestD = d;
        }
      }
    }
    if (!best) break;
    // Refine around the best point found.
    cx = best.x;
    cz = best.z;
    hx = (2 * hx) / N;
    hz = (2 * hz) / N;
  }
  return best ?? fallback;
}

/** Wrap an ordered polygon (e.g. a tap-trace or AR corners) as a RoomScan. */
export function polygonScan(
  polygon: Vec2[],
  height: number,
  unitSystem: UnitSystem,
  source: RoomScan['source'] = 'manual',
  confidence = 0.7,
): RoomScan {
  return {
    schema: 'mozu.roomscan/1',
    polygon: polygon.map((p) => ({ x: p.x, z: p.z })),
    height,
    openings: [],
    objects: [],
    source,
    unitSystem,
    confidence,
    capturedAt: new Date().toISOString(),
  };
}

/**
 * A rectangle's W × D × H, convenient for the manual / bounding-box path. The
 * polygon is axis-aligned starting at the origin.
 */
export function rectangleScan(
  width: number,
  depth: number,
  height: number,
  unitSystem: UnitSystem,
  source: RoomScan['source'] = 'manual',
): RoomScan {
  return {
    schema: 'mozu.roomscan/1',
    polygon: [
      { x: 0, z: 0 },
      { x: width, z: 0 },
      { x: width, z: depth },
      { x: 0, z: depth },
    ],
    height,
    openings: [],
    objects: [],
    source,
    unitSystem,
    confidence: source === 'manual' ? 1 : 0.9,
    capturedAt: new Date().toISOString(),
  };
}
