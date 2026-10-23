import { describe, expect, it } from 'vitest';
import {
  buildFloorplan,
  floorplanCenter,
  floorplanLabelPoint,
  floorplanToSvg,
  formatArea,
  formatLength,
  parseScan,
  rectangleScan,
  scanFromParams,
  serializeScan,
  simplifyPolygon,
  handoffUrl,
  type RoomScan,
} from '@mozu/scan-sdk';
import { roomToFloorplan } from '@/systems/scan/floorplan';
import type { Room } from '@/lib/types';

const rect4x3: RoomScan = rectangleScan(4000, 3000, 2700, 'metric', 'webxr');

describe('buildFloorplan', () => {
  it('computes wall lengths, perimeter and area for a 4×3 m room', () => {
    const fp = buildFloorplan(rect4x3);
    expect(fp.walls).toHaveLength(4);
    const lengths = fp.walls.map((w) => Math.round(w.length)).sort((a, b) => a - b);
    expect(lengths).toEqual([3000, 3000, 4000, 4000]);
    expect(Math.round(fp.perimeterMm)).toBe(14000);
    expect(Math.round(fp.areaMm2)).toBe(12_000_000); // 12 m²
    expect(fp.bounds.width).toBe(4000);
    expect(fp.bounds.depth).toBe(3000);
  });

  it('handles an L-shaped polygon (non-convex)', () => {
    const L: RoomScan = {
      ...rect4x3,
      polygon: [
        { x: 0, z: 0 },
        { x: 4000, z: 0 },
        { x: 4000, z: 2000 },
        { x: 2000, z: 2000 },
        { x: 2000, z: 3000 },
        { x: 0, z: 3000 },
      ],
    };
    const fp = buildFloorplan(L);
    expect(fp.walls).toHaveLength(6);
    // 4×3 rect (12 m²) minus the 2×1 notch (2 m²) = 10 m².
    expect(Math.round(fp.areaMm2)).toBe(10_000_000);
  });

  it('outward normals point away from the room centroid', () => {
    const fp = buildFloorplan(rect4x3);
    const cx = 2000;
    const cz = 1500;
    for (const w of fp.walls) {
      const midX = (w.start.x + w.end.x) / 2;
      const midZ = (w.start.z + w.end.z) / 2;
      // Stepping along the outward normal must increase distance from centre.
      const before = Math.hypot(midX - cx, midZ - cz);
      const after = Math.hypot(midX + w.outward.x * 100 - cx, midZ + w.outward.z * 100 - cz);
      expect(after).toBeGreaterThan(before);
    }
  });
});

describe('simplifyPolygon', () => {
  it('drops collinear and duplicate vertices from a noisy trace', () => {
    const noisy = [
      { x: 0, z: 0 },
      { x: 2000, z: 0 }, // collinear midpoint — should be removed
      { x: 4000, z: 0 },
      { x: 4000, z: 10 }, // near-duplicate of the next corner — merged
      { x: 4000, z: 3000 },
      { x: 0, z: 3000 },
    ];
    expect(simplifyPolygon(noisy)).toHaveLength(4);
  });
});

describe('floorplanToSvg', () => {
  it('renders a valid SVG carrying the captured dimensions', () => {
    const svg = floorplanToSvg(buildFloorplan(rect4x3), { theme: 'light' });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
    expect(svg).toContain('4.00 m'); // auto-captured wall length label
    expect(svg).toContain('12.0 m²'); // area label
  });

  it('draws a door swing for openings', () => {
    const withDoor = buildFloorplan({
      ...rect4x3,
      openings: [{ type: 'door', wall: 0, offset: 800, width: 900, height: 2030 }],
    });
    const svg = floorplanToSvg(withDoor);
    expect(svg).toContain('<path'); // the swing arc
  });
});

describe('formatting', () => {
  it('formats metric and imperial lengths', () => {
    expect(formatLength(4000, 'metric')).toBe('4.00 m');
    expect(formatLength(3048, 'imperial')).toBe('10′ 0″'); // 3048 mm = 10 ft
  });
  it('formats areas', () => {
    expect(formatArea(12_000_000, 'metric')).toBe('12.0 m²');
    expect(formatArea(10 * 92_903.04, 'imperial')).toBe('10 ft²'); // 10 ft² in mm²
  });
});

