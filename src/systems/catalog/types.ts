import type { ModuleDefinition } from '@/lib/types';

/** Surfaces a material can be applied to. */
export type SurfaceRole =
  | 'carcass'
  | 'front'
  | 'worktop'
  | 'handle'
  | 'panel'
  | 'plinth';

export const SURFACE_ROLES: SurfaceRole[] = [
  'carcass',
  'front',
  'worktop',
  'handle',
  'panel',
  'plinth',
];

export type MaterialCategory =
  | 'wood'
  | 'laminate'
  | 'paint'
  | 'stone'
  | 'metal'
  | 'glass';

export interface Material {
  id: string;
  name: string;
  category: MaterialCategory;
  /** Roles this material may be applied to. */
  roles: SurfaceRole[];
  // PBR hints for the renderer
  albedo?: string;
  textureUrl?: string;
  roughness?: number;
  metalness?: number;
  /** Area price for area-billed roles (worktops, fronts), minor units per m². */
  pricePerSqM?: number;
  /** Flat surcharge for unit-billed roles, minor units. */
  surcharge?: number;
  /** Multiplier applied to a module's base cost when used as its front (1 = none). */
  multiplier?: number;
}

export type AddOnCategory = 'lighting' | 'handles' | 'service' | 'accessory';

export type AddOnPricing =
  | { kind: 'flat'; amount: number } // once per project
  | { kind: 'per-module'; amount: number } // × number of modules
  | { kind: 'per-meter'; amount: number }; // × total cabinetry run length

/** A selectable project add-on: lighting, handle sets, survey/install services. */
export interface AddOn {
  id: string;
  name: string;
  category: AddOnCategory;
  description?: string;
  pricing: AddOnPricing;
}

/**
 * A curated palette. Selecting a style LOCKS which materials are allowed per
 * surface role — the configurator never offers a material outside `palette`.
 */
export interface StylePreset {
  id: string;
  name: string;
  description?: string;
  /** Allowed material ids per surface role — the locked palette. */
  palette: Record<SurfaceRole, string[]>;
  /** Default material id per role. */
  defaults: Record<SurfaceRole, string>;
  thumbnailUrl?: string;
}

/** The product catalog. In production this hydrates from Supabase. */
export interface Catalog {
  materials: Record<string, Material>;
  styles: Record<string, StylePreset>;
  definitions: Record<string, ModuleDefinition>;
  addOns: Record<string, AddOn>;
}
