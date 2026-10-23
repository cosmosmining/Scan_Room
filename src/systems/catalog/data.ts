import type {
  ModuleCategory,
  ModuleConstraints,
  ModuleDefinition,
} from '@/lib/types';
import type { AddOn, Catalog, Material, StylePreset } from './types';

const TS = '2026-01-01T00:00:00.000Z';

// ── Materials ────────────────────────────────────────────────────────────────

const MATERIALS: Material[] = [
  { id: 'matte-white', name: 'Matte White', category: 'paint', roles: ['carcass', 'front', 'panel', 'plinth'], albedo: '#ECECEC', roughness: 0.8, surcharge: 0, multiplier: 1 },
  { id: 'graphite', name: 'Graphite', category: 'paint', roles: ['front', 'panel', 'plinth'], albedo: '#3A3A3D', roughness: 0.7, surcharge: 4000, multiplier: 1.05 },
  { id: 'oak', name: 'Natural Oak', category: 'wood', roles: ['carcass', 'front', 'panel'], albedo: '#C8A165', roughness: 0.6, surcharge: 9000, multiplier: 1.15 },
  { id: 'walnut', name: 'Walnut', category: 'wood', roles: ['front', 'panel'], albedo: '#5B3A24', roughness: 0.55, surcharge: 14000, multiplier: 1.4 },
  { id: 'quartz-white', name: 'White Quartz', category: 'stone', roles: ['worktop'], albedo: '#F4F4F0', roughness: 0.3, pricePerSqM: 38000 },
  { id: 'granite-black', name: 'Black Granite', category: 'stone', roles: ['worktop'], albedo: '#1C1C1E', roughness: 0.25, pricePerSqM: 52000 },
  { id: 'brushed-steel', name: 'Brushed Steel', category: 'metal', roles: ['handle'], albedo: '#9A9A9D', roughness: 0.4, metalness: 0.9, surcharge: 1500 },
  // Curated-theme materials (referenced by src/systems/aesthetic themes, e.g. Japandi).
  { id: 'clay-plaster', name: 'Clay Plaster', category: 'paint', roles: ['carcass', 'front', 'panel', 'plinth'], albedo: '#E5DCCC', roughness: 0.92, surcharge: 3000, multiplier: 1.05 },
  { id: 'bamboo', name: 'Honey Bamboo', category: 'wood', roles: ['carcass', 'front', 'panel'], albedo: '#C9B083', roughness: 0.62, surcharge: 8000, multiplier: 1.12 },
  { id: 'charcoal-ash', name: 'Charcoal Ash', category: 'wood', roles: ['front', 'panel'], albedo: '#2E2A27', roughness: 0.5, surcharge: 12000, multiplier: 1.3 },
  { id: 'travertine', name: 'Travertine', category: 'stone', roles: ['worktop'], albedo: '#E3DAC7', roughness: 0.45, pricePerSqM: 46000 },
  { id: 'blackened-brass', name: 'Blackened Brass', category: 'metal', roles: ['handle'], albedo: '#4A3F2C', roughness: 0.5, metalness: 0.85, surcharge: 3500 },
];

// ── Style presets (lock the palette) ─────────────────────────────────────────

