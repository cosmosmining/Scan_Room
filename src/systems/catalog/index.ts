import type { ModuleDefinition } from '@/lib/types';
import type {
  AddOn,
  Catalog,
  Material,
  StylePreset,
  SurfaceRole,
} from './types';

export * from './types';
export { defaultCatalog, DEFAULT_STYLE_ID } from './data';

export const getMaterial = (catalog: Catalog, id: string): Material | undefined =>
  catalog.materials[id];

export const getStyle = (catalog: Catalog, id: string): StylePreset | undefined =>
  catalog.styles[id];

export const getDefinition = (
  catalog: Catalog,
  id: string,
): ModuleDefinition | undefined => catalog.definitions[id];

/** Is `materialId` permitted for `role` under this style? Enforces the lock. */
export const isMaterialAllowed = (
  style: StylePreset,
  role: SurfaceRole,
  materialId: string,
): boolean => style.palette[role]?.includes(materialId) ?? false;

/** Material objects allowed for a role under the active style. */
export const materialsForRole = (
  catalog: Catalog,
  style: StylePreset,
  role: SurfaceRole,
): Material[] =>
  (style.palette[role] ?? [])
    .map((id) => catalog.materials[id])
    .filter((m): m is Material => Boolean(m));

/** All placeable (non-accessory) definitions, for catalog browsing UIs. */
export const placeableDefinitions = (catalog: Catalog): ModuleDefinition[] =>
  Object.values(catalog.definitions).filter(
    (d) => d.active && d.category !== 'accessory',
  );

export const addOnList = (catalog: Catalog): AddOn[] =>
  Object.values(catalog.addOns);

export const getAddOn = (catalog: Catalog, id: string): AddOn | undefined =>
  catalog.addOns[id];
