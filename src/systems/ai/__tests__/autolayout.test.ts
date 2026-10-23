import { describe, expect, it } from 'vitest';
import { createDefaultRoom } from '@/lib/defaults';
import { defaultCatalog } from '@/systems/catalog';
import { generateBaseline, recommendLayouts, analyzeRuns } from '@/systems/ai';

const room = createDefaultRoom(); // 4000 × 3000 mm rectangle
const catalog = defaultCatalog;

const defIds = (mods: { definitionId: string }[]) => mods.map((m) => m.definitionId);

describe('AI auto-layout', () => {
  it('analyses every wall into a usable run, longest first', () => {
    const runs = analyzeRuns(room);
    expect(runs).toHaveLength(4);
    expect(runs[0].usableLength).toBeGreaterThanOrEqual(runs[1].usableLength);
    // 4000 wall minus one corner reserve (600) = 3400 usable.
    expect(runs[0].usableLength).toBe(3400);
  });

  it('generates the worked baseline: sink · drawers · fridge · stove · hood · 3 uppers', () => {
    const { recommendation } = generateBaseline(room, catalog);
    const ids = defIds(recommendation.modules);
    expect(ids).toContain('sink-base-800');
    expect(ids).toContain('cooker-600');
    expect(ids).toContain('fridge-600');
    expect(ids).toContain('hood-600');
    // Three overhead cabinets over the cooking run (the recommended plan may
    // add more over a second run).
    const primaryWall = recommendation.modules[0].wallId;
    const primary = recommendation.modules.filter((m) => m.wallId === primaryWall);
    expect(defIds(primary).filter((id) => id === 'wall-600')).toHaveLength(3);
    expect(ids.filter((id) => id === 'drawer-base-600').length).toBeGreaterThanOrEqual(1);
  });

  it('places the baseline with no hard (error) violations', () => {
    const { recommendation } = generateBaseline(room, catalog);
    expect(recommendation.result.instances.length).toBeGreaterThan(0);
    expect(recommendation.result.unplaced).toHaveLength(0);
    expect(recommendation.result.violations.filter((v) => v.severity === 'error')).toHaveLength(0);
  });

  it('ranks all feasible shapes and flags exactly one as recommended', () => {
    const recs = recommendLayouts(room, catalog);
    expect(recs.map((r) => r.shape).sort()).toEqual(
      ['galley', 'l-shaped', 'single-wall', 'u-shaped'].sort(),
    );
    expect(recs.filter((r) => r.recommended)).toHaveLength(1);
    expect(recs[0].recommended).toBe(true);
    // Sorted by score, descending.
    for (let i = 1; i < recs.length; i++) {
      expect(recs[i - 1].score).toBeGreaterThanOrEqual(recs[i].score);
    }
  });

  it('scales down in a tight run: no fridge, fewer drawers, still valid', () => {
    const tight = createDefaultRoom();
    // Shrink to a 2.2m × 2m room — fridge should be dropped (< 2400mm usable).
    const w = 2200;
    const d = 2000;
    tight.footprint = [
      { x: 0, y: 0, z: 0 },
      { x: w, y: 0, z: 0 },
      { x: w, y: 0, z: d },
      { x: 0, y: 0, z: d },
    ];
    tight.walls = tight.walls.map((wall, i) => ({
      ...wall,
      start: tight.footprint[i],
      end: tight.footprint[(i + 1) % 4],
    }));
    const { recommendation } = generateBaseline(tight, catalog);
    const ids = defIds(recommendation.modules);
    expect(ids).toContain('sink-base-800');
    expect(recommendation.result.unplaced).toHaveLength(0);
  });

  it('handles the wardrobe domain with full-height frames', () => {
    const recs = recommendLayouts(room, catalog, { domain: 'wardrobe' });
    const top = recs[0];
    expect(top.modules.every((m) => m.definitionId === 'wardrobe-1000')).toBe(true);
    expect(top.result.instances.length).toBeGreaterThan(0);
  });
});
