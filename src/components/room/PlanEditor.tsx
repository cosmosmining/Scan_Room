'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import type { Room, Wall, WallFixture, WallOpening } from '@/lib/types';
import { swatchById } from '@/systems/aesthetic/finishes';
import { furnitureItem, placedName, placedSize, yawOffset } from '@/systems/furniture/catalog';
import { placeByHand } from '@/systems/layout';
import { useConfiguratorStore } from '@/state/useConfiguratorStore';

/**
 * The floor plan, editable — the web twin of `Design/Scene/FloorPlan2DView.swift`.
 *
 * Everything on the plan is draggable, because on the iPad everything is:
 * furniture and kitchen modules slide across the floor and rotate by a handle,
 * doors and windows slide along their wall, sockets slide along the walls and
 * re-anchor around corners, and in Edit Walls the room's own corners can be
 * pulled about. A surveyor who corrects a plan on an iPad and then opens it on
 * a laptop should not find that half the corrections are impossible here — a
 * correction that can only be made on one device is a correction that will not
 * get made.
 *
 * Drawn in millimetres: the SVG viewBox IS room space, so nothing here has to
 * think in pixels.
 */

const PAD = 700;              // mm of margin around the plan
const HIT_RADIUS = 320;       // mm — how near a touch must be to grab a fixture
const VERTEX_RADIUS = 420;    // mm — a corner handle is bigger; it is coarser work
const WALL_REACH = 900;       // mm — further than this from a wall places nothing
const TAP_SLOP = 120;         // mm — under this, a gesture is a tap not a drag
const ITEM_SLOP = 120;        // mm — so a thin item (a rug edge) stays grabbable

const HEIGHT_PRESETS: { name: string; mm: number }[] = [
  { name: 'Skirting', mm: 300 },
  { name: 'Worktop', mm: 1100 },
  { name: 'Switch', mm: 1350 },
];

const LABEL: Record<string, string> = {
  socket: 'Socket', switch: 'Switch', water: 'Water',
  waste: 'Waste', gas: 'Gas', vent: 'Vent', radiator: 'Radiator',
};
const GLYPH: Record<string, string> = {
  socket: 'S', switch: 'L', water: 'W', waste: 'D', gas: 'G', vent: 'V', radiator: 'R',
};

interface Anchor { wallId: string; offset: number; distance: number }

/** What a tap on bare wall adds. */
type TapAdds = 'socket' | 'window' | 'door';

/**
 * A new opening's starting size. Glass a scan missed is the usual reason to add
 * one, and these are the common sizes; the inspector adjusts from there.
 */
const NEW_OPENING: Record<'window' | 'door', { width: number; height: number; sillHeight: number }> = {
  window: { width: 1200, height: 1200, sillHeight: 900 },
  door: { width: 900, height: 2100, sillHeight: 0 },
};

const OPENING_LABEL: Record<WallOpening['type'], string> = {
  window: 'Window', door: 'Door', archway: 'Opening',
};

/** What the pointer has hold of. One gesture, classified once on pointer-down. */
type Grab =
  | { kind: 'fixture'; wallId: string; index: number }
  | { kind: 'opening'; wallId: string; index: number }
  | { kind: 'furniture'; id: string; from: { x: number; z: number } }
  | { kind: 'rotate'; id: string; module: boolean }
  | { kind: 'module'; id: string; from: { x: number; z: number } }
  | { kind: 'vertex'; index: number };

/** Nearest wall to a point, and how far along it that point lands. */
function wallAnchor(room: Room, x: number, z: number): Anchor | null {
  let best: Anchor | null = null;
  for (const wall of room.walls) {
    const dx = wall.end.x - wall.start.x;
    const dz = wall.end.z - wall.start.z;
    const lengthSq = dx * dx + dz * dz;
    if (lengthSq < 1) continue;
    const raw = ((x - wall.start.x) * dx + (z - wall.start.z) * dz) / lengthSq;
    const t = Math.min(Math.max(raw, 0), 1);
    const cx = wall.start.x + dx * t;
    const cz = wall.start.z + dz * t;
    const distance = Math.hypot(x - cx, z - cz);
    if (!best || distance < best.distance) {
      best = { wallId: wall.id, offset: t * Math.sqrt(lengthSq), distance };
    }
  }
  return best && best.distance <= WALL_REACH ? best : null;
}

/** Where a fixture sits in floor coordinates, and which way is into the room. */
function fixturePoint(wall: Wall, fixture: { offset: number }) {
  const dx = wall.end.x - wall.start.x;
  const dz = wall.end.z - wall.start.z;
  const length = Math.hypot(dx, dz) || 1;
  const ux = dx / length, uz = dz / length;
  const t = Math.min(Math.max(fixture.offset, 0), length);
  return { x: wall.start.x + ux * t, z: wall.start.z + uz * t, inward: { x: -uz, z: ux } };
}

