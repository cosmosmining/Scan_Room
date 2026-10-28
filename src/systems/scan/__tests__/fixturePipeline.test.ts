import { describe, expect, it } from 'vitest';
import { createDefaultRoom } from '@/lib/defaults';
import {
  assignFixturesToWalls,
  detectWallFixtures,
  detectWallSockets,
  type CameraFrame,
  type DetectorImage,
  type PinholeCamera,
} from '@/systems/scan';
import { roomToFloorplan } from '@/systems/scan/floorplan';

/**
 * End-to-end: painted camera frames → detection → millimetre sizing via the
 * ray-cast distance → classification → wall attachment → labelled floor plan.
 *
 * Geometry: the default room is 4000 × 3000 × 2700 and `wall_0` runs from
 * (0,0) to (4000,0). The camera stands 1500mm back from it, looking at it.
 * With fovY = 1.0 and a 640×480 frame, one pixel of apparent width is
 * 2 · 1500 · tan(0.5) · (4/3) / 640 ≈ 3.41mm, so a 32px run is ~110mm (a soil
 * stack) and a 6px run is ~20mm (supply pipework).
 */
const DISTANCE = 1500;
const IMG_W = 640;
const IMG_H = 480;

const camera: PinholeCamera = {
  position: { x: 2000, y: 1350, z: DISTANCE },
  forward: { x: 0, y: 0, z: -1 },
  up: { x: 0, y: 1, z: 0 },
  fovY: 1.0,
  aspect: IMG_W / IMG_H,
};

const mmPerPx = (2 * DISTANCE * Math.tan(0.5) * (IMG_W / IMG_H)) / IMG_W;

function blankWall(bg = 205): DetectorImage {
  const data = new Uint8ClampedArray(IMG_W * IMG_H * 4);
  for (let i = 0; i < IMG_W * IMG_H; i++) {
    data[i * 4] = bg; data[i * 4 + 1] = bg; data[i * 4 + 2] = bg; data[i * 4 + 3] = 255;
  }
  return { data, width: IMG_W, height: IMG_H };
}

function paintVerticalPipe(
  img: DetectorImage,
  cx: number,
  widthPx: number,
  tint: [number, number, number] = [95, 95, 100],
) {
  for (let y = 4; y < IMG_H - 4; y++) {
    for (let d = -widthPx / 2; d < widthPx / 2; d++) {
      const x = Math.round(cx + d);
      if (x < 0 || x >= IMG_W) continue;
      const k = 1 - Math.abs(d) / (widthPx / 2);
      const shade = 0.72 + 0.42 * k;
      const i = (y * IMG_W + x) * 4;
      img.data[i] = tint[0] * shade;
      img.data[i + 1] = tint[1] * shade;
      img.data[i + 2] = tint[2] * shade;
    }
  }
}

const frameWith = (paint: (img: DetectorImage) => void): CameraFrame => {
  const image = blankWall();
  paint(image);
  return { image, camera };
};

