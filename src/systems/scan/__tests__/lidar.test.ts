import { describe, expect, it } from 'vitest';
import {
  buildMassing,
  createScanAccumulator,
  manualDimensionsToRoomGeometry,
  planesFromGeometry,
} from '@/systems/scan';

const geometry = manualDimensionsToRoomGeometry({
  width: 4000,
  depth: 3000,
  height: 2700,
  unitSystem: 'metric',
});

describe('massing model (the white box scan)', () => {
  it('builds a wall slab per wall plus a floor slab', () => {
    const model = buildMassing(geometry);
    expect(model.boxes.filter((b) => b.kind === 'wall')).toHaveLength(4);
    expect(model.boxes.filter((b) => b.kind === 'floor')).toHaveLength(1);
    expect(model.bounds.max.x).toBe(4000);
    expect(model.bounds.max.z).toBe(3000);
  });

  it('adds a labelled box per detected object (the closet)', () => {
    const model = buildMassing(geometry, [
      { category: 'wardrobe', center: { x: 500, z: 2400 }, width: 1000, depth: 600 },
    ]);
    const objects = model.boxes.filter((b) => b.kind === 'object');
    expect(objects).toHaveLength(1);
    expect(objects[0].label).toBe('wardrobe');
    expect(objects[0].size.y).toBe(2000); // wardrobe default height
    expect(objects[0].center.y).toBe(1000); // half-height off the floor
  });

  it('orients wall slabs along the wall direction', () => {
    const model = buildMassing(geometry);
    const wall = model.boxes.find((b) => b.kind === 'wall');
    expect(wall).toBeDefined();
    // First wall runs along +x (4000 long), so its longest extent is x.
    expect(wall!.size.x).toBeGreaterThan(wall!.size.z);
  });
});

describe('live scan accumulator (lines + box build-up)', () => {
  it('lights up four edges per detected wall and advances progress', () => {
    const acc = createScanAccumulator({ expectedWalls: 4 });
    const planes = planesFromGeometry(geometry);

    const first = acc.addPlane(planes[0]);
    expect(first.planeCount).toBe(1);
    expect(first.edges).toHaveLength(4); // base + top + two corner verticals
    expect(first.phase).toBe('capturing');
    expect(first.progress).toBeGreaterThan(0);
    expect(first.progress).toBeLessThan(1);

    let snap = first;
    for (const plane of planes.slice(1)) snap = acc.addPlane(plane);
    expect(snap.planeCount).toBe(4);
    expect(snap.edges).toHaveLength(16);
  });

  it('closes the loop into a usable room geometry on finish', () => {
    const acc = createScanAccumulator({ expectedWalls: 4 });
    for (const plane of planesFromGeometry(geometry)) acc.addPlane(plane);

    const { geometry: out, snapshot } = acc.finish();
    expect(snapshot.phase).toBe('done');
    expect(snapshot.progress).toBe(1);
    expect(out.walls).toHaveLength(4);
    expect(out.footprint).toHaveLength(4);
    expect(out.provider).toBe('webxr-depth');
    expect(out.source).toBe('ar-scan');
    expect(out.confidence).toBeGreaterThan(0.8);
    // Massing has settled into 4 walls + a floor.
    expect(snapshot.massing.boxes.filter((b) => b.kind === 'wall')).toHaveLength(4);
    expect(snapshot.massing.boxes.filter((b) => b.kind === 'floor')).toHaveLength(1);
  });

  it('captures objects as outlined boxes during the scan', () => {
    const acc = createScanAccumulator();
    acc.addPlane(planesFromGeometry(geometry)[0]);
    const snap = acc.addObject({
      category: 'refrigerator',
      center: { x: 300, z: 300 },
      width: 600,
      depth: 650,
    });
    expect(snap.edges.filter((e) => e.kind === 'object')).toHaveLength(4);
    expect(snap.massing.boxes.some((b) => b.label === 'refrigerator')).toBe(true);
  });
});
