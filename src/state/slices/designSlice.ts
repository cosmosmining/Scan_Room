import type { StateCreator } from 'zustand';
import { createId } from '@/lib/utils';
import {
  DEFAULT_CEILING_FINISH,
  DEFAULT_FLOOR_FINISH,
  DEFAULT_WALL_FINISH,
  type FinishTarget,
  type SurfaceFinish,
} from '@/systems/aesthetic/finishes';
import { furnitureItem } from '@/systems/furniture/catalog';
import type { ConfiguratorState, DesignSlice } from '@/state/types';
import type { Vec3 } from '@/lib/types';

/**
 * Free-form design — the web port of `Design/Model/DesignState.swift`.
 *
 * The configurator's module tree is a parametric fit: you pick a layout and the
 * engine places runs of cabinetry against walls. The iPad also has a second,
 * looser mode where anything from the catalogue can be dropped anywhere inside
 * the room, dragged, rotated, duplicated and recoloured, and the room's own
 * corners can be pulled about. Both modes exist because they answer different
 * questions — "does this kitchen fit" and "what will the room feel like" — and
 * the web only had the first, so a room furnished on an iPad opened on a laptop
 * as an empty shell.
 *
 * Room surface finishes live here too rather than in a panel's local state:
 * the 3D scene has to render them, and a finish the renderer cannot see is a
 * finish that only exists in the swatch grid.
 */

/** Even-odd point-in-polygon on the floor plane — `pointInPolygon` in Swift. */
export function pointInPolygon(p: { x: number; z: number }, poly: Vec3[]): boolean {
  if (poly.length < 3) return false;
  let inside = false;
  let j = poly.length - 1;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[j];
    if ((a.z > p.z) !== (b.z > p.z)) {
      const t = (p.z - a.z) / (b.z - a.z);
      if (p.x < a.x + t * (b.x - a.x)) inside = !inside;
    }
    j = i;
  }
  return inside;
}

const centroid = (poly: Vec3[]) => {
  if (poly.length === 0) return { x: 0, z: 0 };
  const sum = poly.reduce((acc, p) => ({ x: acc.x + p.x, z: acc.z + p.z }), { x: 0, z: 0 });
  return { x: sum.x / poly.length, z: sum.z / poly.length };
};

/**
 * Keep a footprint point inside the room. Outside it, seat the point on the
 * nearest wall nudged 50 mm toward the interior — `DesignState.clampToRoom`.
 * Dragging a sofa past a wall should stop it at the wall, not teleport it to
 * the middle of the room.
 */
export function clampToRoom(p: { x: number; z: number }, poly: Vec3[]): { x: number; z: number } {
  if (poly.length < 3 || pointInPolygon(p, poly)) return p;

  let best = centroid(poly);
  let bestD = Number.POSITIVE_INFINITY;
  let inward = { x: 0, z: 1 };
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const len2 = abx * abx + abz * abz;
    if (len2 < 1e-6) continue;
    const t = Math.min(1, Math.max(0, ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2));
    const q = { x: a.x + abx * t, z: a.z + abz * t };
    const d = Math.hypot(p.x - q.x, p.z - q.z);
    if (d < bestD) {
      bestD = d;
      best = q;
      const n = Math.hypot(abz, abx) || 1;
      inward = { x: -abz / n, z: abx / n };
    }
  }
  return { x: best.x + inward.x * 50, z: best.z + inward.z * 50 };
}

export const createDesignSlice: StateCreator<
  ConfiguratorState,
  [],
  [],
  DesignSlice
