import { describe, expect, it } from 'vitest';
import { defaultCatalog } from '@/systems/catalog';
import {
  addChild,
  createNode,
  createRoot,
  type ConfigNode,
  type ProjectConfiguration,
} from '@/systems/config';
import { computePricing } from '@/systems/pricing';

function config(nodes: ConfigNode[], addOns: string[] = []): ProjectConfiguration {
  let tree = createRoot();
  for (const n of nodes) tree = addChild(tree, 'root', n);
  return {
    styleId: 'modern-matte',
    materialOverrides: {},
    moduleTree: tree,
    layoutGraph: { nodes: [], edges: [] },
    selectedAddOnIds: addOns,
  };
}

describe('pricing engine', () => {
  it('prices an empty configuration at zero', () => {
    const p = computePricing(config([]), defaultCatalog, {
      taxRate: 0.2,
      installFlat: 15000,
      deliveryFlat: 5000,
    });
    expect(p.total).toBe(0);
  });

  it('applies installation per cabinet and tax on the subtotal', () => {
    const p = computePricing(config([createNode('base-600', 'module')]), defaultCatalog, {
      taxRate: 0.2,
      installFlat: 15000,
      installPerModule: 6000,
    });
    expect(p.itemsSubtotal).toBeGreaterThan(0);
    expect(p.installation).toBe(21000); // 15000 + 6000 × 1 cabinet
    expect(p.total).toBeGreaterThan(p.itemsSubtotal + p.installation); // + tax
  });

  it('a pricier front material raises the item subtotal (multiplier)', () => {
    const white = computePricing(
      config([createNode('base-600', 'module', { materials: { front: 'matte-white' } })]),
      defaultCatalog,
      {},
    );
    const graphite = computePricing(
      config([createNode('base-600', 'module', { materials: { front: 'graphite' } })]),
      defaultCatalog,
      {},
    );
    expect(graphite.itemsSubtotal).toBeGreaterThan(white.itemsSubtotal);
  });

  it('adds a flat add-on to the total exactly', () => {
    const node = () => createNode('base-600', 'module');
    const without = computePricing(config([node()]), defaultCatalog, {});
    const withAddon = computePricing(config([node()], ['survey-template']), defaultCatalog, {});
    expect(withAddon.addOnsSubtotal).toBe(25000); // survey-template flat
    expect(withAddon.total).toBe(without.total + 25000);
  });

  it('parametric base scales with width', () => {
    const narrow = computePricing(config([createNode('base-600', 'module', { width: 300 })]), defaultCatalog, {});
    const wide = computePricing(config([createNode('base-600', 'module', { width: 1200 })]), defaultCatalog, {});
    expect(wide.itemsSubtotal).toBeGreaterThan(narrow.itemsSubtotal);
  });
});
