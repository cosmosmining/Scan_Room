import { describe, expect, it } from 'vitest';
import { createDefaultRoom } from '@/lib/defaults';
import {
  addChild,
  createNode,
  createRoot,
  type ProjectConfiguration,
} from '@/systems/config';
import {
  buildSharePayload,
  configurationId,
  decodeShare,
  encodeShare,
} from '@/systems/handoff';

function sampleConfig(): ProjectConfiguration {
  const tree = addChild(
    createRoot(),
    'root',
    createNode('base-600', 'module', { width: 600, wallId: 'wall_0' }),
  );
  return {
    styleId: 'modern-matte',
    materialOverrides: {},
    moduleTree: tree,
    layoutGraph: { nodes: [], edges: [] },
    selectedAddOnIds: ['led-lighting'],
  };
}

describe('handoff', () => {
  it('share link round-trips losslessly', () => {
    const payload = buildSharePayload(sampleConfig(), createDefaultRoom());
    const decoded = decodeShare(encodeShare(payload));
    expect(decoded).not.toBeNull();
    expect(decoded?.styleId).toBe('modern-matte');
    expect(decoded?.selectedAddOnIds).toEqual(['led-lighting']);
    expect(decoded?.tree[0]?.definitionId).toBe('base-600');
    expect(decoded?.tree[0]?.width).toBe(600);
  });

  it('rejects a corrupt share code', () => {
    expect(decodeShare('not-valid-base64!!')).toBeNull();
  });

  it('configuration id is content-addressed (stable across session ids)', () => {
    // Two builds of the same design — different random node ids, same content.
    expect(configurationId(sampleConfig())).toBe(configurationId(sampleConfig()));
  });

  it('configuration id changes when the design changes', () => {
    const a = configurationId(sampleConfig());
    const changed = sampleConfig();
    changed.styleId = 'classic-dark';
    expect(configurationId(changed)).not.toBe(a);
  });
});
