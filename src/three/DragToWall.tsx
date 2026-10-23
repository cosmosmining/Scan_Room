'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Room } from '@/lib/types';
import { placeByHand } from '@/systems/layout';
import { useConfiguratorStore } from '@/state/useConfiguratorStore';

/**
 * Pick up a unit and put it somewhere.
 *
 * The unit follows the floor under the pointer and lands where you drop it, and
 * the wall it is nearest lights up. Near a wall it SNAPS to that wall — seated
 * against it, turned to face into the room — because a cabinet dropped 40mm off
 * the wall with a 3mm gap behind it is a drawing, not a kitchen. Out in the
 * middle of the floor it stays exactly where you put it, which is how an island
 * gets placed.
 *
 * An earlier version only re-assigned `wallId` and let the packer choose the
 * position. That is a defensible model and it is what the layout engine wants,
 * but it means dragging a cabinet along its own wall does nothing at all —
 * which does not read as a strong opinion, it reads as broken.
 */

/** Under this much travel a gesture is a tap, not a drag. Millimetres. */
const TAP_SLOP = 40;

export interface DragState {
  /** Node id being dragged, or null. */
  id: string | null;
  /** Wall it would land on if released now. */
  targetWallId: string | null;
  /** Where the pointer is on the floor (mm). */
  point: { x: number; z: number } | null;
}

export function useWallDrag(room: Room) {
  const setNodeTransform = useConfiguratorStore((s) => s.setNodeTransform);
  const instances = useConfiguratorStore((s) => s.instances);
  const catalog = useConfiguratorStore((s) => s.catalog);
  const [drag, setDrag] = useState<DragState>({ id: null, targetWallId: null, point: null });
  const { camera, gl } = useThree();

  // The floor is the drag surface: a pointer ray always meets it, which a wall
  // plane does not — and a drag that stops tracking when you sweep past the room
  // feels broken even though nothing is wrong.
  const floor = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const pointer = useRef(new THREE.Vector2());
  const hit = useMemo(() => new THREE.Vector3(), []);

  /** Screen event → a point on the floor, in millimetres. */
  const floorPoint = useCallback(
    (event: PointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect();
      pointer.current.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer.current, camera);
      if (!raycaster.ray.intersectPlane(floor, hit)) return null;
      // The scene authors millimetres inside a mm→m group, so metres come back.
      return { x: hit.x * 1000, z: hit.z * 1000 };
    },
    [camera, gl, raycaster, floor, hit],
  );


  const begin = useCallback(
    (id: string) => {
      setDrag({ id, targetWallId: null, point: null });
      const inst = instances.find((i) => i.id === id);
      const def = inst ? catalog.definitions[inst.definitionId] : undefined;
      const depth = def?.dimensions.depth ?? 600;
      const startYaw = inst?.rotationY ?? 0;
      let origin: { x: number; z: number } | null = null;

      const move = (event: PointerEvent) => {
        const point = floorPoint(event);
        if (!point) return;
        origin ??= point;
        // Commit only once the pointer has genuinely set off. Without this a
        // click with a pixel of jitter takes the unit out of its packed run,
        // and a selection quietly becomes a placement.
        if (Math.hypot(point.x - origin.x, point.z - origin.z) <= TAP_SLOP) return;
        const placement = placeByHand(room, point, depth, startYaw);
        // Commit live rather than on release, so the unit is under the pointer
        // the whole time instead of jumping when you let go.
        setNodeTransform(id, { position: placement.position, rotationY: placement.rotationY });
        setDrag((d) => (d.id ? { ...d, targetWallId: placement.wallId, point } : d));
      };

      const end = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
        // A click that never moved never called `move`, so nothing was
        // committed: a tap selects and leaves the unit exactly as it was.
        setDrag({ id: null, targetWallId: null, point: null });
      };

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
    },
    [floorPoint, room, instances, catalog, setNodeTransform],
  );

  return { drag, begin };
}

/** The wall a dragged unit would land on, lit up along its face. */
export function WallDropTarget({ room, wallId }: { room: Room; wallId: string | null }) {
  const wall = room.walls.find((w) => w.id === wallId);
  if (!wall) return null;
  const dx = wall.end.x - wall.start.x;
  const dz = wall.end.z - wall.start.z;
  const length = Math.hypot(dx, dz);
  return (
    <mesh
      position={[
        (wall.start.x + wall.end.x) / 2,
        wall.height / 2,
        (wall.start.z + wall.end.z) / 2,
      ]}
      rotation={[0, Math.atan2(-dz, dx), 0]}
    >
      <boxGeometry args={[length, wall.height, wall.thickness + 30]} />
      <meshBasicMaterial color="#38bdf8" transparent opacity={0.22} depthWrite={false} />
    </mesh>
  );
}
