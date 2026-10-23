import type { PlatformFeature, PlatformLayer, TenantConfig } from './types';

/**
 * The canonical platform layering — the proposal's three-layer table. Used as
 * the baseline a tenant config is built from, and to reason about what is shared
 * across brands vs. private to one.
 */
export const PLATFORM_LAYERING: Record<PlatformFeature, PlatformLayer> = {
  // Layer 1 — Core (shared by all brands; data still isolated per tenant)
  'room-scanning': 'core',
  'ar-visualization': 'core',
  'data-storage': 'core',
  'tenant-isolation': 'core',
  // Layer 2 — Configurable / white-label (licensable to other brands)
  'product-catalog': 'white-label',
  '2d-editor': 'white-label',
  'booking-pricing': 'white-label',
  'style-cards': 'white-label',
  // Layer 3 — Brand customization (exclusive to the operating tenant)
  'ai-layout': 'brand',
  'curated-themes': 'brand',
  workflow: 'brand',
  'brand-ui': 'brand',
};

/**
 * Mozu — the launch tenant. Owns the full Layer-3 stack (AI layout logic,
 * curated themes, the complete user workflow and branded UI) exclusively, on a
 * two-year window, while expanding across modular categories (kitchen, wardrobe,
 * and later sofas / beds within its own branded space).
 */
export const MOZU_TENANT: TenantConfig = {
  id: 'mozu',
  operator: 'Mozu',
  brand: {
    name: 'MOZU',
    tagline: 'Modular Living System Configurator',
    primary: '#1C1C1E',
    accent: '#B89B72',
    wordmark: 'MOZU',
  },
  features: { ...PLATFORM_LAYERING },
  exclusiveThemeIds: ['japandi', 'modern-matte', 'nordic-oak', 'industrial-loft', 'classic-walnut'],
  categories: ['kitchen', 'wardrobe'],
  exclusivityMonths: 24,
};

/**
 * RoomMuse Core — the bare platform tenant (Layers 1–2 only). Illustrates what a
 * brand gets *without* a Layer-3 partnership: core tech plus the configurable
 * white-label features, but no exclusive workflow / AI / themes of its own.
 */
export const ROOMMUSE_CORE: TenantConfig = {
  id: 'roommuse-core',
  operator: 'RoomMuse',
  brand: {
    name: 'RoomMuse',
    tagline: 'AR visualization platform',
    primary: '#2563EB',
    accent: '#22D3EE',
    wordmark: 'RM',
  },
  features: {
    ...PLATFORM_LAYERING,
    // No brand-layer ownership — these are "build your own" at the white-label tier.
    'ai-layout': 'white-label',
    'curated-themes': 'white-label',
    workflow: 'white-label',
    'brand-ui': 'white-label',
  },
  exclusiveThemeIds: [],
  categories: [],
  exclusivityMonths: 0,
};

/**
 * A competitor brand in a different category (sofas). Runs on the same core +
 * white-label tech, but must design its own workflow and logic — it cannot see
 * or replicate Mozu's Layer-3 experience. This is the concrete answer to "other
 * competitors will use these apps as well, correct?": yes, the *core* — never
 * Mozu's branded experience.
 */
export const SAMPLE_COMPETITOR: TenantConfig = {
  id: 'acme-sofas',
  operator: 'Acme Sofas',
  brand: {
    name: 'Acme Sofas',
    tagline: 'Made-to-measure seating',
    primary: '#7C3AED',
    accent: '#F59E0B',
    wordmark: 'AS',
  },
  features: {
    ...PLATFORM_LAYERING,
    'ai-layout': 'white-label',
    'curated-themes': 'white-label',
    workflow: 'white-label',
    'brand-ui': 'white-label',
  },
  exclusiveThemeIds: [],
  categories: ['sofa', 'bed'],
  exclusivityMonths: 0,
};

export const TENANTS: Record<string, TenantConfig> = {
  [MOZU_TENANT.id]: MOZU_TENANT,
  [ROOMMUSE_CORE.id]: ROOMMUSE_CORE,
  [SAMPLE_COMPETITOR.id]: SAMPLE_COMPETITOR,
};

export const DEFAULT_TENANT_ID = MOZU_TENANT.id;
