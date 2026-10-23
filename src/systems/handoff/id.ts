import type { ConfigNode, ProjectConfiguration } from '@/systems/config';
import type { CanonicalNode } from './types';

/** Strip a node to its meaningful content (no random id, no derived transform). */
export function canonicalizeNode(node: ConfigNode): CanonicalNode {
  return {
    definitionId: node.definitionId ?? '',
    width: node.width,
    wallId: node.wallId,
    materials: node.materials,
    options: [...node.selectedOptionIds].sort(),
    children: node.children.map(canonicalizeNode),
  };
}

export function canonicalTree(root: ConfigNode): CanonicalNode[] {
  return root.children.map(canonicalizeNode);
}

/**
 * Deterministic, content-addressed id for a configuration: the same design
 * always yields the same id, independent of session-random node ids or
 * recomputed placement. FNV-1a over a key-sorted canonical form.
 */
export function configurationId(config: ProjectConfiguration): string {
  const canonical = {
    styleId: config.styleId,
    materialOverrides: config.materialOverrides,
    selectedAddOnIds: [...config.selectedAddOnIds].sort(),
    tree: canonicalTree(config.moduleTree),
  };
  return `cfg_${fnv1a(stableStringify(canonical))}`;
}

/** JSON with recursively sorted object keys, so the hash is order-independent. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
