import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDefaultRoom } from '@/lib/defaults';
import { clampToRoom, pointInPolygon } from '@/state/slices/designSlice';
import { FURNITURE_ITEMS, furnitureItem } from '../catalog';
import { furnitureParts } from '../parts';
import { recommendFurniture } from '../recommend';

const room = createDefaultRoom(); // 4000 × 3000 mm, corners at (0,0)…(4000,3000)

describe('clampToRoom', () => {
  it('leaves a point that is already inside alone', () => {
    const p = { x: 1200, z: 900 };
    expect(clampToRoom(p, room.footprint)).toEqual(p);
  });

  it('seats a point dragged through a wall back on that wall', () => {
    // Dragged well past the far wall (x = 4000).
    const out = clampToRoom({ x: 6000, z: 1500 }, room.footprint);
    expect(out.z).toBeCloseTo(1500, 5);
    // On the wall, nudged 50mm into the room — not yanked to the centre.
    expect(out.x).toBeCloseTo(3950, 5);
    expect(pointInPolygon(out, room.footprint)).toBe(true);
  });

  it('seats a point dragged past a corner on the nearer wall', () => {
    const out = clampToRoom({ x: -500, z: -500 }, room.footprint);
    expect(pointInPolygon(out, room.footprint)).toBe(true);
  });
});

describe('pointInPolygon', () => {
  it('is false outside and true inside', () => {
    expect(pointInPolygon({ x: -1, z: -1 }, room.footprint)).toBe(false);
    expect(pointInPolygon({ x: 2000, z: 1500 }, room.footprint)).toBe(true);
  });
});

/**
 * `FurnitureItem(id: "X", name: "Y", category: "C", usdzName: …, size: SIMD3<Float>(w, h, d))`
 * — the iPad's catalogue, whose sizes are the true bounding boxes from each
 * model's STEP file. A web catalogue that drifts from it prices and lays out a
 * cabinet that is not the cabinet, so it is read and compared rather than
 * trusted.
 */
function parseSwiftItems(file: string) {
  const source = readFileSync(
    resolve(process.cwd(), 'apps/ios/MozuScanner/Design/Model', file),
    'utf8',
  );
  const out: { id: string; name: string; category: string; size: number[] }[] = [];
  // Split on the constructor rather than on newlines: the home furnishings wrap
  // across two lines, and a line-based parse silently drops every one of them.
  for (const raw of source.replace(/\s+/g, ' ').split('FurnitureItem(').slice(1)) {
    const id = /id:\s*"([^"]+)"/.exec(raw);
    const name = /name:\s*"([^"]+)"/.exec(raw);
    const category = /category:\s*"([^"]+)"/.exec(raw);
    const size = /size:\s*SIMD3<Float>\(([\d.]+),\s*([\d.]+),\s*([\d.]+)\)/.exec(raw);
    if (!id || !name || !category || !size) continue;
    out.push({
      id: id[1],
      name: name[1],
      category: category[1],
      size: [1, 2, 3].map((i) => Math.round(Number(size[i]) * 1000)),
    });
  }
  return out;
}

describe('furniture catalogue', () => {
  it('carries exactly the iPad catalogue, at the iPad sizes', () => {
    const swift = [...parseSwiftItems('MozuModels.swift'), ...parseSwiftItems('Catalog.swift')];
    // A regex that matched nothing would make the loop below vacuous.
    expect(swift).toHaveLength(40);
    expect(FURNITURE_ITEMS.map((i) => i.id)).toEqual(swift.map((i) => i.id));

    for (const want of swift) {
      const got = furnitureItem(want.id);
      expect(got, `${want.id} exists`).toBeDefined();
      expect(got!.category, `${want.id} category`).toBe(want.category);
      expect(
        [got!.size.width, got!.size.height, got!.size.depth],
        `${want.id} size`,
      ).toEqual(want.size);
    }
  });

  it('builds the sofa from the same boxes the USDZ generator does', () => {
    const sofa = furnitureItem('sofa_3seat');
    expect(sofa).toBeDefined();
    const parts = furnitureParts(sofa!);
    // Seven upholstered boxes and four legs.
    expect(parts).toHaveLength(11);
    // Authored in metres over there, millimetres here.
    expect(parts[0].s).toEqual([2100, 400, 950]);
  });

  it('gives every catalogue item some geometry', () => {
    for (const item of FURNITURE_ITEMS) {
      expect(furnitureParts(item).length).toBeGreaterThan(0);
    }
  });
});

describe('recommendFurniture', () => {
  it('lays every set along the longest wall, inside the room', () => {
    const recommendations = recommendFurniture(room);
    expect(recommendations.map((r) => r.id)).toEqual([
      'rec_kitchen', 'rec_wardrobe', 'rec_living',
    ]);

    for (const rec of recommendations) {
      expect(rec.items.length).toBeGreaterThan(0);
      for (const placed of rec.items) {
        expect(pointInPolygon(placed.position, room.footprint)).toBe(true);
      }
    }
  });

  it('does not pack a run past the end of its wall', () => {
    const kitchen = recommendFurniture(room).find((r) => r.id === 'rec_kitchen');
    expect(kitchen).toBeDefined();
    // The longest wall is 4000mm; the widest base is 1000mm and the narrowest
    // tall unit 600mm, so three bases plus the larder is the fit.
    const total = kitchen!.items.reduce(
      (sum, p) => sum + (furnitureItem(p.itemId)?.size.width ?? 0),
      0,
    );
    expect(total).toBeLessThanOrEqual(4000);
  });

  it('is deterministic', () => {
    expect(recommendFurniture(room)).toEqual(recommendFurniture(room));
  });

  it('returns nothing for a room with no usable walls', () => {
    expect(recommendFurniture({ ...room, walls: [] })).toEqual([]);
  });
});
