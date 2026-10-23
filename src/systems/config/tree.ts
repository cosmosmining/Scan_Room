import { createId } from '@/lib/utils';
import type { SurfaceRole } from '@/systems/catalog';
import type { ConfigNode, NodeKind } from './types';

export function createRoot(): ConfigNode {
  return {
    id: 'root',
    kind: 'root',
    definitionId: null,
    materials: {},
    selectedOptionIds: [],
    children: [],
  };
}

export function createNode(
  definitionId: string,
  kind: NodeKind,
  patch: Partial<ConfigNode> = {},
): ConfigNode {
  return {
    id: createId('node'),
    kind,
    definitionId,
    materials: {},
    selectedOptionIds: [],
    children: [],
    ...patch,
  };
}

/** Map every node through `fn`, preserving structure (returns a new tree). */
function mapTree(node: ConfigNode, fn: (n: ConfigNode) => ConfigNode): ConfigNode {
  const mapped = fn(node);
  return { ...mapped, children: mapped.children.map((c) => mapTree(c, fn)) };
}

export function addChild(
  root: ConfigNode,
  parentId: string,
  child: ConfigNode,
): ConfigNode {
  return mapTree(root, (n) =>
    n.id === parentId ? { ...n, children: [...n.children, child] } : n,
  );
}

export function updateNode(
  root: ConfigNode,
  id: string,
  patch: Partial<ConfigNode>,
): ConfigNode {
  return mapTree(root, (n) => (n.id === id ? { ...n, ...patch } : n));
}

export function setNodeMaterial(
  root: ConfigNode,
  id: string,
  role: SurfaceRole,
  materialId: string,
): ConfigNode {
  return mapTree(root, (n) =>
    n.id === id ? { ...n, materials: { ...n.materials, [role]: materialId } } : n,
  );
}

export function removeNode(root: ConfigNode, id: string): ConfigNode {
  // The root is never removed.
  return {
    ...root,
    children: root.children
      .filter((c) => c.id !== id)
      .map((c) => removeNode(c, id)),
  };
}

export function findNode(root: ConfigNode, id: string): ConfigNode | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

/** Top-level placed modules (root's direct `module` children). */
export function topLevelModules(root: ConfigNode): ConfigNode[] {
  return root.children.filter((c) => c.kind === 'module');
}

/** Every node below the root, depth-first (modules and accessories). */
export function flatten(root: ConfigNode): ConfigNode[] {
  const out: ConfigNode[] = [];
  const walk = (n: ConfigNode) => {
    out.push(n);
    n.children.forEach(walk);
  };
  root.children.forEach(walk);
  return out;
}
