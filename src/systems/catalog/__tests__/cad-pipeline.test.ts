import { describe, expect, it } from 'vitest';
import { genStepBox } from '../../../../scripts/cad/gen-step-box.mjs';
import { boundingBox, convertStep } from '../../../../scripts/cad/step-to-glb.mjs';

// The STEP → GLB + placement-dimensions pipeline (scripts/cad). Proves a CAD
// B-rep round-trips to the exact numbers the placement engine consumes.

describe('CAD STEP pipeline', () => {
  it('generates a structurally valid AP214 box B-rep', () => {
    const step = genStepBox({ name: 'unit', width: 1000, height: 2000, depth: 600 });
    expect(step.startsWith('ISO-10303-21;')).toBe(true);
    expect(step.trim().endsWith('END-ISO-10303-21;')).toBe(true);
    expect((step.match(/VERTEX_POINT/g) ?? []).length).toBe(8);
    expect((step.match(/EDGE_CURVE/g) ?? []).length).toBe(12);
    expect((step.match(/ADVANCED_FACE/g) ?? []).length).toBe(6);
    expect(step).toContain('CLOSED_SHELL');
    expect(step).toContain('MANIFOLD_SOLID_BREP');
    expect(step).toContain('SI_UNIT(.MILLI.,.METRE.)'); // millimetres
  });

  it('computes an axis-aligned bounding box from positions', () => {
    const bb = boundingBox([0, 0, 0, 1000, 2000, 600, 500, 1000, 300]);
    expect(bb.size).toEqual([1000, 2000, 600]);
  });

  it('round-trips STEP → OCCT mesh → exact placement dimensions', async () => {
    const step = genStepBox({ name: 'closet', width: 1000, height: 2000, depth: 600 });
    const { dimensions, definition, glb } = await convertStep(Buffer.from(step), {
      id: 'closet',
      category: 'wardrobe-frame',
    });
    expect(dimensions).toEqual({ width: 1000, height: 2000, depth: 600 });
    expect(definition.modelUrl).toBe('/models/closet.glb');
    expect(definition.triangles).toBe(12);
    // Valid glTF-binary container.
    expect(Buffer.from(glb.slice(0, 4)).toString('ascii')).toBe('glTF');
  }, 30000);
});
