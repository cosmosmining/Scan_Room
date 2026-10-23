import { describe, expect, it } from 'vitest';
import { createDefaultRoom } from '@/lib/defaults';
import {
  assignFixturesToWalls,
  detectWallSockets,
  projectDetectionToWall,
  type CameraFrame,
  type DetectorImage,
  type PinholeCamera,
} from '@/systems/scan';

// A camera standing in a 4000×3000 room, 1.5 m back from wall_0, looking at it.
const cam: PinholeCamera = {
  position: { x: 2000, y: 1350, z: 1500 },
  forward: { x: 0, y: 0, z: -1 },
  up: { x: 0, y: 1, z: 0 },
  fovY: 1.0,
  aspect: 4 / 3,
};

describe('detection → wall projection', () => {
  const walls = createDefaultRoom().walls;

  it('projects a centred detection to the wall straight ahead', () => {
    const hit = projectDetectionToWall({ cx: 0.5, cy: 0.5 }, cam, walls, 2700);
    expect(hit).not.toBeNull();
    expect(hit!.wallId).toBe('wall_0');
    expect(hit!.offset).toBeCloseTo(2000, 0);
    expect(hit!.height).toBeCloseTo(1350, 0);
  });

  it('maps horizontal image position to offset along the wall', () => {
    const left = projectDetectionToWall({ cx: 0.25, cy: 0.5 }, cam, walls, 2700)!;
    const right = projectDetectionToWall({ cx: 0.75, cy: 0.5 }, cam, walls, 2700)!;
    expect(left.offset).toBeLessThan(2000);
    expect(right.offset).toBeGreaterThan(2000);
  });

  it('maps vertical image position to height', () => {
    const up = projectDetectionToWall({ cx: 0.5, cy: 0.25 }, cam, walls, 2700)!;
    expect(up.height).toBeGreaterThan(1350);
  });

  it('returns null when the ray hits no wall', () => {
    expect(projectDetectionToWall({ cx: 0.5, cy: 0.5 }, cam, [], 2700)).toBeNull();
  });
});

// Build a frame whose image has a socket (white plate + dark slots) centred.
function socketFrame(): CameraFrame {
  const w = 200, h = 150;
  const data = new Uint8ClampedArray(w * h * 4).fill(180);
  for (let i = 3; i < data.length; i += 4) data[i] = 255; // alpha
  const paint = (x: number, y: number, rw: number, rh: number, val: number) => {
    for (let yy = y; yy < y + rh; yy++)
      for (let xx = x; xx < x + rw; xx++) {
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const i = (yy * w + xx) * 4;
        data[i] = data[i + 1] = data[i + 2] = val;
      }
  };
  paint(83, 53, 34, 44, 235);  // the plate, centred on (100, 75)
  paint(90, 67, 4, 12, 40);    // pin slots + ground hole
  paint(106, 67, 4, 12, 40);
  paint(98, 84, 4, 6, 40);
  const image: DetectorImage = { data, width: w, height: h };
  return { image, camera: cam };
}

describe('detectWallSockets (end-to-end engine)', () => {
  const walls = createDefaultRoom().walls;

  it('detects, projects, and merges repeats across frames', () => {
    const detected = detectWallSockets([socketFrame(), socketFrame()], walls, 2700);
    expect(detected).toHaveLength(1); // same socket seen twice → one fixture
    expect(detected[0].wallId).toBe('wall_0');
    expect(detected[0].fixture.type).toBe('socket');
    expect(detected[0].fixture.source).toBe('detected');
    expect(detected[0].fixture.offset).toBeGreaterThan(1600);
    expect(detected[0].fixture.offset).toBeLessThan(2400);
    expect(detected[0].fixture.confidence).toBeGreaterThan(0.3);
  });

  it('attaches detected sockets to the right wall', () => {
    const detected = detectWallSockets([socketFrame()], walls, 2700);
    const withFixtures = assignFixturesToWalls(walls, detected);
    const wall0 = withFixtures.find((w) => w.id === 'wall_0')!;
    expect(wall0.fixtures?.length).toBe(1);
    expect(withFixtures.find((w) => w.id === 'wall_1')?.fixtures).toBeUndefined();
  });
});
