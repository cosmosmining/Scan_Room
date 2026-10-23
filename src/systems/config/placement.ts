import type { ModuleDefinition } from '@/lib/types';
import type { PlacementModule } from '@/systems/layout';
import type { ConfigNode } from './types';

/**
 * Project a config-tree module node onto the layout engine's `PlacementModule`.
 * `ref` carries the node id through placement so the engine's output instance
 * shares the node's id (see `placementToInstance`).
 */
export function nodeToPlacementModule(
  node: ConfigNode,
  def: ModuleDefinition,
): PlacementModule {
  return {
    ref: node.id,
    definitionId: def.id,
    category: def.category,
    mount: def.constraints.mount,
    width: node.width ?? def.dimensions.width,
    depth: def.dimensions.depth,
    height: def.dimensions.height,
    elevation: def.constraints.defaultElevation,
    frontClearance: def.constraints.frontClearance,
    // Carry the service hints through, or the conflict engine cannot tell a
    // sink base (meant to sit over water/waste) from a cabinet sealing a pipe.
    connectsUtilities: def.constraints.connectsUtilities,
    needsUtilities: def.constraints.needsUtilities,
    finishId: node.materials.front,
  };
}
