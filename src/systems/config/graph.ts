import type { Placement } from '@/systems/layout';
import type { LayoutGraph, LayoutGraphEdge } from './types';

/**
 * Build the spatial adjacency graph from engine placements, keyed by each
 * module's `ref` (its config-tree node id). MVP captures within-run left/right
 * neighbours; corner and facing edges are a documented extension.
 */
export function buildLayoutGraph(placements: Placement[]): LayoutGraph {
  const withRef = placements.filter(
    (p): p is Placement & { module: { ref: string } } => Boolean(p.module.ref),
  );
  const nodes = withRef.map((p) => p.module.ref as string);
  const edges: LayoutGraphEdge[] = [];

  const byRun = new Map<string, Placement[]>();
  for (const p of withRef) {
    const arr = byRun.get(p.run.wallId) ?? [];
    arr.push(p);
    byRun.set(p.run.wallId, arr);
  }

  for (const arr of byRun.values()) {
    arr.sort((a, b) => a.offset - b.offset);
    for (let i = 0; i < arr.length - 1; i++) {
      const a = arr[i].module.ref as string;
      const b = arr[i + 1].module.ref as string;
      edges.push({ from: a, to: b, relation: 'right-of' });
      edges.push({ from: b, to: a, relation: 'left-of' });
    }
  }

  return { nodes, edges };
}
