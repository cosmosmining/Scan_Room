import { describe, expect, it } from 'vitest';
import { scanToGeometry } from '@/systems/scan/scanToGeometry';
import { placedName, placedSize, SCANNED_ITEM_ID, type PlacedFurniture } from '@/systems/furniture/catalog';
import type { RoomScan } from '@mozu/scan-sdk';

const scan: RoomScan = {
  schema: 'mozu.roomscan/1',
  polygon: [
    { x: 0, z: 0 }, { x: 4000, z: 0 }, { x: 4000, z: 3000 }, { x: 0, z: 3000 },
  ],
  height: 2500,
  openings: [],
  objects: [
    { category: 'sofa', center: { x: 1200, z: 800 }, width: 2100, depth: 900, rotation: 0, height: 850 },
    { category: 'storage', center: { x: 3200, z: 2200 }, width: 800, depth: 400, rotation: Math.PI / 2 },
  ],
  fixtures: [],
  source: 'roomplan',
  unitSystem: 'metric',
  confidence: 0.9,
  capturedAt: '2026-01-01T00:00:00Z',
};

describe('scanned furniture survives the crossing to the web', () => {
  it('carries the objects through instead of dropping them', () => {
    // They used to be dropped here silently: the iPad measured a room full of
    // furniture and the web opened an empty shell.
    const geometry = scanToGeometry(scan);
    expect(geometry.objects).toHaveLength(2);
    expect(geometry.objects?.[0].category).toBe('sofa');
  });

  it('tolerates a scan with no objects at all', () => {
    const geometry = scanToGeometry({ ...scan, objects: [] });
    expect(geometry.objects).toEqual([]);
  });
});

describe('a scanned piece is sized by MEASUREMENT, not by the catalogue', () => {
  const placed: PlacedFurniture = {
    id: 'scan_0_sofa',
    itemId: SCANNED_ITEM_ID,
    position: { x: 1200, z: 800 },
    rotationY: 0,
    size: { width: 2100, height: 850, depth: 900 },
    label: 'sofa',
    scanned: true,
  };

  it('reports the size it was measured at', () => {
    // Forcing it to the catalogue's 2120mm sofa would be inventing a
    // measurement, and a measurement is the only reason to carry it over.
    expect(placedSize(placed)).toEqual({ width: 2100, height: 850, depth: 900 });
  });

  it('is named by what the scan called it', () => {
    expect(placedName(placed)).toBe('sofa');
  });

  it('still falls back to the catalogue for a normal placed item', () => {
    const fromCatalogue: PlacedFurniture = {
      id: 'f1', itemId: 'sofa_3seat', position: { x: 0, z: 0 }, rotationY: 0,
    };
    expect(placedSize(fromCatalogue)).toEqual({ width: 2120, height: 900, depth: 950 });
    expect(placedName(fromCatalogue)).toBe('3-Seat Sofa');
  });

  it('gives an unknown item a sane box rather than crashing', () => {
    const orphan: PlacedFurniture = {
      id: 'f2', itemId: 'no-such-item', position: { x: 0, z: 0 }, rotationY: 0,
    };
    expect(placedSize(orphan).width).toBeGreaterThan(0);
    expect(placedName(orphan)).toBe('no-such-item');
  });
});