export function PlanEditor() {
  const room = useConfiguratorStore((s) => s.room);
  const setRoom = useConfiguratorStore((s) => s.setRoom);
  const instances = useConfiguratorStore((s) => s.instances);
  const catalog = useConfiguratorStore((s) => s.catalog);
  const regenerateLayout = useConfiguratorStore((s) => s.regenerateLayout);
  const setNodeTransform = useConfiguratorStore((s) => s.setNodeTransform);
  const unpinNode = useConfiguratorStore((s) => s.unpinNode);
  const removeNode = useConfiguratorStore((s) => s.removeNode);
  const selectedNodeId = useConfiguratorStore((s) => s.selectedNodeId);
  const selectNode = useConfiguratorStore((s) => s.selectNode);
  const setFinishTarget = useConfiguratorStore((s) => s.setFinishTarget);
  const setStep = useConfiguratorStore((s) => s.setStep);
  const moduleFinishes = useConfiguratorStore((s) => s.moduleFinishes);

  const designItems = useConfiguratorStore((s) => s.designItems);
  const designSelection = useConfiguratorStore((s) => s.designSelection);
  const selectFurniture = useConfiguratorStore((s) => s.selectFurniture);
  const moveFurniture = useConfiguratorStore((s) => s.moveFurniture);
  const rotateFurniture = useConfiguratorStore((s) => s.rotateFurniture);
  const removeFurniture = useConfiguratorStore((s) => s.removeFurniture);
  const duplicateFurniture = useConfiguratorStore((s) => s.duplicateFurniture);
  const editWalls = useConfiguratorStore((s) => s.editWalls);
  const toggleEditWalls = useConfiguratorStore((s) => s.toggleEditWalls);
  const moveFootprintVertex = useConfiguratorStore((s) => s.moveFootprintVertex);
  const floorFinish = useConfiguratorStore((s) => s.floorFinish);

  const [selected, setSelected] = useState<{ wallId: string; index: number } | null>(null);
  const [selectedOpening, setSelectedOpening] = useState<{ wallId: string; index: number } | null>(null);
  const [tapAdds, setTapAdds] = useState<TapAdds>('socket');
  const [newHeight, setNewHeight] = useState(1100);
  const svgRef = useRef<SVGSVGElement>(null);
  const gesture = useRef<{ start: { x: number; z: number }; grab: Grab | null } | null>(null);

  const bounds = useMemo(() => {
    const xs = room.footprint.map((p) => p.x);
    const zs = room.footprint.map((p) => p.z);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
  }, [room.footprint]);

  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
  // Stroke width for the walls, in room units, so the plan reads the same at
  // any room size. Everything else is a multiple of it.
  const wallW = Math.max(span / 45, 55);
  const font = span / 26;
  /** How far into the room a fixture's mark is drawn from its wall. */
  const markerOffset = wallW * 0.8 * 1.3;

  /** Pointer event → millimetres in room space. */
  const toRoom = useCallback((e: React.PointerEvent) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const p = svg.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    const local = p.matrixTransform(ctm.inverse());
    return { x: local.x, z: local.y };
  }, []);

  /** Rewrite one fixture, or remove it, keeping the rest of the room intact. */
  const mutate = useCallback(
    (
      at: { wallId: string; index: number },
      change: Partial<WallFixture> | null,
      moveTo?: string,
    ) => {
      const walls = room.walls.map((w) => ({ ...w, fixtures: [...(w.fixtures ?? [])] }));
      const from = walls.find((w) => w.id === at.wallId);
      if (!from || !from.fixtures[at.index]) return;
      const existing = from.fixtures[at.index];

      if (change === null) {
        from.fixtures.splice(at.index, 1);
        setRoom({ ...room, walls });
        setSelected(null);
        return;
      }

      const updated = { ...existing, ...change };
      if (moveTo && moveTo !== at.wallId) {
        // Dragged around a corner: it belongs to the new wall now.
        from.fixtures.splice(at.index, 1);
        const to = walls.find((w) => w.id === moveTo);
        if (!to) return;
        to.fixtures.push(updated);
        setSelected({ wallId: moveTo, index: to.fixtures.length - 1 });
      } else {
        from.fixtures[at.index] = updated;
      }
      setRoom({ ...room, walls });
    },
    [room, setRoom],
  );

  /** Rewrite one opening, or remove it. */
  const mutateOpening = useCallback(
    (at: { wallId: string; index: number }, change: Partial<WallOpening> | null) => {
      const walls = room.walls.map((w) =>
        w.id === at.wallId ? { ...w, openings: [...(w.openings ?? [])] } : w,
      );
      const wall = walls.find((w) => w.id === at.wallId);
      const opening = wall?.openings?.[at.index];
      if (!wall?.openings || !opening) return;
      if (change === null) {
        wall.openings.splice(at.index, 1);
        setSelectedOpening(null);
      } else {
        const length = Math.hypot(wall.end.x - wall.start.x, wall.end.z - wall.start.z);
        const next = { ...opening, ...change };
        next.width = Math.min(Math.max(next.width, 200), length);
        next.offset = Math.min(Math.max(next.offset, 0), Math.max(0, length - next.width));
        wall.openings[at.index] = next;
      }
      setRoom({ ...room, walls });
    },
    [room, setRoom],
  );

  /** Slide a door or window along its own wall. Openings do not change wall. */
  const moveOpening = useCallback(
    (at: { wallId: string; index: number }, offset: number) => {
      const walls = room.walls.map((w) =>
        w.id === at.wallId ? { ...w, openings: [...(w.openings ?? [])] } : w,
      );
      const wall = walls.find((w) => w.id === at.wallId);
      const opening = wall?.openings?.[at.index];
      if (!wall || !opening) return;
      const length = Math.hypot(wall.end.x - wall.start.x, wall.end.z - wall.start.z);
      // `offset` is the leading edge, so the far edge is what must stay on the
      // wall — otherwise a door dragged to the end hangs off the corner.
      wall.openings[at.index] = {
        ...opening,
        offset: Math.round(Math.min(Math.max(offset, 0), Math.max(0, length - opening.width))),
      };
      setRoom({ ...room, walls });
    },
    [room, setRoom],
  );

  /**
   * Rotate handle for the selected object, in room space — `rotateHandlePoint`.
   * Works for a catalogue piece or a kitchen unit; both are rectangles on the
   * plan and both need turning.
   */
  const rotateHandle = useCallback(
    (id: string) => {
      const inst = instances.find((i) => i.id === id);
      if (inst) {
        const def = catalog.definitions[inst.definitionId];
        if (!def) return null;
        const w = inst.width ?? def.dimensions.width;
        const c = yawOffset({ x: w / 2, z: def.dimensions.depth / 2 }, inst.rotationY);
        const l = Math.hypot(c.x, c.z) || 1;
        return {
          x: inst.position.x + c.x + (c.x / l) * 260,
          z: inst.position.z + c.z + (c.z / l) * 260,
        };
      }
      const placed = designItems.find((i) => i.id === id);
      // A column is not something you turn, so it gets no handle to grab.
      if (!placed || placed.column) return null;
      const size = placedSize(placed);
      const corner = yawOffset({ x: size.width / 2, z: size.depth / 2 }, placed.rotationY);
      const len = Math.hypot(corner.x, corner.z) || 1;
      const push = 260; // mm beyond the corner, so it never sits on the body
      return {
        x: placed.position.x + corner.x + (corner.x / len) * push,
        z: placed.position.z + corner.z + (corner.z / len) * push,
      };
    },
    [designItems, instances, catalog],
  );

  /**
   * Classify the gesture against the current state — or, in Edit Walls, against
   * the footprint corners. Doing this once on pointer-down is what stops a drag
   * from changing its mind halfway across the plan.
   *
   * SMALLEST TARGET FIRST: rotate handle, then fixture, then opening, then
   * furniture, then module. Sockets and doors are small marks that routinely
   * sit under a cabinet's footprint, so testing the big shapes first makes them
   * permanently ungrabbable — a socket under a run of base units is exactly the
   * one you most need to move. A module is still grabbable by all the rest of
   * itself, which a socket-sized mark is not.
   */
  const classify = useCallback(
    (x: number, z: number): Grab | null => {
      if (editWalls) {
        let bestIndex = -1;
        let bestD = Number.POSITIVE_INFINITY;
        for (const [index, p] of room.footprint.entries()) {
          const d = Math.hypot(p.x - x, p.z - z);
          if (d <= VERTEX_RADIUS && d < bestD) { bestIndex = index; bestD = d; }
        }
        return bestIndex >= 0 ? { kind: 'vertex', index: bestIndex } : null;
      }

      const selectedId = designSelection ?? selectedNodeId;
      if (selectedId) {
        const h = rotateHandle(selectedId);
        if (h && Math.hypot(h.x - x, h.z - z) <= HIT_RADIUS) {
          return { kind: 'rotate', id: selectedId, module: selectedId === selectedNodeId };
        }
      }

      let bestFixture: { wallId: string; index: number; distance: number } | null = null;
      for (const wall of room.walls) {
        for (const [index, fixture] of (wall.fixtures ?? []).entries()) {
          const p = fixturePoint(wall, fixture);
          // The mark is drawn offset into the room from the wall line, so hit-
          // test where it is DRAWN, not where its offset says it is.
          const cx = p.x + p.inward.x * markerOffset;
          const cz = p.z + p.inward.z * markerOffset;
          const distance = Math.hypot(cx - x, cz - z);
          if (distance <= HIT_RADIUS && (!bestFixture || distance < bestFixture.distance)) {
            bestFixture = { wallId: wall.id, index, distance };
          }
        }
      }
      if (bestFixture) return { kind: 'fixture', wallId: bestFixture.wallId, index: bestFixture.index };

      for (const wall of room.walls) {
        const length = Math.hypot(wall.end.x - wall.start.x, wall.end.z - wall.start.z) || 1;
        for (const [index, op] of (wall.openings ?? []).entries()) {
          const mid = fixturePoint(wall, { offset: Math.min(op.offset + op.width / 2, length) });
          if (Math.hypot(mid.x - x, mid.z - z) <= Math.max(op.width / 2, HIT_RADIUS)) {
            return { kind: 'opening', wallId: wall.id, index };
          }
        }
      }

      // Topmost furniture whose oriented footprint contains the point.
      for (let i = designItems.length - 1; i >= 0; i--) {
        const placed = designItems[i];
        const size = placedSize(placed);
        const rel = { x: x - placed.position.x, z: z - placed.position.z };
        const local = yawOffset(rel, -placed.rotationY);
        if (
          Math.abs(local.x) <= Math.max(size.width / 2, ITEM_SLOP) &&
          Math.abs(local.z) <= Math.max(size.depth / 2, ITEM_SLOP)
        ) {
          return { kind: 'furniture', id: placed.id, from: placed.position };
        }
      }

      for (let i = instances.length - 1; i >= 0; i--) {
        const inst = instances[i];
        const def = catalog.definitions[inst.definitionId];
        if (!def) continue;
        const rel = { x: x - inst.position.x, z: z - inst.position.z };
        const local = yawOffset(rel, -inst.rotationY);
        const w = inst.width ?? def.dimensions.width;
        if (Math.abs(local.x) <= w / 2 && Math.abs(local.z) <= def.dimensions.depth / 2) {
          return { kind: 'module', id: inst.id, from: { x: inst.position.x, z: inst.position.z } };
        }
      }

      return null;
    },
    [editWalls, room, designItems, designSelection, selectedNodeId, instances, catalog,
     rotateHandle, markerOffset],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    const p = toRoom(e);
    if (!p) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const grab = classify(p.x, p.z);
    gesture.current = { start: p, grab };
    if (grab?.kind === 'fixture') {
      setSelected({ wallId: grab.wallId, index: grab.index });
      setSelectedOpening(null);
    }
    if (grab?.kind === 'opening') {
      setSelectedOpening({ wallId: grab.wallId, index: grab.index });
      setSelected(null);
    }
    // One selection at a time across both kinds of object, so the finish
    // editor's "Selected" is never ambiguous about what it will recolour.
    if (grab?.kind === 'furniture') {
      selectFurniture(grab.id);
      selectNode(null);
      setFinishTarget({ kind: 'item', id: grab.id });
    }
    if (grab?.kind === 'module') {
      selectNode(grab.id);
      selectFurniture(null);
      setFinishTarget({ kind: 'item', id: grab.id });
    }
    if (!grab && !editWalls) {
      selectFurniture(null);
      selectNode(null);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g?.grab) return;
    const p = toRoom(e);
    if (!p) return;
    // Follow the finger only once it has genuinely set off, so a tap to select
    // does not also re-place what it was selecting.
    if (Math.hypot(p.x - g.start.x, p.z - g.start.z) <= TAP_SLOP) return;
    const grab = g.grab;

    switch (grab.kind) {
      case 'vertex':
        moveFootprintVertex(grab.index, p);
        return;

      case 'rotate': {
        const centre = grab.module
          ? instances.find((i) => i.id === grab.id)?.position
          : designItems.find((i) => i.id === grab.id)?.position;
        if (!centre) return;
        // The handle rides the object's local +X/+Z diagonal, which `yawOffset`
        // turns to 45° − yaw on the plan; solve for the yaw that puts it under
        // the finger. Same rule for a module and a piece of furniture now that
        // both are drawn with the same turn.
        const angle = Math.atan2(p.z - centre.z, p.x - centre.x) - Math.PI / 4;
        if (grab.module) {
          setNodeTransform(grab.id, {
            position: { x: centre.x, y: 0, z: centre.z },
            rotationY: -angle,
          });
        } else {
          rotateFurniture(grab.id, -angle);
        }
        return;
      }

      case 'furniture':
        // Move by the drag's TRANSLATION, not to the pointer: grabbing a sofa
        // by its arm and having it jump so its centre is under your finger is
        // the difference between dragging a thing and re-placing it.
        moveFurniture(grab.id, {
          x: grab.from.x + (p.x - g.start.x),
          z: grab.from.z + (p.z - g.start.z),
        });
        return;

      case 'module': {
        // Move by the drag's translation, then let `placeByHand` decide: near a
        // wall the unit seats against it facing the room, out on open floor it
        // stays where it was put. Same rule as the 3D drag, so the two views
        // cannot disagree about what a drop means.
        const inst = instances.find((i) => i.id === grab.id);
        const def = inst ? catalog.definitions[inst.definitionId] : undefined;
        const target = { x: grab.from.x + (p.x - g.start.x), z: grab.from.z + (p.z - g.start.z) };
        const placement = placeByHand(
          room, target, def?.dimensions.depth ?? 600, inst?.rotationY ?? 0,
        );
        setNodeTransform(grab.id, {
          position: placement.position,
          rotationY: placement.rotationY,
        });
        return;
      }

      case 'opening': {
        const wall = room.walls.find((w) => w.id === grab.wallId);
        const opening = wall?.openings?.[grab.index];
        if (!wall || !opening) return;
        const dx = wall.end.x - wall.start.x;
        const dz = wall.end.z - wall.start.z;
        const length = Math.hypot(dx, dz) || 1;
        const along = ((p.x - wall.start.x) * dx + (p.z - wall.start.z) * dz) / length;
        moveOpening(grab, along - opening.width / 2);
        return;
      }

      case 'fixture': {
        const anchor = wallAnchor(room, p.x, p.z);
        if (!anchor) return;
        mutate(grab, { offset: Math.round(anchor.offset), source: 'manual', confidence: 1 }, anchor.wallId);
        if (anchor.wallId !== grab.wallId) {
          // It moved wall; `mutate` appended it, so keep dragging that one.
          const to = room.walls.find((w) => w.id === anchor.wallId);
          g.grab = { kind: 'fixture', wallId: anchor.wallId, index: (to?.fixtures?.length ?? 0) };
        }
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    const p = toRoom(e);
    if (!p) return;
    const moved = Math.hypot(p.x - g.start.x, p.z - g.start.z) > TAP_SLOP;

    // A reshaped room is a different room to pack units into, so re-run the
    // layout — once, on release, not on every millimetre of the drag.
    if (g.grab?.kind === 'vertex' && moved) regenerateLayout();

    if (g.grab || moved || editWalls) return;

    // A tap on bare wall drops a new socket — or window, or door — there; on
    // open floor, deselect.
    const anchor = wallAnchor(room, p.x, p.z);
    if (!anchor) {
      setSelected(null);
      setSelectedOpening(null);
      return;
    }
    if (tapAdds !== 'socket') {
      // Glass the scan could not see is the reason this exists: a sliding door
      // or a floor-to-ceiling pane comes back from RoomPlan as plain wall.
      const walls = room.walls.map((w) => ({ ...w, openings: [...(w.openings ?? [])] }));
      const wall = walls.find((w) => w.id === anchor.wallId);
      if (!wall) return;
      const length = Math.hypot(wall.end.x - wall.start.x, wall.end.z - wall.start.z);
      const size = NEW_OPENING[tapAdds];
      const width = Math.min(size.width, length);
      wall.openings.push({
        id: `op_${Date.now().toString(36)}`,
        type: tapAdds,
        offset: Math.round(Math.min(Math.max(anchor.offset - width / 2, 0), Math.max(0, length - width))),
        width,
        height: size.height,
        sillHeight: size.sillHeight,
      });
      setRoom({ ...room, walls });
      setSelected(null);
      setSelectedOpening({ wallId: wall.id, index: wall.openings.length - 1 });
      return;
    }
    const walls = room.walls.map((w) => ({ ...w, fixtures: [...(w.fixtures ?? [])] }));
    const wall = walls.find((w) => w.id === anchor.wallId);
    if (!wall) return;
    wall.fixtures.push({
      id: `fx_${Date.now().toString(36)}`,
      type: 'socket',
      offset: Math.round(anchor.offset),
      height: newHeight,
      source: 'manual',
      confidence: 1,
    } as WallFixture);
    setRoom({ ...room, walls });
    setSelected({ wallId: wall.id, index: wall.fixtures.length - 1 });
  };

  const selectedFixture =
    selected && room.walls.find((w) => w.id === selected.wallId)?.fixtures?.[selected.index];
  const selectedOpeningData =
    selectedOpening && room.walls.find((w) => w.id === selectedOpening.wallId)?.openings?.[selectedOpening.index];
  const selectedItem = designItems.find((i) => i.id === designSelection);
  const selectedModule = instances.find((i) => i.id === selectedNodeId);

  const viewBox = `${bounds.minX - PAD} ${bounds.minZ - PAD} ${bounds.maxX - bounds.minX + 2 * PAD} ${bounds.maxZ - bounds.minZ + 2 * PAD}`;
  const floorColor = swatchById(floorFinish.swatchId)?.color ?? '#141416';
  // Reset each render; the JSX below fills it as it lays labels out.
  const placedLabels: { x: number; z: number }[] = [];

  /** Floor area, m² — the same readout the iPad's plan toolbar carries. */
  const area = useMemo(() => {
    const f = room.footprint;
    if (f.length < 3) return 0;
    let s = 0;
    for (let i = 0; i < f.length; i++) {
      const p = f[i], q = f[(i + 1) % f.length];
      s += p.x * q.z - q.x * p.z;
    }
    return Math.abs(s) / 2 / 1e6;
  }, [room.footprint]);

  return (
    <div className="relative flex h-full w-full flex-col bg-neutral-900">
      <div className="flex items-center gap-2 border-b border-white/10 bg-neutral-950/70 px-3 py-2 text-xs">
        <button
          type="button"
          onClick={toggleEditWalls}
          className={`rounded-md border px-2.5 py-1.5 ${
            editWalls ? 'border-sky-400 bg-sky-400/10 text-sky-200' : 'border-white/15 text-neutral-300'
          }`}
        >
          Edit walls
        </button>
        {!editWalls && (
          <div className="flex items-center gap-1 rounded-md border border-white/10 p-0.5" title="What a tap on a wall adds">
            <span className="px-1.5 text-neutral-500">Tap wall adds</span>
            {(['socket', 'window', 'door'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setTapAdds(k)}
                className={`rounded px-2 py-1 capitalize ${
                  tapAdds === k ? 'bg-white text-neutral-950' : 'text-neutral-300'
                }`}
              >
                {k}
              </button>
            ))}
          </div>
        )}
        {selectedItem && !editWalls && (
          <>
            <button
              type="button"
              onClick={() => duplicateFurniture(selectedItem.id)}
              className="rounded-md border border-white/15 px-2.5 py-1.5 text-neutral-300"
            >
              Duplicate
            </button>
            <button
              type="button"
              onClick={() => removeFurniture(selectedItem.id)}
              className="rounded-md border border-red-500/40 px-2.5 py-1.5 text-red-300"
            >
              Delete
            </button>
          </>
        )}
        {/* The iPad puts Change Colour in its bottom bar, next to the thing you
            just selected. Burying it in a step two clicks away is why it read
            as "not working": the control was fine, it just was not where the
            selection was. */}
        {(selectedModule || selectedItem) && !editWalls && (
          <button
            type="button"
            onClick={() => {
              setFinishTarget({ kind: 'item', id: (selectedModule ?? selectedItem)!.id });
              setStep('style');
            }}
            className="rounded-md bg-cyan-500 px-2.5 py-1.5 font-medium text-neutral-950 hover:bg-cyan-400"
          >
            Change colour
          </button>
        )}
        {selectedModule && !editWalls && (
          <>
            {/* Undo a hand placement: hand the unit back to the packer so it
                rejoins the run instead of being nudged back by eye. */}
            <button
              type="button"
              onClick={() => unpinNode(selectedModule.id)}
              className="rounded-md border border-white/15 px-2.5 py-1.5 text-neutral-300"
            >
              Snap to run
            </button>
            <button
              type="button"
              onClick={() => {
                removeNode(selectedModule.id);
                selectNode(null);
              }}
              className="rounded-md border border-red-500/40 px-2.5 py-1.5 text-red-300"
            >
              Delete
            </button>
          </>
        )}
        <span className="ml-auto tabular-nums text-neutral-400">{area.toFixed(1)} m²</span>
      </div>

      <svg
        ref={svgRef}
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full flex-1 touch-none select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {/* The floor carries its own finish's tone, as the iPad's Canvas fills
            the footprint with `MaterialFactory.uiColor(for: floorFinish)`. */}
        <polygon
          points={room.footprint.map((p) => `${p.x},${p.z}`).join(' ')}
          fill={floorColor}
          fillOpacity={0.5}
          stroke="#5b5b64"
          strokeWidth={wallW}
          strokeLinejoin="miter"
        />

        {/* Wall dimensions, in centimetres, nudged outside the wall line. */}
        {room.walls.map((wall) => {
          const dx = wall.end.x - wall.start.x;
          const dz = wall.end.z - wall.start.z;
          const length = Math.hypot(dx, dz);
          if (length < 1) return null;
          const mx = (wall.start.x + wall.end.x) / 2;
          const mz = (wall.start.z + wall.end.z) / 2;
          const cx = bounds.minX + (bounds.maxX - bounds.minX) / 2;
          const cz = bounds.minZ + (bounds.maxZ - bounds.minZ) / 2;
          let nx = -dz / length, nz = dx / length;
          if (nx * (cx - mx) + nz * (cz - mz) > 0) { nx = -nx; nz = -nz; }
          return (
            <text
              key={`dim_${wall.id}`}
              x={mx + nx * wallW * 2.2}
              y={mz + nz * wallW * 2.2 + font * 0.3}
              fontSize={font * 0.72}
              textAnchor="middle"
              fill="#9aa3ad"
            >
              {Math.round(length / 10)}
            </text>
          );
        })}

        {/* Kitchen modules — drag to move, blue handle to turn. */}
        {instances.map((inst) => {
          const def = catalog.definitions[inst.definitionId];
          if (!def) return null;
          const w = inst.width ?? def.dimensions.width;
          const d = def.dimensions.depth;
          const isSelected = inst.id === selectedNodeId;
          const finish = moduleFinishes[inst.id];
          const tone = finish ? swatchById(finish.swatchId)?.color ?? '#2c2c31' : '#2c2c31';
          const handle = isSelected ? rotateHandle(inst.id) : null;
          return (
            <g key={inst.id} style={{ cursor: 'grab' }}>
              <rect
                x={-w / 2}
                y={-d / 2}
                width={w}
                height={d}
                transform={`translate(${inst.position.x} ${inst.position.z}) rotate(${(-inst.rotationY * 180) / Math.PI})`}
                fill={tone}
                fillOpacity={finish ? 0.75 : 1}
                stroke={isSelected ? '#38bdf8' : '#4a4a52'}
                strokeWidth={wallW * (isSelected ? 0.3 : 0.18)}
              />
              {handle && (
                <circle
                  cx={handle.x}
                  cy={handle.z}
                  r={wallW * 0.9}
                  fill="#38bdf8"
                  stroke="#ffffff"
                  strokeWidth={wallW * 0.16}
                />
              )}
            </g>
          );
        })}

        {/* Catalogue furniture: an oriented footprint filled with its finish's
            tone, a front tick so its facing is legible, and — when selected —
            corner handles and the rotate handle on its diagonal. */}
        {designItems.map((placed) => {
          const size = placedSize(placed);
          const halfW = size.width / 2;
          const halfD = size.depth / 2;
          const corners = ([[-halfW, -halfD], [halfW, -halfD], [halfW, halfD], [-halfW, halfD]] as const)
            .map(([x, z]) => {
              const r = yawOffset({ x, z }, placed.rotationY);
              return { x: placed.position.x + r.x, z: placed.position.z + r.z };
            });
          const isSelected = placed.id === designSelection;
          if (placed.column) {
            // A column is structure: solid, in the wall colour, like the walls
            // it belongs with. Round when the scan says round.
            const outline = isSelected ? '#38bdf8' : '#5b5b64';
            return (
              <g key={placed.id} style={{ cursor: 'grab' }}>
                {placed.column === 'round' ? (
                  <circle
                    cx={placed.position.x}
                    cy={placed.position.z}
                    r={halfW}
                    fill="#5b5b64"
                    stroke={outline}
                    strokeWidth={wallW * (isSelected ? 0.3 : 0.1)}
                  />
                ) : (
                  <polygon
                    points={corners.map((c) => `${c.x},${c.z}`).join(' ')}
                    fill="#5b5b64"
                    stroke={outline}
                    strokeWidth={wallW * (isSelected ? 0.3 : 0.1)}
                  />
                )}
              </g>
            );
          }
          const tone = placed.finish ? swatchById(placed.finish.swatchId)?.color ?? '#9c8f7d' : '#9c8f7d';
          const front = yawOffset({ x: 0, z: halfD }, placed.rotationY);
          const handle = isSelected ? rotateHandle(placed.id) : null;
          return (
            <g key={placed.id} style={{ cursor: 'grab' }}>
              <polygon
                points={corners.map((c) => `${c.x},${c.z}`).join(' ')}
                fill={tone}
                fillOpacity={0.55}
                stroke={isSelected ? '#38bdf8' : '#4d4d55'}
                strokeWidth={wallW * (isSelected ? 0.3 : 0.15)}
              />
              <line
                x1={placed.position.x}
                y1={placed.position.z}
                x2={placed.position.x + front.x}
                y2={placed.position.z + front.z}
                stroke={isSelected ? '#38bdf8' : '#6b6b74'}
                strokeWidth={wallW * 0.12}
              />
              {size.width > font * 4 && (
                <text
                  x={placed.position.x}
                  y={placed.position.z + font * 0.22}
                  fontSize={font * 0.6}
                  textAnchor="middle"
                  fill="#1a1a1c"
                >
                  {placedName(placed)}
                </text>
              )}
              {isSelected && corners.map((c, i) => (
                <circle key={i} cx={c.x} cy={c.z} r={wallW * 0.42} fill="#ffffff" stroke="#38bdf8" strokeWidth={wallW * 0.14} />
              ))}
              {handle && (
                <>
                  <line x1={corners[2].x} y1={corners[2].z} x2={handle.x} y2={handle.z} stroke="#38bdf8" strokeWidth={wallW * 0.12} />
                  <circle cx={handle.x} cy={handle.z} r={wallW * 0.9} fill="#38bdf8" stroke="#ffffff" strokeWidth={wallW * 0.16} />
                </>
              )}
            </g>
          );
        })}

        {/* Openings: a gap in the wall, plus a swing or a bar. Draggable along
            their own wall — a door in the wrong place blocks a run of units. */}
        {room.walls.flatMap((wall) =>
          (wall.openings ?? []).map((op, i) => {
            const dx = wall.end.x - wall.start.x;
            const dz = wall.end.z - wall.start.z;
            const length = Math.hypot(dx, dz) || 1;
            const ux = dx / length, uz = dz / length;
            const o = Math.min(Math.max(op.offset, 0), Math.max(0, length - op.width));
            const ax = wall.start.x + ux * o, az = wall.start.z + uz * o;
            const bx = ax + ux * op.width, bz = az + uz * op.width;
            const isSelected = selectedOpening?.wallId === wall.id && selectedOpening?.index === i;
            return (
              <g key={`${wall.id}_op${i}`} style={{ cursor: 'grab' }}>
                {isSelected && (
                  <line x1={ax} y1={az} x2={bx} y2={bz} stroke="#38bdf8" strokeOpacity={0.35} strokeWidth={wallW * 2.2} />
                )}
                <line x1={ax} y1={az} x2={bx} y2={bz} stroke={floorColor} strokeWidth={wallW * 1.35} />
                {/* Glass the depth sensor saw through is a SUGGESTION — dashed
                    until someone keeps it, since a mirror looks the same. */}
                <line
                  x1={ax} y1={az} x2={bx} y2={bz}
                  stroke={op.glass ? '#7dd3fc' : op.type === 'window' ? '#8ab4d8' : '#7a7a84'}
                  strokeWidth={wallW * 0.3}
                  strokeDasharray={op.glass ? `${wallW * 0.6} ${wallW * 0.4}` : undefined}
                />
                {/* A grab dot at the centre, so a 900mm door is not a hairline. */}
                <circle
                  cx={(ax + bx) / 2}
                  cy={(az + bz) / 2}
                  r={wallW * 0.42}
                  fill={op.type === 'window' ? '#8ab4d8' : '#9a9aa4'}
                  fillOpacity={0.85}
                />
              </g>
            );
          }),
        )}

        {/* Fixtures. Filled = detected, hollow = placed by hand.
            Labels step further into the room when they would collide: a sink's
            water and waste sit 150mm apart on a real wall, so overlapping text
            is the normal case, and two labels on top of each other make the
            plan less useful than no labels at all. */}
        {(() => { placedLabels.length = 0; return null; })()}
        {room.walls.flatMap((wall) =>
          (wall.fixtures ?? []).map((fixture, index) => {
            const p = fixturePoint(wall, fixture);
            const r = wallW * 0.8;
            const cx = p.x + p.inward.x * r * 1.3;
            const cz = p.z + p.inward.z * r * 1.3;
            const isSelected = selected?.wallId === wall.id && selected?.index === index;
            const detected = fixture.source === 'detected';

            let depth = 2.3;
            let lx = cx, lz = cz;
            for (let attempt = 0; attempt < 6; attempt++) {
              lx = cx + p.inward.x * r * depth;
              lz = cz + p.inward.z * r * depth;
              const clash = placedLabels.some(
                (q) => Math.abs(q.x - lx) < font * 5 && Math.abs(q.z - lz) < font,
              );
              if (!clash) break;
              depth += 1.5;
            }
            placedLabels.push({ x: lx, z: lz });
            return (
              <g key={`${wall.id}_fx${index}`} style={{ cursor: 'grab' }}>
                {isSelected && (
                  <circle cx={cx} cy={cz} r={r * 2.1} fill="#38bdf8" fillOpacity={0.22} stroke="#38bdf8" strokeWidth={wallW * 0.14} />
                )}
                <line x1={p.x} y1={p.z} x2={cx} y2={cz} stroke="#9aa3ad" strokeWidth={wallW * 0.16} />
                <circle cx={cx} cy={cz} r={r} fill={detected ? '#e8e8ea' : '#141416'} stroke="#e8e8ea" strokeWidth={wallW * 0.18} />
                <text x={cx} y={cz + r * 0.36} fontSize={r * 1.05} fontWeight={700} textAnchor="middle" fill={detected ? '#141416' : '#e8e8ea'}>
                  {GLYPH[fixture.type] ?? '?'}
                </text>
                <line x1={cx} y1={cz} x2={lx} y2={lz} stroke="#5b5b64" strokeWidth={wallW * 0.1} />
                <text x={lx} y={lz + font * 0.22} fontSize={font * 0.72} textAnchor="middle" fill="#c8c8d0">
                  {(LABEL[fixture.type] ?? fixture.type) + (fixture.diameterMm ? ` ⌀${fixture.diameterMm}` : '')}
                </text>
              </g>
            );
          }),
        )}

        {/* Edit Walls: the footprint's own corners, draggable. */}
        {editWalls && room.footprint.map((p, i) => (
          <circle
            key={`v${i}`}
            cx={p.x}
            cy={p.z}
            r={wallW * 0.85}
            fill="#ffffff"
            stroke="#38bdf8"
            strokeWidth={wallW * 0.22}
            style={{ cursor: 'grab' }}
          />
        ))}
      </svg>

      {/* Extra bottom padding so the hint clears the floating viewer controls. */}
      <div className="border-t border-white/10 bg-neutral-950/80 p-3 pb-20 text-sm">
        {editWalls ? (
          <p className="text-neutral-400">Drag a corner to reshape the room · the walls follow it</p>
        ) : selectedOpeningData && selectedOpening ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {(['window', 'door', 'archway'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => mutateOpening(selectedOpening, {
                    type: t,
                    sillHeight: t === 'window' ? selectedOpeningData.sillHeight || NEW_OPENING.window.sillHeight : 0,
                  })}
                  className={`rounded border px-2 py-1 text-xs ${
                    selectedOpeningData.type === t ? 'border-sky-400 text-sky-300' : 'border-white/15 text-neutral-300'
                  }`}
                >
                  {OPENING_LABEL[t]}
                </button>
              ))}
              {selectedOpeningData.glass && (
                <span className="ml-1 text-xs text-sky-300">
                  Seen through during the scan — glass? (a mirror looks the same)
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-300">
              {([
                ['Width', 'width'],
                ['Height', 'height'],
                ...(selectedOpeningData.type === 'window' ? [['Sill', 'sillHeight'] as const] : []),
              ] as const).map(([label, key]) => (
                <label key={key} className="flex items-center gap-1.5">
                  {label}
                  <input
                    type="number"
                    step={50}
                    min={0}
                    value={Math.round(selectedOpeningData[key])}
                    onChange={(e) => {
                      const mm = Number(e.target.value);
                      if (Number.isFinite(mm)) mutateOpening(selectedOpening, { [key]: mm });
                    }}
                    className="w-20 rounded border border-white/15 bg-neutral-900 px-1.5 py-1 tabular-nums"
                  />
                  mm
                </label>
              ))}
              <div className="ml-auto flex gap-1.5">
                {selectedOpeningData.glass && (
                  <button
                    type="button"
                    onClick={() => mutateOpening(selectedOpening, { glass: undefined })}
                    className="rounded border border-sky-400/50 px-2 py-1 text-sky-300"
                  >
                    Keep it
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => mutateOpening(selectedOpening, null)}
                  className="rounded border border-red-500/40 px-2 py-1 text-red-300"
                >
                  Remove
                </button>
              </div>
            </div>
          </div>
        ) : selectedFixture && selected ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-medium">
                {LABEL[selectedFixture.type] ?? selectedFixture.type}
              </span>
              <span className="tabular-nums text-neutral-400">{selectedFixture.height} mm</span>
            </div>
            <input
              type="range"
              min={0}
              max={Math.max(room.walls[0]?.height ?? 2400, 2000)}
              step={10}
              value={selectedFixture.height}
              onChange={(e) => {
                const mm = Number(e.target.value);
                setNewHeight(mm);
                mutate(selected, { height: mm });
              }}
              className="w-full"
            />
            <div className="flex items-center gap-2">
              {HEIGHT_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  onClick={() => {
                    setNewHeight(preset.mm);
                    mutate(selected, { height: preset.mm });
                  }}
                  className={`rounded border px-2 py-1 text-xs ${
                    Math.abs(selectedFixture.height - preset.mm) < 1
                      ? 'border-sky-400 text-sky-300'
                      : 'border-white/15 text-neutral-300'
                  }`}
                >
                  {preset.name}
                </button>
              ))}
              <button
                type="button"
                onClick={() => mutate(selected, null)}
                className="ml-auto rounded border border-red-500/40 px-2 py-1 text-xs text-red-300"
              >
                Remove
              </button>
            </div>
          </div>
        ) : selectedItem ? (
          <p className="text-neutral-400">
            {placedName(selectedItem)} · drag to move · drag the blue handle to turn it
            {selectedItem.scanned ? ' · Delete removes it from the plan' : ''}
          </p>
        ) : selectedModule ? (
          <p className="text-neutral-400">
            {catalog.definitions[selectedModule.definitionId]?.name ?? 'Unit'} · drag to move (it
            seats against a wall when near one) · Style → Finishes recolours it
          </p>
        ) : (
          <p className="text-neutral-400">
            Drag anything to move it · tap a wall to add a {tapAdds} · tap a door or window to
            resize it · tap a unit to select it
          </p>
        )}
      </div>
    </div>
  );
}