describe('scan → detect → size → label → floor plan', () => {
  const walls = createDefaultRoom().walls;

  it('detects a fat pipe, sizes it, and calls it waste', () => {
    const widthPx = Math.round(110 / mmPerPx); // ≈ 32px
    const frame = frameWith((img) => paintVerticalPipe(img, 200, widthPx));

    const found = detectWallFixtures([frame], walls, 2700);
    const waste = found.find((f) => f.fixture.type === 'waste');
    expect(waste).toBeDefined();
    expect(waste!.wallId).toBe('wall_0');
    expect(waste!.fixture.diameterMm).toBeGreaterThan(85);
    expect(waste!.fixture.diameterMm).toBeLessThan(135);
    expect(waste!.fixture.source).toBe('detected');
    expect(waste!.fixture.reason).toContain('mm');
  });

  it('detects small-bore pipework and calls it water', () => {
    const widthPx = Math.round(20 / mmPerPx); // ≈ 6px
    const frame = frameWith((img) => paintVerticalPipe(img, 300, widthPx));

    const found = detectWallFixtures([frame], walls, 2700);
    const water = found.find((f) => f.fixture.type === 'water');
    expect(water).toBeDefined();
    expect(water!.fixture.diameterMm).toBeLessThan(32);
  });

  it('uses colour to separate gas from water at the same bore', () => {
    const widthPx = Math.round(24 / mmPerPx);
    const grey = frameWith((img) => paintVerticalPipe(img, 300, widthPx, [95, 95, 100]));
    const yellow = frameWith((img) => paintVerticalPipe(img, 300, widthPx, [215, 195, 40]));

    const asWater = detectWallFixtures([grey], walls, 2700);
    const asGas = detectWallFixtures([yellow], walls, 2700);
    expect(asWater.some((f) => f.fixture.type === 'water')).toBe(true);
    expect(asGas.some((f) => f.fixture.type === 'gas')).toBe(true);
  });

  it('rejects an architrave-sized band as not pipework', () => {
    // 150mm wide — wider than any domestic pipe, so it must not be reported.
    const widthPx = Math.round(150 / mmPerPx);
    const frame = frameWith((img) => paintVerticalPipe(img, 320, widthPx));
    const found = detectWallFixtures([frame], walls, 2700);
    expect(found.filter((f) => f.fixture.type !== 'socket')).toHaveLength(0);
  });

  it('finds two different services in one frame', () => {
    const frame = frameWith((img) => {
      paintVerticalPipe(img, 150, Math.round(110 / mmPerPx));
      paintVerticalPipe(img, 480, Math.round(20 / mmPerPx));
    });
    const types = detectWallFixtures([frame], walls, 2700).map((f) => f.fixture.type);
    expect(types).toContain('waste');
    expect(types).toContain('water');
  });

  it('merges the same pipe seen in several frames into one fixture', () => {
    const make = () => frameWith((img) => paintVerticalPipe(img, 200, Math.round(110 / mmPerPx)));
    const found = detectWallFixtures([make(), make(), make()], walls, 2700);
    expect(found.filter((f) => f.fixture.type === 'waste')).toHaveLength(1);
  });

  it('socket-only detection ignores pipework', () => {
    const frame = frameWith((img) => paintVerticalPipe(img, 200, Math.round(110 / mmPerPx)));
    expect(detectWallSockets([frame], walls, 2700)).toHaveLength(0);
  });

  it('puts what it found onto the floor plan, labelled', () => {
    const frame = frameWith((img) => paintVerticalPipe(img, 200, Math.round(110 / mmPerPx)));
    const found = detectWallFixtures([frame], walls, 2700);
    expect(found.length).toBeGreaterThan(0);

    const room = createDefaultRoom();
    room.walls = assignFixturesToWalls(room.walls, found);
    const plan = roomToFloorplan(room);

    expect(plan.fixtures.length).toBe(found.length);
    const waste = plan.fixtures.find((f) => f.type === 'waste');
    expect(waste).toBeDefined();
    expect(waste!.text).toMatch(/^Waste ⌀\d+$/);
    // It sits on the scanned wall, within its length.
    expect(waste!.point.z).toBeCloseTo(0, 1);
    expect(waste!.point.x).toBeGreaterThan(0);
    expect(waste!.point.x).toBeLessThan(4000);
  });

  it('finds nothing on a blank wall', () => {
    expect(detectWallFixtures([frameWith(() => {})], walls, 2700)).toHaveLength(0);
  });
});

/** Paint a socket the way one looks: a white plate carrying dark pin slots. */
function paintSocket(img: DetectorImage, cx: number, cy: number, scale = 1) {
  const put = (x: number, y: number, w: number, h: number, val: number) => {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        if (xx < 0 || yy < 0 || xx >= IMG_W || yy >= IMG_H) continue;
        const i = (yy * IMG_W + xx) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = val;
      }
    }
  };
  const pw = Math.round(46 * scale), ph = Math.round(60 * scale);
  put(Math.round(cx - pw / 2), Math.round(cy - ph / 2), pw, ph, 240);
  const sw = Math.max(2, Math.round(5 * scale)), sh = Math.max(4, Math.round(14 * scale));
  put(Math.round(cx - 10 * scale - sw / 2), Math.round(cy - 8 * scale), sw, sh, 30);
  put(Math.round(cx + 10 * scale - sw / 2), Math.round(cy - 8 * scale), sw, sh, 30);
  put(Math.round(cx - sw / 2), Math.round(cy + 12 * scale), sw, Math.max(3, Math.round(7 * scale)), 30);
}

