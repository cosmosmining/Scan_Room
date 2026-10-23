import {
  isMaterialAllowed,
  SURFACE_ROLES,
  type StylePreset,
  type SurfaceRole,
} from '@/systems/catalog';
import type { ConfigNode } from './types';

type RoleMap = Partial<Record<SurfaceRole, string>>;

/**
 * Effective material id per role for a node, precedence:
 *   node override → global override → style default.
 * Always within the locked palette — a disallowed value falls back to the
 * style default for that role.
 */
export function resolveNodeMaterials(
  node: ConfigNode,
  style: StylePreset,
  globalOverrides: RoleMap,
): Record<SurfaceRole, string> {
  const out = {} as Record<SurfaceRole, string>;
  for (const role of SURFACE_ROLES) {
    const candidate =
      node.materials[role] ?? globalOverrides[role] ?? style.defaults[role];
    out[role] = isMaterialAllowed(style, role, candidate)
      ? candidate
      : style.defaults[role];
  }
  return out;
}

/** Drop overrides that the (newly selected) style does not allow. */
export function coerceToPalette(overrides: RoleMap, style: StylePreset): RoleMap {
  const out: RoleMap = {};
  for (const role of SURFACE_ROLES) {
    const value = overrides[role];
    if (value && isMaterialAllowed(style, role, value)) out[role] = value;
  }
  return out;
}
