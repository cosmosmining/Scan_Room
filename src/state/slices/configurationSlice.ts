import type { StateCreator } from 'zustand';
import { isMaterialAllowed } from '@/systems/catalog';
import {
  addChild,
  buildLayoutGraph,
  createNode,
  createRoot,
  nodeToPlacementModule,
  removeNode as removeFromTree,
  setNodeMaterial as setMaterialInTree,
  topLevelModules,
  updateNode as updateInTree,
  type ConfigNode,
} from '@/systems/config';
import { rebuildModuleTree } from '@/systems/handoff';
import {
  generateLayout,
  type PlacementModule,
  type RunAssignment,
} from '@/systems/layout';
import { roomGeometryToRoom } from '@/systems/scan';
import type { ModuleInstance } from '@/lib/types';
import type { ConfigurationSlice, ConfiguratorState } from '@/state/types';

export const createConfigurationSlice: StateCreator<
  ConfiguratorState,
  [],
  [],
  ConfigurationSlice
> = (set, get) => ({
  moduleTree: createRoot(),
  layoutGraph: { nodes: [], edges: [] },
  instances: [],
  layoutViolations: [],
  selectedAddOnIds: [],

  addModule: (definitionId, opts = {}) => {
    const node = createNode(definitionId, 'module', {
      wallId: opts.wallId,
      width: opts.width,
    });
    set((s) => ({ moduleTree: addChild(s.moduleTree, 'root', node) }));
    get().regenerateLayout();
  },

  addAccessory: (parentId, definitionId) => {
    const node = createNode(definitionId, 'accessory');
    set((s) => ({ moduleTree: addChild(s.moduleTree, parentId, node) }));
    get().recomputePricing(); // accessories ride along — no relayout needed
  },

  removeNode: (id) => {
    set((s) => ({ moduleTree: removeFromTree(s.moduleTree, id) }));
    get().regenerateLayout();
  },

  updateNode: (id, patch) => {
    set((s) => ({ moduleTree: updateInTree(s.moduleTree, id, patch) }));
    get().regenerateLayout();
  },

  setNodeMaterial: (id, role, materialId) => {
    const { catalog, styleId } = get();
    const style = catalog.styles[styleId];
    if (!style || !isMaterialAllowed(style, role, materialId)) return; // locked
    set((s) => ({
      moduleTree: setMaterialInTree(s.moduleTree, id, role, materialId),
    }));
    get().recomputePricing();
  },

  toggleAddOn: (addOnId) => {
    set((s) => ({
      selectedAddOnIds: s.selectedAddOnIds.includes(addOnId)
        ? s.selectedAddOnIds.filter((id) => id !== addOnId)
        : [...s.selectedAddOnIds, addOnId],
    }));
    get().recomputePricing();
  },

  setNodeTransform: (id, transform) => {
    set((s) => ({ moduleTree: updateInTree(s.moduleTree, id, { pinned: transform }) }));
    get().regenerateLayout();
  },

  unpinNode: (id) => {
    set((s) => ({ moduleTree: updateInTree(s.moduleTree, id, { pinned: undefined }) }));
    get().regenerateLayout();
  },

  regenerateLayout: () => {
    const { room, catalog, moduleTree } = get();
    const defaultWall = room.walls[0]?.id;

    // Group top-level modules by wall into run assignments. Units a person has
    // placed by hand are held out: the packer must neither move them nor pack
    // the others around a slot they no longer occupy.
    const groups = new Map<string, ConfigNode[]>();
    const pinnedNodes: ConfigNode[] = [];
    for (const node of topLevelModules(moduleTree)) {
      if (node.pinned) {
        pinnedNodes.push(node);
        continue;
      }
      const wallId = node.wallId ?? defaultWall;
      if (!wallId) continue;
      const arr = groups.get(wallId) ?? [];
      arr.push(node);
      groups.set(wallId, arr);
    }

    const assignments: RunAssignment[] = [...groups.entries()].map(
      ([wallId, nodes]) => ({
        wallId,
        modules: nodes
          .map((n) => {
            const def = n.definitionId
              ? catalog.definitions[n.definitionId]
              : undefined;
            return def ? nodeToPlacementModule(n, def) : null;
          })
          .filter((m): m is PlacementModule => m !== null),
      }),
    );

    const result = generateLayout({ room, assignments });

    // Hand-placed units become instances directly, at the transform they were
    // dragged to.
    const pinnedInstances: ModuleInstance[] = pinnedNodes.flatMap((node) => {
      const def = node.definitionId ? catalog.definitions[node.definitionId] : undefined;
      if (!def || !node.pinned) return [];
      return [{
        id: node.id,
        definitionId: def.id,
        position: node.pinned.position,
        rotationY: node.pinned.rotationY,
        width: node.width,
        finishId: node.materials.front,
        selectedOptionIds: node.selectedOptionIds,
        wallId: node.wallId,
        valid: true,
      }];
    });

    const instances = [...result.instances, ...pinnedInstances];

    // Write computed transforms back onto the tree (instance.id === node.id).
    let tree = moduleTree;
    for (const inst of instances) {
      tree = updateInTree(tree, inst.id, {
        transform: { position: inst.position, rotationY: inst.rotationY },
      });
    }

    set({
      moduleTree: tree,
      instances,
      layoutGraph: buildLayoutGraph(result.placements),
      layoutViolations: result.violations,
    });
    get().recomputePricing();
  },

  applyPlannedModules: (modules) => {
    // Rebuild the tree in one pass so the layout engine runs once, not per add.
    let tree = createRoot();
    for (const m of modules) {
      const node = createNode(m.definitionId, 'module', {
        wallId: m.wallId,
        width: m.width,
      });
      tree = addChild(tree, 'root', node);
    }
    set({ moduleTree: tree });
    get().regenerateLayout();
  },

  applyRoomGeometry: (geometry) => {
    // Land on the auto-generated floorplan so a capture flows straight into the
    // dimensioned plan (scan → floorplan), exactly like the native apps.
    set({ room: roomGeometryToRoom(geometry, get().room.name), viewMode: 'floorplan' });
    get().regenerateLayout();
  },

  loadShare: (payload) => {
    set({
      room: payload.room,
      styleId: payload.styleId,
      materialOverrides: payload.materialOverrides,
      selectedAddOnIds: payload.selectedAddOnIds,
      moduleTree: rebuildModuleTree(payload.tree),
    });
    get().regenerateLayout();
  },
});