describe('socket detection end to end', () => {
  const walls = createDefaultRoom().walls;

  it('detects a socket from a camera frame', () => {
    const frame = frameWith((img) => paintSocket(img, 320, 240));
    const found = detectWallFixtures([frame], walls, 2700);
    const socket = found.find((f) => f.fixture.type === 'socket');
    expect(socket).toBeDefined();
    expect(socket!.fixture.source).toBe('detected');
    expect(socket!.fixture.confidence).toBeGreaterThan(0.2);
  });

  it('puts the socket on the correct wall at a sensible height', () => {
    const frame = frameWith((img) => paintSocket(img, 320, 240));
    const [socket] = detectWallFixtures([frame], walls, 2700)
      .filter((f) => f.fixture.type === 'socket');
    expect(socket.wallId).toBe('wall_0');
    // Painted at frame centre, so it projects to the camera's own eye height.
    expect(socket.fixture.height).toBeGreaterThan(1000);
    expect(socket.fixture.height).toBeLessThan(1700);
    expect(socket.fixture.offset).toBeGreaterThan(0);
    expect(socket.fixture.offset).toBeLessThan(4000);
  });

  it('maps a socket left of frame centre to a smaller offset than one to the right', () => {
    const left = detectWallFixtures([frameWith((i) => paintSocket(i, 180, 240))], walls, 2700)
      .filter((f) => f.fixture.type === 'socket');
    const right = detectWallFixtures([frameWith((i) => paintSocket(i, 460, 240))], walls, 2700)
      .filter((f) => f.fixture.type === 'socket');
    expect(left).toHaveLength(1);
    expect(right).toHaveLength(1);
    expect(left[0].fixture.offset).toBeLessThan(right[0].fixture.offset);
  });

  it('merges one socket seen across several frames', () => {
    const f = () => frameWith((img) => paintSocket(img, 320, 240));
    const sockets = detectWallFixtures([f(), f(), f()], walls, 2700)
      .filter((x) => x.fixture.type === 'socket');
    expect(sockets).toHaveLength(1);
    // Agreement across frames should raise confidence above a single sighting.
    const single = detectWallFixtures([f()], walls, 2700)
      .filter((x) => x.fixture.type === 'socket');
    expect(sockets[0].fixture.confidence).toBeGreaterThan(single[0].fixture.confidence);
  });

  it('finds two sockets on the same wall', () => {
    const frame = frameWith((img) => {
      paintSocket(img, 150, 240);
      paintSocket(img, 500, 240);
    });
    const sockets = detectWallFixtures([frame], walls, 2700)
      .filter((f) => f.fixture.type === 'socket');
    expect(sockets.length).toBeGreaterThanOrEqual(2);
  });

  it('shows the detected socket on the floor plan, labelled', () => {
    const frame = frameWith((img) => paintSocket(img, 320, 240));
    const found = detectWallFixtures([frame], walls, 2700);
    const room = createDefaultRoom();
    room.walls = assignFixturesToWalls(room.walls, found);
    const plan = roomToFloorplan(room);
    const socket = plan.fixtures.find((f) => f.type === 'socket');
    expect(socket).toBeDefined();
    expect(socket!.text).toBe('Socket');
    expect(socket!.point.z).toBeCloseTo(0, 1);
  });

  it('a detected socket then keeps a cabinet from being placed over it', async () => {
    const { generateLayout } = await import('@/systems/layout');
    const frame = frameWith((img) => paintSocket(img, 320, 240));
    const found = detectWallFixtures([frame], walls, 2700)
      .filter((f) => f.fixture.type === 'socket');
    expect(found).toHaveLength(1);

    const room = createDefaultRoom();
    room.walls = assignFixturesToWalls(room.walls, found);
    const at = found[0].fixture.offset;

    const res = generateLayout({
      room,
      assignments: [{
        wallId: 'wall_0',
        modules: [{
          definitionId: 'base',
          category: 'kitchen-base',
          mount: 'floor',
          width: 600,
          depth: 600,
          // Tall enough that its vertical band reaches the socket height.
          height: 2100,
          elevation: 0,
        }],
      }],
      // Place the unit so it covers the detected socket.
      fixtures: [{
        id: found[0].fixture.id,
        type: 'socket',
        wallId: 'wall_0',
        offset: Math.min(at, 500),
        height: found[0].fixture.height,
      }],
    });
    // The cabinet is kept clear of the detected socket rather than sealing it.
    expect(res.violations.filter((v) => v.kind === 'fixture-blocked')).toEqual([]);
    const socketAt = Math.min(at, 500);
    const p = res.placements[0];
    expect(p.offset >= socketAt + 150 || p.offset + p.module.width <= socketAt - 150).toBe(true);
  });
});