> = (set, get) => ({
  designItems: [],
  designSelection: null,
  moduleFinishes: {},
  wallFinish: DEFAULT_WALL_FINISH,
  floorFinish: DEFAULT_FLOOR_FINISH,
  ceilingFinish: DEFAULT_CEILING_FINISH,
  finishTarget: { kind: 'wall' },
  editWalls: false,

  addFurniture: (itemId) => {
    const item = furnitureItem(itemId);
    if (!item) return null;
    const { room, designItems } = get();
    // Nudge each successive add so five sofas are five sofas, not one.
    const jitter = (designItems.length % 5) * 250;
    const c = centroid(room.footprint);
    const id = createId('furn');
    set({
      designItems: [
        ...designItems,
        { id, itemId, position: clampToRoom({ x: c.x + jitter, z: c.z + jitter }, room.footprint), rotationY: 0 },
      ],
      designSelection: id,
      finishTarget: { kind: 'item', id },
    });
    return id;
  },

  applyRecommendation: (items) => {
    const placed = items.map((i) => ({ ...i, id: createId('furn') }));
    set((s) => ({
      designItems: [...s.designItems, ...placed],
      designSelection: placed[0]?.id ?? s.designSelection,
    }));
  },

  clearFurniture: () => set({ designItems: [], designSelection: null }),

  removeFurniture: (id) =>
    set((s) => ({
      designItems: s.designItems.filter((i) => i.id !== id),
      designSelection: s.designSelection === id ? null : s.designSelection,
      finishTarget: s.finishTarget.kind === 'item' && s.finishTarget.id === id
        ? { kind: 'wall' }
        : s.finishTarget,
    })),

  duplicateFurniture: (id) => {
    const source = get().designItems.find((i) => i.id === id);
    if (!source) return null;
    const copyId = createId('furn');
    set((s) => ({
      designItems: [
        ...s.designItems,
        {
          ...source,
          id: copyId,
          position: clampToRoom(
            { x: source.position.x + 300, z: source.position.z + 300 },
            s.room.footprint,
          ),
        },
      ],
      designSelection: copyId,
    }));
    return copyId;
  },

  moveFurniture: (id, position) =>
    set((s) => ({
      designItems: s.designItems.map((i) =>
        i.id === id ? { ...i, position: clampToRoom(position, s.room.footprint) } : i,
      ),
    })),

  rotateFurniture: (id, rotationY) =>
    set((s) => ({
      designItems: s.designItems.map((i) => (i.id === id ? { ...i, rotationY } : i)),
    })),

  selectFurniture: (id) =>
    set((s) => ({
      designSelection: id,
      finishTarget: id ? { kind: 'item', id } : s.finishTarget,
    })),

  setFinishTarget: (target) => set({ finishTarget: target }),

  applyFinish: (finish, target) => {
    switch (target.kind) {
      case 'item': {
        // "Selected" means whatever is selected — a catalogue piece OR a
        // kitchen unit. Routing on which one owns the id keeps one control
        // doing one job, instead of a Change Colour that silently does nothing
        // because the thing you picked was the other kind of object.
        const isFurniture = get().designItems.some((i) => i.id === target.id);
        if (isFurniture) {
          set((s) => ({
            designItems: s.designItems.map((i) => (i.id === target.id ? { ...i, finish } : i)),
          }));
        } else if (target.id) {
          set((s) => ({ moduleFinishes: { ...s.moduleFinishes, [target.id]: finish } }));
        }
        return;
      }
      case 'wall':
        set({ wallFinish: finish });
        return;
      case 'floor':
        set({ floorFinish: finish });
        return;
      case 'ceiling':
        set({ ceilingFinish: finish });
    }
  },

  currentFinish: (target) => {
    const s = get();
    switch (target.kind) {
      case 'item':
        return s.designItems.find((i) => i.id === target.id)?.finish
          ?? s.moduleFinishes[target.id];
      case 'wall':
        return s.wallFinish;
      case 'floor':
        return s.floorFinish;
      case 'ceiling':
        return s.ceilingFinish;
    }
  },

  toggleEditWalls: () => set((s) => ({ editWalls: !s.editWalls })),

  /**
   * Drag a room corner. Walls are index-aligned with the footprint — wall `i`
   * runs from vertex `i` to `i + 1` — so moving one vertex moves the end of the
   * wall before it and the start of the wall after it. Openings and fixtures
   * keep their offsets, which is what the iPad does: a door does not slide
   * along the wall because the wall got longer.
   */
  moveFootprintVertex: (index, point) =>
    set((s) => {
      const footprint = s.room.footprint.map((p, i) =>
        i === index ? { ...p, x: point.x, z: point.z } : p,
      );
      if (index < 0 || index >= footprint.length) return {};
      const n = footprint.length;
      const walls = s.room.walls.map((w, i) => {
        if (i === index) return { ...w, start: footprint[index] };
        if (i === (index - 1 + n) % n) return { ...w, end: footprint[index] };
        return w;
      });
      return { room: { ...s.room, footprint, walls, updatedAt: new Date().toISOString() } };
    }),
});
