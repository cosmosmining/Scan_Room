import { describe, expect, it } from 'vitest';
import {
  MOZU_TENANT,
  ROOMMUSE_CORE,
  SAMPLE_COMPETITOR,
  resolveTenant,
  isExclusive,
  exclusiveFeatures,
  featuresAtLayer,
  isSharedAcrossBrands,
  accessibleFeatures,
} from '@/systems/tenant';

describe('multi-tenant layered architecture', () => {
  it('resolves tenants and falls back to Mozu', () => {
    expect(resolveTenant('mozu').id).toBe('mozu');
    expect(resolveTenant('does-not-exist').id).toBe('mozu');
  });

  it('Mozu exclusively owns the Layer-3 stack (AI, themes, workflow, UI)', () => {
    const exclusive = exclusiveFeatures(MOZU_TENANT);
    expect(exclusive.sort()).toEqual(
      ['ai-layout', 'brand-ui', 'curated-themes', 'workflow'].sort(),
    );
    expect(MOZU_TENANT.exclusivityMonths).toBe(24); // two-year window
  });

  it('keeps the core layer shared by every brand', () => {
    for (const tenant of [MOZU_TENANT, ROOMMUSE_CORE, SAMPLE_COMPETITOR]) {
      expect(featuresAtLayer(tenant, 'core')).toContain('room-scanning');
      expect(featuresAtLayer(tenant, 'core')).toContain('ar-visualization');
    }
    expect(isSharedAcrossBrands('room-scanning')).toBe(true);
    expect(isSharedAcrossBrands('2d-editor')).toBe(true); // white-label is licensable
    expect(isSharedAcrossBrands('ai-layout')).toBe(false); // brand layer is private
  });

  it('a competitor cannot access Mozu’s brand layer, only the shared tech', () => {
    expect(isExclusive(SAMPLE_COMPETITOR, 'ai-layout')).toBe(false); // build-your-own
    const competitorView = accessibleFeatures(MOZU_TENANT, SAMPLE_COMPETITOR);
    // Shared tiers are visible…
    expect(competitorView).toContain('room-scanning');
    expect(competitorView).toContain('product-catalog');
    // …Mozu's exclusive workflow / AI / themes are NOT.
    expect(competitorView).not.toContain('ai-layout');
    expect(competitorView).not.toContain('curated-themes');
    expect(competitorView).not.toContain('workflow');
  });

  it('grants Mozu full access to its own brand layer', () => {
    const ownView = accessibleFeatures(MOZU_TENANT, MOZU_TENANT);
    expect(ownView).toContain('ai-layout');
    expect(ownView).toContain('curated-themes');
    expect(ownView).toContain('workflow');
  });

  it('isolates tenant data as a core guarantee', () => {
    expect(featuresAtLayer(MOZU_TENANT, 'core')).toContain('tenant-isolation');
  });
});