const STYLES: StylePreset[] = [
  {
    id: 'modern-matte',
    name: 'Modern Matte',
    description: 'Handleless matte fronts with quartz tops.',
    palette: {
      carcass: ['matte-white', 'oak'],
      front: ['matte-white', 'graphite'],
      worktop: ['quartz-white', 'granite-black'],
      handle: ['brushed-steel'],
      panel: ['matte-white', 'graphite'],
      plinth: ['matte-white', 'graphite'],
    },
    defaults: { carcass: 'matte-white', front: 'matte-white', worktop: 'quartz-white', handle: 'brushed-steel', panel: 'matte-white', plinth: 'matte-white' },
  },
  {
    id: 'scandi-wood',
    name: 'Scandi Wood',
    description: 'Warm oak fronts, light and natural.',
    palette: {
      carcass: ['oak', 'matte-white'],
      front: ['oak', 'matte-white'],
      worktop: ['quartz-white'],
      handle: ['brushed-steel'],
      panel: ['oak', 'matte-white'],
      plinth: ['matte-white'],
    },
    defaults: { carcass: 'oak', front: 'oak', worktop: 'quartz-white', handle: 'brushed-steel', panel: 'oak', plinth: 'matte-white' },
  },
  {
    id: 'classic-dark',
    name: 'Classic Dark',
    description: 'Graphite and walnut with black granite.',
    palette: {
      carcass: ['matte-white'],
      front: ['graphite', 'walnut'],
      worktop: ['granite-black'],
      handle: ['brushed-steel'],
      panel: ['graphite', 'walnut'],
      plinth: ['graphite'],
    },
    defaults: { carcass: 'matte-white', front: 'graphite', worktop: 'granite-black', handle: 'brushed-steel', panel: 'graphite', plinth: 'graphite' },
  },
];

export const DEFAULT_STYLE_ID = 'modern-matte';

// ── Module definitions ───────────────────────────────────────────────────────

interface DefInput {
  id: string;
  name: string;
  category: ModuleCategory;
  width: number;
  height: number;
  depth: number;
  basePrice: number;
  constraints: ModuleConstraints;
  resizable?: boolean;
  options?: ModuleDefinition['options'];
  /** Set when the GLB was generated from a CAD source (see scripts/cad). */
  stepUrl?: string;
}

function def(p: DefInput): ModuleDefinition {
  return {
    id: p.id,
    sku: p.id.toUpperCase(),
    name: p.name,
    category: p.category,
    dimensions: { width: p.width, height: p.height, depth: p.depth },
    widthRange: p.resizable
      ? { min: 300, max: 1200, step: 100, default: p.width }
      : undefined,
    modelUrl: `/models/${p.id}.glb`,
    stepUrl: p.stepUrl,
    thumbnailUrl: `/thumbnails/${p.id}.png`,
    basePrice: p.basePrice,
    finishes: [],
    options: p.options ?? [],
    anchors: [],
    constraints: p.constraints,
    active: true,
    createdAt: TS,
    updatedAt: TS,
  };
}

const base: ModuleConstraints = { mount: 'floor', allowRotation: true, defaultElevation: 0 };
const wallMount: ModuleConstraints = { mount: 'wall', allowRotation: true, defaultElevation: 1500 };

