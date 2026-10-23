/**
 * Square a scanned room up with the page.
 *
 * RoomPlan measures in a world aligned to wherever the iPad faced when the
 * scan began, so a real scan arrives with every wall at some arbitrary angle,
 * in coordinates around the spot the scan started from. Opened as it came,
 * the plan was drawn crooked, the room's width and depth were read off its
 * tilted bounding box (a 6 × 5 m room offered as 7.5 × 5.8, which "Apply
 * dimensions" would then have built), and the area label landed on a wall.
 *
 * So the room is turned by the smallest angle that lines its walls up with the
 * axes, and moved so its bounding box starts at (0, 0) — where a room drawn by
 * hand starts. Openings and fixtures are placed along their walls, so they
 * need nothing; the objects in the room turn and move with it. A room that is
 * already square to the axes is only moved.
 */

import type { RoomScan, Vec2 } from '@mozu/scan-sdk';

/**
 * The walls' common direction, folded into a quarter turn: each wall votes
 * with its length for its angle modulo 90°, so a rectangle's four walls agree
 * and a short angled wall cannot outvote the long ones.
 */
export function dominantWallAngle(polygon: Vec2[]): number {
  let c = 0;
  let s = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const angle = Math.atan2(b.z - a.z, b.x - a.x);
    c += len * Math.cos(4 * angle);
    s += len * Math.sin(4 * angle);
  }
  return Math.hypot(c, s) < 1e-9 ? 0 : Math.atan2(s, c) / 4;
}

/** Below this the room is taken to be square already, and is not turned. */
const SQUARE_EPS = 1e-6;

export function squareUp(scan: RoomScan): RoomScan {
  if (scan.polygon.length < 3) return scan;
  const turn = -dominantWallAngle(scan.polygon);
  const square = Math.abs(turn) < SQUARE_EPS;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const rotate = (v: Vec2): Vec2 =>
    square ? { x: v.x, z: v.z } : { x: v.x * cos - v.z * sin, z: v.x * sin + v.z * cos };

  const turned = scan.polygon.map(rotate);
  const minX = Math.min(...turned.map((p) => p.x));
  const minZ = Math.min(...turned.map((p) => p.z));
  const place = (v: Vec2): Vec2 => {
    const r = rotate(v);
    return { x: r.x - minX, z: r.z - minZ };
  };

  return {
    ...scan,
    polygon: turned.map((p) => ({ x: p.x - minX, z: p.z - minZ })),
    objects: scan.objects.map((o) => ({
      ...o,
      center: place(o.center),
      rotation: square ? o.rotation : o.rotation + turn,
    })),
  };
}