describe('serialize / handoff', () => {
  it('round-trips a scan through serialize/parse', () => {
    const json = serializeScan(rect4x3);
    const back = parseScan(json);
    expect(back?.polygon).toHaveLength(4);
    expect(back?.height).toBe(2700);
  });

  it('builds a /scan deep link and reads it back', () => {
    const url = handoffUrl('https://app.mozu.example', rect4x3);
    expect(url).toContain('/scan?');
    expect(url).toContain('poly=');
    const params = url.split('?')[1];
    const back = scanFromParams(params);
    expect(back?.polygon).toHaveLength(4);
    expect(Math.round(back!.polygon[1].x)).toBe(4000);
  });

  it('carries openings through the rich `scan` param', () => {
    const withDoor: RoomScan = {
      ...rect4x3,
      openings: [{ type: 'door', wall: 0, offset: 800, width: 900, height: 2030 }],
    };
    const url = handoffUrl('https://app.mozu.example', withDoor);
    expect(url).toContain('scan=');
    const back = scanFromParams(url.split('?')[1]);
    expect(back?.openings).toHaveLength(1);
    expect(back?.openings[0].type).toBe('door');
  });
});

describe('web adapter', () => {
  it('renders a domain Room as a floorplan', () => {
    const room: Room = {
      id: 'room_1',
      name: 'Kitchen',
      footprint: [
        { x: 0, y: 0, z: 0 },
        { x: 4000, y: 0, z: 0 },
        { x: 4000, y: 0, z: 3000 },
        { x: 0, y: 0, z: 3000 },
      ],
      walls: [
        {
          id: 'wall_0',
          start: { x: 0, y: 0, z: 0 },
          end: { x: 4000, y: 0, z: 0 },
          height: 2700,
          thickness: 100,
          openings: [
            { id: 'op_0', type: 'door', offset: 800, width: 900, height: 2030, sillHeight: 0 },
          ],
        },
      ],
      height: 2700,
      unitSystem: 'metric',
      source: 'ar-scan',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const fp = roomToFloorplan(room);
    expect(Math.round(fp.areaMm2)).toBe(12_000_000);
    expect(fp.openings).toHaveLength(1);
    expect(fp.openings[0].wall).toBe(0);
  });
});

describe('where the area label goes', () => {
  it('in an L-shaped room, well inside the floor — not on the wall of its inside corner', () => {
    const fp = buildFloorplan({
      polygon: [
        { x: 0, z: 0 }, { x: 6000, z: 0 }, { x: 6000, z: 2500 },
        { x: 3000, z: 2500 }, { x: 3000, z: 5000 }, { x: 0, z: 5000 },
      ],
      height: 2650,
      unitSystem: 'metric',
    });
    const c = floorplanCenter(fp);
    const p = floorplanLabelPoint(fp);
    // The corners' centre is 0.6 m from the inside corner (3000, 2500)…
    expect(Math.hypot(c.x - 3000, c.z - 2500)).toBeLessThan(700);
    // …the label point is inside the L, at least a metre from every wall.
    const inL = p.x > 0 && p.z > 0 && (p.x < 3000 ? p.z < 5000 : p.x < 6000 && p.z < 2500);
    expect(inL).toBe(true);
    expect(Math.min(p.x, p.z, 6000 - p.x, 5000 - p.z, Math.max(3000 - p.x, 2500 - p.z))).toBeGreaterThan(1000);
  });

  it('in a plain rectangle, the middle', () => {
    const fp = buildFloorplan({
      polygon: [{ x: 0, z: 0 }, { x: 4000, z: 0 }, { x: 4000, z: 3000 }, { x: 0, z: 3000 }],
      height: 2600,
      unitSystem: 'metric',
    });
    const p = floorplanLabelPoint(fp);
    expect(p.x).toBeCloseTo(2000, 0);
    expect(p.z).toBeCloseTo(1500, 0);
  });
});
