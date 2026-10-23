import type { Dimensions, DimensionRange, Millimeters, Vec3 } from './geometry';
import type { FixtureType } from './room';

export type ModuleCategory =
  | 'kitchen-base'
  | 'kitchen-wall'
  | 'kitchen-tall'
  | 'wardrobe-frame'
  | 'wardrobe-internal'
  | 'worktop'
  | 'appliance'
  | 'accessory';

export type MountType = 'floor' | 'wall' | 'ceiling' | 'countertop';

export interface Finish {
  id: string;
  name: string;
  type: 'color' | 'wood' | 'laminate' | 'metal';
  albedo?: string; // hex or texture url
  textureUrl?: string;
  roughness?: number;
  metalness?: number;
  /** Minor currency units. */
  priceModifier: number;
}

export interface ModuleOption {
  id: string;
  name: string; // e.g. "Soft-close hinges"
  group: string; // e.g. "hardware" | "internal-fitting"
  /** Minor currency units. */
  priceDelta: number;
  modelVariantUrl?: string;
}

/** Anchor points that drive snapping in the layout engine. */
export interface SnapAnchor {
  id: string;
  point: Vec3; // module local space
  kind: 'wall-back' | 'side-left' | 'side-right' | 'floor' | 'top' | 'worktop';
}

export interface ModuleConstraints {
  mount: MountType;
  /** Height off the floor for wall-mounted units, plinth height for base, etc. */
  defaultElevation?: Millimeters;
  allowRotation: boolean;
  /** Categories that may stack on top (e.g. worktop on base). */
  stackableWith?: ModuleCategory[];
  /** Required clear space in front (appliances). Used by the layout engine. */
  frontClearance?: Millimeters;
  /**
   * Services this unit is DESIGNED to sit over — a sink base connects
   * `['water','waste']`. Covering one of these is the intended connection, so
   * the conflict engine allows it; covering anything else is still blocked.
   */
  connectsUtilities?: FixtureType[];
  /**
   * Services this unit REQUIRES within reach — an oven needs `['socket']`, a
   * gas hob `['gas']`. A missing one on the same wall raises a warning.
   */
  needsUtilities?: FixtureType[];
}

/** Catalog template. Lives in relational storage. */
export interface ModuleDefinition {
  id: string;
  sku: string;
  name: string;
  category: ModuleCategory;
  description?: string;
  dimensions: Dimensions;
  /** Present when the module is resizable. */
  widthRange?: DimensionRange;
  modelUrl: string; // GLB
  /** Source CAD file (STEP/.step), when the model was generated from CAD. */
  stepUrl?: string;
  thumbnailUrl: string;
  /** Minor currency units. */
  basePrice: number;
  finishes: Finish[];
  options: ModuleOption[];
  anchors: SnapAnchor[];
  constraints: ModuleConstraints;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A placed instance of a {@link ModuleDefinition} inside a Layout. */
export interface ModuleInstance {
  id: string; // unique within the layout
  definitionId: string; // -> ModuleDefinition.id
  position: Vec3; // room space, millimetres
  rotationY: number; // radians (cabinetry rotates around Y)
  /** Chosen width when within the definition's widthRange. */
  width?: Millimeters;
  finishId?: string;
  selectedOptionIds: string[];
  /** Wall this instance is anchored to, if any. */
  wallId?: string;
  /** Engine-computed validity. Not user-authored. */
  valid?: boolean;
}
