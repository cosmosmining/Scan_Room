import { describe, expect, it } from 'vitest';
import {
  ManualScanner,
  floorplanSketchToRoomGeometry,
  manualDimensionsToRoomGeometry,
  resolveScanner,
  roomGeometryToRoom,
} from '@/systems/scan';

describe('space scanning', () => {
  it('manual dimensions produce an exact rectangular geometry', () => {
    const g = manualDimensionsToRoomGeometry({
      width: 4000,
      depth: 3000,
      height: 2700,
      unitSystem: 'metric',
    });
    expect(g.footprint).toHaveLength(4);
    expect(g.walls).toHaveLength(4);
    expect(g.height).toBe(2700);
    expect(g.source).toBe('manual');
    expect(g.confidence).toBe(1);
  });

  it('lifts captured geometry into a domain Room', () => {
    const g = manualDimensionsToRoomGeometry({
      width: 4000,
      depth: 3000,
      height: 2700,
      unitSystem: 'metric',
    });
    const room = roomGeometryToRoom(g, 'Kitchen');
    expect(room.name).toBe('Kitchen');
    expect(room.walls).toHaveLength(4);
    expect(room.id).toMatch(/^room_/);
    expect(room.source).toBe('manual');
  });

  it('floorplan sketch builds one wall per polygon edge (L-shape)', () => {
    const g = floorplanSketchToRoomGeometry({
      vertices: [
        { x: 0, z: 0 },
        { x: 4000, z: 0 },
        { x: 4000, z: 2000 },
        { x: 2000, z: 2000 },
        { x: 2000, z: 3000 },
        { x: 0, z: 3000 },
      ],
      height: 2700,
      unitSystem: 'metric',
    });
    expect(g.walls).toHaveLength(6);
    expect(g.provider).toBe('floorplan');
  });

  it('manual scanner is always available and resolves as the fallback', async () => {
    const manual = new ManualScanner();
    expect(await manual.isAvailable()).toBe(true);
    const scanner = await resolveScanner();
    expect(scanner.id).toBe('manual');
  });
});
