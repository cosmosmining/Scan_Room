/**
 * Multi-Tenant Platform + Layered Customization (the partnership architecture).
 *
 * Three layers answer Ken's concern that competitors could ride the same tech:
 *
 *   Layer 1 — Core (RoomMuse, shared)        scanning · AR · storage · isolation
 *   Layer 2 — White-label (configurable)     catalog · 2D editor · booking · cards
 *   Layer 3 — Brand (Mozu-exclusive)         workflow · AI logic · curated themes · UI
 *
 * Every brand runs on Layers 1–2; only the operating tenant owns its Layer 3.
 * A competitor can license the core and white-label feature set but can never
 * see or replicate Mozu's workflow, AI recommendations or curated themes — and
 * tenant data is always isolated. This module is the machine-readable contract
 * for that, so the app (and any access check) can ask "who owns what".
 */

export type PlatformLayer = 'core' | 'white-label' | 'brand';

/** Every capability the platform exposes, grouped by its canonical layer. */
export type PlatformFeature =
  // Layer 1 — Core (RoomMuse standardized, shared by all brands)
  | 'room-scanning'
  | 'ar-visualization'
  | 'data-storage'
  | 'tenant-isolation'
  // Layer 2 — Configurable / white-label (licensable to other brands)
  | 'product-catalog'
  | '2d-editor'
  | 'booking-pricing'
  | 'style-cards'
  // Layer 3 — Brand customization (exclusive to the operating tenant)
  | 'ai-layout'
  | 'curated-themes'
  | 'workflow'
  | 'brand-ui';

/** Brand presentation tokens — the visible skin of a tenant's showroom. */
export interface BrandTokens {
  name: string;
  tagline: string;
  /** Primary brand colour (hex). */
  primary: string;
  /** Accent colour (hex). */
  accent: string;
  /** Wordmark / glyph placeholder. */
  wordmark: string;
}

/**
 * A tenant (operating brand) on the platform. `features` records the layer each
 * capability is owned at *for this tenant*: `brand` means exclusive to them;
 * `white-label` means licensable/"build your own"; `core` means shared platform.
 */
export interface TenantConfig {
  id: string;
  /** The operating company. */
  operator: string;
  brand: BrandTokens;
  features: Record<PlatformFeature, PlatformLayer>;
  /** Theme ids exclusive to this tenant's brand layer (invisible to others). */
  exclusiveThemeIds: string[];
  /** Product category families this tenant operates in. */
  categories: string[];
  /** Months the brand-layer work is contractually exclusive (0 = not exclusive). */
  exclusivityMonths: number;
}
