import type { StepId } from '@/lib/constants';
import type {
  DesignDomain,
  LayoutType,
  ModuleInstance,
  PriceBreakdown,
  Room,
  Vec3,
} from '@/lib/types';
import type { AestheticTheme } from '@/systems/aesthetic';
import type { FinishTarget, SurfaceFinish } from '@/systems/aesthetic/finishes';
import type { PlacedFurniture } from '@/systems/furniture/catalog';
import type { Catalog, SurfaceRole } from '@/systems/catalog';
import type { ConfigNode, LayoutGraph } from '@/systems/config';
import type { SharePayload } from '@/systems/handoff';
import type { Violation } from '@/systems/layout';
import type { RoomGeometry } from '@/systems/scan';

/** Room geometry currently being designed. */
export interface RoomSlice {
  room: Room;
  setRoom: (room: Room) => void;
  updateRoom: (patch: Partial<Room>) => void;
  resetRoom: () => void;
}

/** Product catalog (materials, styles, definitions). Hydrates from Supabase later. */
export interface CatalogSlice {
  catalog: Catalog;
  setCatalog: (catalog: Catalog) => void;
}

/** The parametric configuration: module tree + derived placement + layout graph. */
export interface ConfigurationSlice {
  moduleTree: ConfigNode;
  layoutGraph: LayoutGraph;
  /** Derived placed instances for the 3D scene. Do not mutate directly. */
  instances: ModuleInstance[];
  layoutViolations: Violation[];
  /** Selected project add-on ids (lighting, handles, services). */
  selectedAddOnIds: string[];
  addModule: (
    definitionId: string,
    opts?: { wallId?: string; width?: number },
  ) => void;
  addAccessory: (parentId: string, definitionId: string) => void;
  removeNode: (id: string) => void;
  updateNode: (id: string, patch: Partial<ConfigNode>) => void;
  /**
   * Place a unit by hand, at an exact position and yaw. This takes it out of
   * the automatic run — see `ConfigNode.pinned` — so a drag actually moves it
   * instead of the packer putting it straight back.
   */
  setNodeTransform: (id: string, transform: { position: Vec3; rotationY: number }) => void;
  /** Hand it back to the layout engine, to be packed along its wall again. */
  unpinNode: (id: string) => void;
  setNodeMaterial: (id: string, role: SurfaceRole, materialId: string) => void;
  toggleAddOn: (addOnId: string) => void;
  /** Re-run the layout engine over the current tree + room, then reprice. */
  regenerateLayout: () => void;
  /**
   * Replace the module tree with a planned set — an AI recommendation or the
   * generated baseline — then relayout. This is how a "Kitchen Set" / "Need
   * advice" suggestion becomes the live configuration.
   */
  applyPlannedModules: (
    modules: { definitionId: string; wallId: string; width?: number }[],
  ) => void;
  /** Apply captured room geometry (manual / floorplan / scan), then relayout. */
  applyRoomGeometry: (geometry: RoomGeometry) => void;
  /** Hydrate the whole configuration from a decoded share link. */
  loadShare: (payload: SharePayload) => void;
}

/** Design domain + high-level arrangement. */
export interface LayoutSlice {
  domain: DesignDomain;
  layoutType: LayoutType;
  setDomain: (domain: DesignDomain) => void;
  setLayoutType: (layoutType: LayoutType) => void;
}

/** Selected style + global material overrides, enforced against the palette. */
export interface StyleSlice {
  styleId: string;
  materialOverrides: Partial<Record<SurfaceRole, string>>;
  setStyle: (styleId: string) => void;
  setRoleMaterial: (role: SurfaceRole, materialId: string) => void;
  /**
   * Curated Aesthetic Mapping: apply a theme directive (e.g. "Japandi"). Injects
   * the theme's curated palette as a selectable style, locks it, and sets the
   * hero materials per role.
   */
  applyTheme: (theme: AestheticTheme) => void;
  /** Apply one of a theme's generated variations (a chosen role→material map). */
  applyThemeVariation: (materials: Partial<Record<SurfaceRole, string>>) => void;
}

