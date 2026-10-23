import type { Millimeters, Vec3 } from '@/lib/types';
import type { SurfaceRole } from '@/systems/catalog';

export type NodeKind = 'root' | 'module' | 'accessory';

export interface NodeTransform {
  position: Vec3; // millimetres, world space
  rotationY: number; // radians
}

/**
 * A node in the parametric module tree. Top-level `module` nodes are placed by
 * the layout engine (they get a `transform`); `accessory` nodes nest inside a
 * module and ride along with it. Everything is data — geometry is derived, never
 * hardcoded.
 */
export interface ConfigNode {
  id: string;
  kind: NodeKind;
  definitionId: string | null; // null only for the root
  width?: Millimeters; // parametric override within the definition's widthRange
  wallId?: string; // run assignment for top-level modules
  materials: Partial<Record<SurfaceRole, string>>; // per-role material overrides
  selectedOptionIds: string[];
  transform?: NodeTransform; // computed by the layout engine (modules only)
  /**
   * A transform a PERSON set, by dragging the unit on the plan or in 3D.
   *
   * Present means "I have taken this one out of the automatic run and put it
   * where I want it": the packer stops placing it and stops reserving space for
   * it, and `transform` is this. Absent means the layout engine owns it. Without
   * this distinction a drag could only ever change which wall a unit belongs
   * to, because the packer recomputes every position from scratch — which is
   * what made dragging a cabinet look broken.
   */
  pinned?: NodeTransform;
  children: ConfigNode[];
}

export type AdjacencyRelation = 'left-of' | 'right-of' | 'corner' | 'faces';

export interface LayoutGraphEdge {
  from: string; // node id
  to: string; // node id
  relation: AdjacencyRelation;
}

/** Spatial adjacency between placed modules (distinct from tree containment). */
export interface LayoutGraph {
  nodes: string[];
  edges: LayoutGraphEdge[];
}

/** The serializable configuration aggregate — what gets priced and persisted. */
export interface ProjectConfiguration {
  styleId: string;
  materialOverrides: Partial<Record<SurfaceRole, string>>;
  moduleTree: ConfigNode;
  layoutGraph: LayoutGraph;
  /** Selected project add-on ids (lighting, handles, services). */
  selectedAddOnIds: string[];
}
