import { describe, expect, it } from 'vitest';
import { createDefaultRoom } from '@/lib/defaults';
import { placeByHand, SNAP_REACH } from '../handPlace';

// 4000 × 3000 mm, corners (0,0) (4000,0) (4000,3000) (0,3000).
const room = createDefaultRoom();
const DEPTH = 600;

describe('placeByHand', () => {
  it('seats a unit dropped near a wall against it, back to the wall', () => {
    // Dropped 200mm in from the z = 0 wall, halfway along.
    const p = placeByHand(room, { x: 2000, z: 200 }, DEPTH);
    expect(p.wallId).toBe('wall_0');
    // Pushed in by half its depth, so its REAR face is on the wall line.
    expect(p.position.z).toBeCloseTo(DEPTH / 2, 5);
    expect(p.position.x).toBeCloseTo(2000, 5);
    expect(p.position.y).toBe(0);
  });

  it('turns it to face into the room', () => {
    const near = placeByHand(room, { x: 2000, z: 200 }, DEPTH);
    const far = placeByHand(room, { x: 2000, z: 2800 }, DEPTH);
    // Opposite walls face opposite ways — a half turn apart.
    const delta = Math.abs(near.rotationY - far.rotationY);
    expect(Math.min(delta, Math.abs(delta - 2 * Math.PI))).toBeCloseTo(Math.PI, 5);
  });

  it('leaves a unit dropped in open floor exactly where it was put', () => {
    // The centre of this room is 1500mm from the nearest wall — well beyond
    // reach — so an island stays an island.
    expect(SNAP_REACH).toBeLessThan(1500);
    const p = placeByHand(room, { x: 2000, z: 1500 }, DEPTH, 0.7);
    expect(p.wallId).toBeNull();
    expect(p.position.x).toBe(2000);
    expect(p.position.z).toBe(1500);
    // And keeps its yaw, so nudging an island does not also spin it to zero.
    expect(p.rotationY).toBe(0.7);
  });

  it('picks the nearest wall when two are in reach', () => {
    // Near the (0,0) corner: closer to the z = 0 wall than the x = 0 wall.
    expect(placeByHand(room, { x: 600, z: 100 }, DEPTH).wallId).toBe('wall_0');
    expect(placeByHand(room, { x: 100, z: 600 }, DEPTH).wallId).toBe('wall_3');
  });

  it('does not fall over on a room with no walls', () => {
    const p = placeByHand({ ...room, walls: [] }, { x: 10, z: 20 }, DEPTH, 1.2);
    expect(p).toEqual({ position: { x: 10, y: 0, z: 20 }, rotationY: 1.2, wallId: null });
  });
});
