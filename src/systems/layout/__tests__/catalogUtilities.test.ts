import { describe, expect, it } from 'vitest';
import { createDefaultRoom } from '@/lib/defaults';
import { defaultCatalog, getDefinition } from '@/systems/catalog';
import { nodeToPlacementModule } from '@/systems/config';
import { generateLayout, type LayoutFixture } from '@/systems/layout';
import type { ConfigNode } from '@/systems/config';

/**
 * The conflict rules are only worth anything if they fire on REAL catalog data.
 * These tests go through the same `nodeToPlacementModule` path the store uses,
 * so a regression that drops the service hints (as happened once) fails here.
 */
const defOf = (id: string) => {
  const def = getDefinition(defaultCatalog, id);
  if (!def) throw new Error(`missing catalog module ${id}`);
  return def;
};

const node = (definitionId: string): ConfigNode => ({
  id: `n_${definitionId}`,
  kind: 'module',
  definitionId,
  materials: {},
  selectedOptionIds: [],
  children: [],
});

const placement = (definitionId: string) =>
  nodeToPlacementModule(node(definitionId), defOf(definitionId));

const water = (offset: number): LayoutFixture => ({
  id: 'w1', type: 'water', wallId: 'wall_0', offset, height: 300,
});
const waste = (offset: number): LayoutFixture => ({
  id: 'd1', type: 'waste', wallId: 'wall_0', offset, height: 300,
});
const socket = (offset: number): LayoutFixture => ({
  id: 's1', type: 'socket', wallId: 'wall_0', offset, height: 300,
});

describe('catalog modules carry their service requirements', () => {
  it('a sink base declares the connections it is meant to sit over', () => {
    expect(placement('sink-base-800').connectsUtilities).toEqual(['water', 'waste']);
  });

  it('powered appliances declare what they need', () => {
    expect(placement('oven-600').needsUtilities).toEqual(['socket']);
    expect(placement('fridge-600').needsUtilities).toEqual(['socket']);
    expect(placement('cooker-600').needsUtilities).toEqual(['gas']);
  });

  it('a plain base cabinet declares nothing', () => {
    expect(placement('base-600').connectsUtilities).toBeUndefined();
    expect(placement('base-600').needsUtilities).toBeUndefined();
  });
});

describe('real catalog units through the conflict engine', () => {
  it('allows the catalog sink base to sit over water and waste', () => {
    const res = generateLayout({
      room: createDefaultRoom(),
      assignments: [{ wallId: 'wall_0', modules: [placement('sink-base-800')] }],
      fixtures: [water(300), waste(450)],
    });
    expect(res.violations.filter((v) => v.kind === 'fixture-blocked')).toHaveLength(0);
  });

  it('keeps a plain catalog cabinet off the same pipework, where the sink may go', () => {
    const res = generateLayout({
      room: createDefaultRoom(),
      assignments: [{ wallId: 'wall_0', modules: [placement('base-600')] }],
      fixtures: [water(300)],
    });
    expect(res.violations.filter((v) => v.kind === 'fixture-blocked')).toEqual([]);
    expect(res.placements[0].offset).toBeGreaterThanOrEqual(450);
    const sink = generateLayout({
      room: createDefaultRoom(),
      assignments: [{ wallId: 'wall_0', modules: [placement('sink-base-800')] }],
      fixtures: [water(300)],
    });
    expect(sink.placements[0].offset).toBe(0);
  });

  it('warns when the catalog oven has no socket in reach', () => {
    const res = generateLayout({
      room: createDefaultRoom(),
      assignments: [{ wallId: 'wall_0', modules: [placement('oven-600')] }],
      fixtures: [],
    });
    expect(res.violations.filter((v) => v.kind === 'utility-reach')).toHaveLength(1);
  });

  it('does not warn when a socket is within reach', () => {
    const res = generateLayout({
      room: createDefaultRoom(),
      assignments: [{ wallId: 'wall_0', modules: [placement('oven-600')] }],
      fixtures: [socket(900)],
    });
    expect(res.violations.filter((v) => v.kind === 'utility-reach')).toHaveLength(0);
  });

  it('warns when the gas range has only electricity available', () => {
    const res = generateLayout({
      room: createDefaultRoom(),
      assignments: [{ wallId: 'wall_0', modules: [placement('cooker-600')] }],
      fixtures: [socket(300)],
    });
    expect(res.violations.filter((v) => v.kind === 'utility-reach')).toHaveLength(1);
  });
});