const DEFINITIONS: ModuleDefinition[] = [
  def({
    id: 'base-600', name: 'Base Cabinet 600', category: 'kitchen-base',
    width: 600, height: 900, depth: 600, basePrice: 18000, constraints: base, resizable: true,
    options: [
      { id: 'soft-close', name: 'Soft-close hinges', group: 'hardware', priceDelta: 2500 },
      { id: 'inner-drawer', name: 'Inner drawer', group: 'internal-fitting', priceDelta: 6000 },
    ],
  }),
  def({ id: 'base-800', name: 'Base Cabinet 800', category: 'kitchen-base', width: 800, height: 900, depth: 600, basePrice: 22000, constraints: base, resizable: true }),
  def({ id: 'wall-600', name: 'Wall Cabinet 600', category: 'kitchen-wall', width: 600, height: 720, depth: 350, basePrice: 14000, constraints: wallMount, resizable: true }),
  def({ id: 'tall-600', name: 'Tall Larder 600', category: 'kitchen-tall', width: 600, height: 2100, depth: 600, basePrice: 42000, constraints: base }),
  def({ id: 'worktop-seg', name: 'Worktop Segment', category: 'worktop', width: 1000, height: 40, depth: 600, basePrice: 0, constraints: { mount: 'countertop', allowRotation: true, defaultElevation: 900 }, resizable: true }),
  def({ id: 'oven-600', name: 'Built-in Oven 600', category: 'appliance', width: 600, height: 900, depth: 600, basePrice: 65000, constraints: { mount: 'floor', allowRotation: false, defaultElevation: 0, frontClearance: 1100, needsUtilities: ['socket'] } }),
  def({ id: 'wardrobe-1000', name: 'Wardrobe Frame 1000', category: 'wardrobe-frame', width: 1000, height: 2200, depth: 600, basePrice: 30000, constraints: base, resizable: true }),
  def({ id: 'drawer-insert', name: 'Internal Drawer Set', category: 'accessory', width: 0, height: 0, depth: 0, basePrice: 7000, constraints: { mount: 'floor', allowRotation: false } }),
  // Kitchen-set primitives the AI baseline composes (sink · drawers · fridge · hood · stove).
  // A sink base is MEANT to sit over the water and waste connections, so the
  // conflict engine treats that as the intended connection rather than a unit
  // sealing off pipework.
  def({ id: 'sink-base-800', name: 'Sink Base 800', category: 'kitchen-base', width: 800, height: 900, depth: 600, basePrice: 26000, constraints: { ...base, connectsUtilities: ['water', 'waste'] }, resizable: true }),
  def({ id: 'drawer-base-600', name: 'Drawer Base 600', category: 'kitchen-base', width: 600, height: 900, depth: 600, basePrice: 24000, constraints: base, resizable: true }),
  def({ id: 'cooker-600', name: 'Range Cooker 600', category: 'appliance', width: 600, height: 900, depth: 600, basePrice: 55000, constraints: { mount: 'floor', allowRotation: false, defaultElevation: 0, frontClearance: 1100, needsUtilities: ['gas'] } }),
  def({ id: 'fridge-600', name: 'Refrigerator 600', category: 'appliance', width: 600, height: 2000, depth: 650, basePrice: 90000, constraints: { mount: 'floor', allowRotation: false, defaultElevation: 0, frontClearance: 1100, needsUtilities: ['socket'] } }),
  def({ id: 'hood-600', name: 'Extractor Hood 600', category: 'appliance', width: 600, height: 400, depth: 350, basePrice: 30000, constraints: { mount: 'wall', allowRotation: false, defaultElevation: 1500, needsUtilities: ['socket'] } }),
  // STEP-sourced furniture — geometry + dimensions generated from CAD by
  // scripts/cad/build-furniture.mjs (real GLB models render in the viewer).
  def({ id: 'closet-1000', name: 'Wardrobe Closet 1000', category: 'wardrobe-frame', width: 1000, height: 2000, depth: 600, basePrice: 32000, constraints: base, stepUrl: '/cad/closet-1000.step' }),
  def({ id: 'cad-base-600', name: 'CAD Base Cabinet 600', category: 'kitchen-base', width: 600, height: 900, depth: 600, basePrice: 21000, constraints: base, stepUrl: '/cad/cad-base-600.step' }),
];

// ── Add-ons ──────────────────────────────────────────────────────────────────

const ADDONS: AddOn[] = [
  { id: 'led-lighting', name: 'Under-cabinet LED lighting', category: 'lighting', description: 'Warm-white strip along the run.', pricing: { kind: 'per-meter', amount: 4500 } },
  { id: 'designer-handles', name: 'Designer handle set', category: 'handles', description: 'Solid brass bar handles.', pricing: { kind: 'per-module', amount: 3500 } },
  { id: 'soft-close-all', name: 'Soft-close everywhere', category: 'accessory', description: 'Soft-close on every door and drawer.', pricing: { kind: 'per-module', amount: 2000 } },
  { id: 'survey-template', name: 'Survey & template', category: 'service', description: 'On-site measure before manufacture.', pricing: { kind: 'flat', amount: 25000 } },
];

// ── Assembled catalog ────────────────────────────────────────────────────────

const index = <T extends { id: string }>(items: T[]): Record<string, T> =>
  Object.fromEntries(items.map((i): [string, T] => [i.id, i]));

export const defaultCatalog: Catalog = {
  materials: index(MATERIALS),
  styles: index(STYLES),
  definitions: index(DEFINITIONS),
  addOns: index(ADDONS),
};