/** Pricing state, derived from the configuration by the pricing engine. */
export interface PricingSlice {
  pricing: PriceBreakdown;
  isPricing: boolean;
  recomputePricing: () => void;
  setPricing: (pricing: PriceBreakdown) => void;
}

/** UI / step navigation state. */
export interface UiSlice {
  currentStep: StepId;
  selectedNodeId: string | null;
  leftPanelOpen: boolean;
  setStep: (step: StepId) => void;
  nextStep: () => void;
  prevStep: () => void;
  selectNode: (id: string | null) => void;
  toggleLeftPanel: () => void;
  setLeftPanelOpen: (open: boolean) => void;
}

export type LightingPreset = 'studio' | 'daylight' | 'evening';
export type ViewMode = '3d' | '2d' | 'floorplan';

/** 3D viewer settings (lighting, scale avatar, snapping viz, 2D fallback). */
export interface ViewerSlice {
  lightingPreset: LightingPreset;
  /** Real-scale human avatar height, centimetres (140–200). */
  avatarHeight: number;
  showAvatar: boolean;
  showSnapGuides: boolean;
  viewMode: ViewMode;
  setLightingPreset: (preset: LightingPreset) => void;
  setAvatarHeight: (cm: number) => void;
  toggleAvatar: () => void;
  toggleSnapGuides: () => void;
  setViewMode: (mode: ViewMode) => void;
}

/**
 * Free-form design: catalogue furniture placed anywhere in the room, the room's
 * own surface finishes, and wall-corner editing. The web port of the iPad's
 * `DesignState` — see `slices/designSlice.ts` for why this is a second mode
 * beside the parametric module tree rather than a replacement for it.
 */
export interface DesignSlice {
  designItems: PlacedFurniture[];
  designSelection: string | null;
  /**
   * Per-unit finishes for kitchen modules, keyed by node id. Catalogue pieces
   * carry their finish on the placed item; modules live in the config tree,
   * whose `materials` are catalogue material ids priced by role — a different
   * thing from a surface finish, and not one to overload.
   */
  moduleFinishes: Record<string, SurfaceFinish>;
  /** Room surface finishes. The 3D scene renders these. */
  wallFinish: SurfaceFinish;
  floorFinish: SurfaceFinish;
  ceilingFinish: SurfaceFinish;
  /** What the finish editor is pointed at. */
  finishTarget: FinishTarget;
  /** Whether the plan shows draggable footprint vertices. */
  editWalls: boolean;
  /** Place a catalogue item near the room centre. Returns its instance id. */
  addFurniture: (itemId: string) => string | null;
  /** Drop a whole "Need advice" set into the room and select its first item. */
  applyRecommendation: (items: Omit<PlacedFurniture, 'id'>[]) => void;
  /** Clear every placed item. */
  clearFurniture: () => void;
  removeFurniture: (id: string) => void;
  duplicateFurniture: (id: string) => string | null;
  /** Millimetres, floor plane. Clamped into the room. */
  moveFurniture: (id: string, position: { x: number; z: number }) => void;
  rotateFurniture: (id: string, rotationY: number) => void;
  selectFurniture: (id: string | null) => void;
  setFinishTarget: (target: FinishTarget) => void;
  applyFinish: (finish: SurfaceFinish, target: FinishTarget) => void;
  currentFinish: (target: FinishTarget) => SurfaceFinish | undefined;
  toggleEditWalls: () => void;
  /** Drag a room corner, carrying the two walls that meet there. */
  moveFootprintVertex: (index: number, point: { x: number; z: number }) => void;
}

export type ConfiguratorState = RoomSlice &
  CatalogSlice &
  ConfigurationSlice &
  LayoutSlice &
  StyleSlice &
  PricingSlice &
  UiSlice &
  ViewerSlice &
  DesignSlice;
