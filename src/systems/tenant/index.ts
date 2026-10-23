import {
  PLATFORM_LAYERING,
  TENANTS,
  DEFAULT_TENANT_ID,
  MOZU_TENANT,
} from './tenants';
import type { BrandTokens, PlatformFeature, PlatformLayer, TenantConfig } from './types';

export * from './types';
export {
  PLATFORM_LAYERING,
  TENANTS,
  DEFAULT_TENANT_ID,
  MOZU_TENANT,
  ROOMMUSE_CORE,
  SAMPLE_COMPETITOR,
} from './tenants';

/** Resolve a tenant by id, falling back to the default (Mozu). */
export function resolveTenant(id: string = DEFAULT_TENANT_ID): TenantConfig {
  return TENANTS[id] ?? MOZU_TENANT;
}

/** The layer a feature is owned at for this tenant. */
export function layerOf(tenant: TenantConfig, feature: PlatformFeature): PlatformLayer {
  return tenant.features[feature];
}

/** Is this feature exclusive to (owned at the brand layer by) this tenant? */
export function isExclusive(tenant: TenantConfig, feature: PlatformFeature): boolean {
  return tenant.features[feature] === 'brand';
}

/** Every feature this tenant owns exclusively (its private Layer-3 stack). */
export function exclusiveFeatures(tenant: TenantConfig): PlatformFeature[] {
  return (Object.keys(tenant.features) as PlatformFeature[]).filter((f) =>
    isExclusive(tenant, f),
  );
}

/** Features at a given layer for this tenant. */
export function featuresAtLayer(
  tenant: TenantConfig,
  layer: PlatformLayer,
): PlatformFeature[] {
  return (Object.keys(tenant.features) as PlatformFeature[]).filter(
    (f) => tenant.features[f] === layer,
  );
}

/**
 * Is a feature shared across brands at the platform level? Core and white-label
 * features are licensable to any brand; brand-layer features are private. This
 * is the answer to "can a competitor use this too?" — yes for the core/
 * white-label tiers, never for another tenant's brand layer.
 */
export function isSharedAcrossBrands(feature: PlatformFeature): boolean {
  return PLATFORM_LAYERING[feature] !== 'brand';
}

/**
 * What `viewer` can access of `owner`'s capabilities. A viewer always gets the
 * shared core + white-label tiers; it gets a brand feature only if it is the
 * owner. Proves Mozu's workflow/AI/themes stay invisible to other tenants.
 */
export function accessibleFeatures(
  owner: TenantConfig,
  viewer: TenantConfig,
): PlatformFeature[] {
  return (Object.keys(owner.features) as PlatformFeature[]).filter((f) => {
    if (isSharedAcrossBrands(f)) return true;
    return owner.id === viewer.id; // brand-layer features: owner only
  });
}

/** The brand presentation tokens for a tenant (UI skin). */
export function brandTokens(tenant: TenantConfig): BrandTokens {
  return tenant.brand;
}
