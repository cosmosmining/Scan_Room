import type { ModuleInstance } from '@/lib/types';
import {
  materialsForRole,
  type Material,
  type StylePreset,
  type SurfaceRole,
} from '@/systems/catalog';
import type { ProjectConfiguration } from '@/systems/config';
import type { ConfiguratorState } from './types';

/** Placed instances for the 3D scene (derived cache). */
export const selectInstances = (s: ConfiguratorState): ModuleInstance[] =>
  s.instances;

/** Assemble the serializable configuration aggregate (pricing / persistence). */
export const selectConfiguration = (
  s: ConfiguratorState,
): ProjectConfiguration => ({
  styleId: s.styleId,
  materialOverrides: s.materialOverrides,
  moduleTree: s.moduleTree,
  layoutGraph: s.layoutGraph,
  selectedAddOnIds: s.selectedAddOnIds,
});

export const selectActiveStyle = (s: ConfiguratorState): StylePreset | undefined =>
  s.catalog.styles[s.styleId];

/** Materials the active style permits for a role (the locked palette). */
export const selectMaterialsForRole = (
  s: ConfiguratorState,
  role: SurfaceRole,
): Material[] => {
  const style = selectActiveStyle(s);
  return style ? materialsForRole(s.catalog, style, role) : [];
};
