import type { Room, Wall } from '@/lib/types';
import {
  distance,
  inwardNormal,
  length as vlen,
  normalize,
  sub,
  type Vec2,
} from './geometry2d';
import type {
  Blocker,
  LayoutFixture,
  LayoutObstacle,
  LayoutRules,
  WallRun,
} from './types';

const CORNER_EPS = 1; // mm tolerance for shared-corner detection

const toVec2 = (p: { x: number; z: number }): Vec2 => ({ x: p.x, z: p.z });

/**
 * Derive packing runs from a room's walls.
 *
 * The shape of the kitchen (straight / L / U / galley / wardrobe wall) is NOT
 * special-cased here — it emerges from which walls are active and how they meet.
 * Inside corners (where two active walls share an endpoint) reserve space on the
 * run whose START sits at the corner, so adjacent runs never collide.
 */
export function buildRuns(
  room: Room,
  activeWallIds: string[],
  rules: LayoutRules,
  extras: { fixtures?: LayoutFixture[]; obstacles?: LayoutObstacle[] } = {},
): Map<string, WallRun> {
  const footprint = room.footprint.map(toVec2);
  const active = room.walls.filter((w) => activeWallIds.includes(w.id));
  const runs = new Map<string, WallRun>();

  for (const wall of active) {
    const start = toVec2(wall.start);
    const end = toVec2(wall.end);
    const dir = normalize(sub(end, start));
    const normal = inwardNormal(start, end, footprint);
    const len = vlen(sub(end, start));

    // Reserve a corner at the start when another active wall ends there.
    const sharedAtStart = active.some(
      (o) => o.id !== wall.id && distance(toVec2(o.end), start) < CORNER_EPS,
    );

    runs.set(wall.id, {
      id: `run_${wall.id}`,
      wallId: wall.id,
      origin: start,
      dir,
      normal,
      length: len,
      usableStart: rules.wallGap + (sharedAtStart ? rules.cornerReserve : 0),
      usableEnd: len - rules.wallGap,
      blocked: [
        ...openingBlockers(wall, rules),
        ...fixtureBlockers(wall.id, extras.fixtures ?? [], rules),
        ...columnBlockers(start, dir, normal, len, extras.obstacles ?? []),
      ].sort((a, b) => a.start - b.start),
    });
  }

  return runs;
}

/** A door or window with no height on record is taken to be door height. */
const DEFAULT_OPENING_HEIGHT = 2100;

/**
 * Openings, with their height. A door or low window stops everything in front
 * of it, as before. A window above the sill threshold still lets base units
 * run under it, but now also stops what would stand in front of the glass —
 * wall cabinets, a hood, a tall unit — which used to be packed straight across
 * it.
 */
function openingBlockers(wall: Wall, rules: LayoutRules): Blocker[] {
  return wall.openings.map((o) => ({
    kind: 'opening' as const,
    start: o.offset,
    end: o.offset + o.width,
    bottom: o.sillHeight < rules.openingSillThreshold ? 0 : o.sillHeight,
    top: o.sillHeight + (o.height || DEFAULT_OPENING_HEIGHT),
    sourceId: o.id,
  }));
}

/**
 * Sockets, switches and pipes, with their access gap either side. Only a unit
 * at the fixture's height is stopped, so a socket above the worktop leaves the
 * base units alone, and a unit built to connect to it (a sink base over its
 * water) may still go there. The same rule {@link detectFixtureConflicts}
 * reports on, applied before packing instead of after.
 */
function fixtureBlockers(wallId: string, fixtures: LayoutFixture[], rules: LayoutRules): Blocker[] {
  return fixtures
    .filter((f) => f.wallId === wallId)
    .map((f) => {
      const clear = f.type === 'gas' ? rules.gasClearance : rules.fixtureClearance;
      return {
        kind: 'fixture' as const,
        start: f.offset - clear,
        end: f.offset + clear,
        bottom: f.height - 1,
        top: f.height + 1,
        fixtureType: f.type,
        sourceId: f.id,
      };
    });
}

/** Gap kept between a unit and a column. */
const COLUMN_GAP = 20;
/** A column further than this off a wall is in the room, not in a run's way. */
const COLUMN_REACH = 1500;

/** Points around an obstacle's footprint, in the plan. */
function outline(o: LayoutObstacle): Vec2[] {
  if (o.shape === 'round') {
    const r = o.width / 2;
    return Array.from({ length: 24 }, (_, i) => {
      const a = (i / 24) * Math.PI * 2;
      return { x: o.center.x + Math.cos(a) * r, z: o.center.z + Math.sin(a) * r };
    });
  }
  const c = Math.cos(o.rotation);
  const s = Math.sin(o.rotation);
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([u, v]) => {
    const along = (u * o.width) / 2;
    const across = (v * o.depth) / 2;
    return { x: o.center.x + c * along - s * across, z: o.center.z + s * along + c * across };
  });
}

/**
 * Columns standing at a wall, or close enough in front of it to be in the way.
 * Floor to ceiling, so every band is stopped — except a unit shallow enough to
 * fit between the wall and a column standing off it.
 */
function columnBlockers(
  origin: Vec2,
  dir: Vec2,
  normal: Vec2,
  len: number,
  obstacles: LayoutObstacle[],
): Blocker[] {
  const out: Blocker[] = [];
  for (const o of obstacles) {
    const pts = outline(o).map((p) => {
      const d = sub(p, origin);
      return { t: d.x * dir.x + d.z * dir.z, n: d.x * normal.x + d.z * normal.z };
    });
    const tMin = Math.min(...pts.map((p) => p.t));
    const tMax = Math.max(...pts.map((p) => p.t));
    const nMin = Math.min(...pts.map((p) => p.n));
    const nMax = Math.max(...pts.map((p) => p.n));
    if (nMax <= 0 || nMin > COLUMN_REACH) continue; // behind this wall, or out in the room
    if (tMax <= 0 || tMin >= len) continue; // beside the wall, not along it
    out.push({
      kind: 'column',
      start: tMin - COLUMN_GAP,
      end: tMax + COLUMN_GAP,
      fromWall: Math.max(0, nMin - COLUMN_GAP),
      sourceId: o.id,
    });
  }
  return out;
}
