import { describe, expect, it } from 'vitest';
import type { ModuleInstance } from '@/lib/types';
import { createDefaultRoom } from '@/lib/defaults';
import {
  detectOpeningObstruction,
  generateLayout,
  type LayoutFixture,
  type Placement,
  type PlacementModule,
  type WallRun,
} from '@/systems/layout';

const base = (
  definitionId: string,
  width: number,
  extra: Partial<PlacementModule> = {},
): PlacementModule => ({
  definitionId,
  category: 'kitchen-base',
  mount: 'floor',
  width,
  depth: 600,
  height: 900,
  ...extra,
});

const socketAt = (offset: number, extra: Partial<LayoutFixture> = {}): LayoutFixture => ({
  id: `f${offset}`,
  type: 'socket',
  wallId: 'wall_0',
  offset,
  height: 300,
  ...extra,
});

describe('fixture conflicts', () => {
  it('blocks a base cabinet that seals a socket, and marks it invalid', () => {
    const res = generateLayout({
      room: createDefaultRoom(),
      assignments: [{ wallId: 'wall_0', modules: [base('base', 600)] }],
      fixtures: [socketAt(300)], // 300mm falls under the 0–600 cabinet
    });
    const blocked = res.violations.filter((v) => v.kind === 'fixture-blocked');
    expect(blocked).toHaveLength(1);
    expect(blocked[0].severity).toBe('error');
    expect(blocked[0].fixtureId).toBe('f300');
    expect(res.instances[0].valid).toBe(false);
  });

  it('allows a sink base to sit over the water + waste it connects to', () => {
    const res = generateLayout({
      room: createDefaultRoom(),
      assignments: [
        {
          wallId: 'wall_0',
          modules: [base('sink', 900, { connectsUtilities: ['water', 'waste'] })],
        },
      ],
      fixtures: [
        { id: 'w', type: 'water', wallId: 'wall_0', offset: 300, height: 300 },
        { id: 'd', type: 'waste', wallId: 'wall_0', offset: 450, height: 300 },
      ],
    });
    expect(res.violations.filter((v) => v.kind === 'fixture-blocked')).toHaveLength(0);
  });

  it('still blocks a plain base cabinet over a water pipe', () => {
    const res = generateLayout({
      room: createDefaultRoom(),
      assignments: [{ wallId: 'wall_0', modules: [base('base', 600)] }],
      fixtures: [{ id: 'w', type: 'water', wallId: 'wall_0', offset: 300, height: 300 }],
    });
    expect(res.violations.filter((v) => v.kind === 'fixture-blocked')).toHaveLength(1);
  });

  it('warns when a unit crowds a socket without covering it', () => {
    const res = generateLayout({
      room: createDefaultRoom(),
      assignments: [{ wallId: 'wall_0', modules: [base('base', 600)] }],
      fixtures: [socketAt(700)], // 100mm past the unit → inside the 150mm access zone
    });
    const warn = res.violations.filter((v) => v.kind === 'fixture-clearance');
    expect(warn).toHaveLength(1);
    expect(warn[0].severity).toBe('warning');
  });

  it('does not clash a low socket with a high wall cabinet (band gating)', () => {
    const res = generateLayout({
      room: createDefaultRoom(),
      assignments: [
        {
          wallId: 'wall_0',
          modules: [base('wallcab', 600, { mount: 'wall', elevation: 1500, height: 720 })],
        },
      ],
      fixtures: [socketAt(300)], // 300mm height is well below the 1500mm unit
    });
    expect(res.violations.filter((v) => v.kind.startsWith('fixture'))).toHaveLength(0);
  });

  it('warns when an appliance has no required socket within reach', () => {
    const res = generateLayout({
      room: createDefaultRoom(),
      assignments: [
        {
          wallId: 'wall_0',
          modules: [base('oven', 600, { category: 'appliance', needsUtilities: ['socket'] })],
        },
      ],
      fixtures: [],
    });
    expect(res.violations.filter((v) => v.kind === 'utility-reach')).toHaveLength(1);
  });

  it('reads fixtures from the room walls when none are passed explicitly', () => {
    const room = createDefaultRoom();
    room.walls[0].fixtures = [
      { id: 's', type: 'socket', offset: 300, height: 300, source: 'detected', confidence: 0.9 },
    ];
    const res = generateLayout({
      room,
      assignments: [{ wallId: 'wall_0', modules: [base('base', 600)] }],
    });
    expect(res.violations.filter((v) => v.kind === 'fixture-blocked')).toHaveLength(1);
  });

  it('flags a floor unit standing across an opening (manual-placement guard)', () => {
    const run: WallRun = {
      id: 'run_x',
      wallId: 'wall_0',
      origin: { x: 0, z: 0 },
      dir: { x: 1, z: 0 },
      normal: { x: 0, z: 1 },
      length: 4000,
      usableStart: 0,
      usableEnd: 4000,
      blocked: [{ start: 700, end: 1600 }], // a door
    };
    const placement: Placement = { module: base('base', 600), run, offset: 900 }; // 900–1500 overlaps the door
    const inst: ModuleInstance = {
      id: 'i1',
      definitionId: 'base',
      position: { x: 0, y: 0, z: 0 },
      rotationY: 0,
      selectedOptionIds: [],
    };
    const vio = detectOpeningObstruction([placement], [inst]);
    expect(vio).toHaveLength(1);
    expect(vio[0].kind).toBe('obstruction');
    expect(vio[0].severity).toBe('error');
  });
});
