'use client';

import { Suspense, useCallback, useMemo, useRef, useState } from 'react';
import { useGLTF } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  furnitureItem,
  furnitureModelUrl,
  placedSize,
  type PlacedFurniture,
} from '@/systems/furniture/catalog';
import { furnitureParts } from '@/systems/furniture/parts';
import { swatchById, type SurfaceFinish } from '@/systems/aesthetic/finishes';
import { useConfiguratorStore } from '@/state/useConfiguratorStore';
import { useFinishMaterial, useFinishTexture } from './finishMaterial';
import { materialKind } from '@/systems/aesthetic/finishes';

/**
 * Free-form furniture in 3D — the web half of the iPad's design mode.
 *
 * Kitchen modules belong to a wall and are packed along it, so dragging one
 * only answers "which wall". A sofa does not belong to anything: it goes where
 * you put it. So these drag continuously across the floor and stop at the walls
 * (`clampToRoom`), which is the gesture the iPad has and the reason a room can
 * be arranged on a laptop instead of only inspected there.
 *
 * Each item renders the iPad's OWN model, converted from its USDZ by
 * `scripts/usdz-to-glb.py` — the same geometry and the same materials, so a
 * cabinet on the web is the cabinet, not a box the right size. While the model
 * streams in, the composed boxes stand in: they are what the iPad's generated
 * furniture is built from anyway, so the placeholder is the right shape and
 * colour rather than a hole in the room.
 */
export function DesignItems() {
  const items = useConfiguratorStore((s) => s.designItems);
  const selection = useConfiguratorStore((s) => s.designSelection);
  const select = useConfiguratorStore((s) => s.selectFurniture);
  const move = useConfiguratorStore((s) => s.moveFurniture);
  const { drag, begin } = useFloorDrag(move);

  if (items.length === 0) return null;

  return (
    <group>
      {items.map((placed) => {
        const onGrab = () => {
          select(placed.id);
          begin(placed.id);
        };
        return placed.column ? (
          <ColumnMesh key={placed.id} placed={placed} selected={placed.id === selection} onGrab={onGrab} />
        ) : (
          <FurnitureMesh
            key={placed.id}
            placed={placed}
            selected={placed.id === selection}
            dragging={placed.id === drag}
            onGrab={onGrab}
          />
        );
      })}
    </group>
  );
}

/**
 * A scanned column: structure, floor to ceiling, in the same finish as the
 * walls — which is what it is in every room that has one. Round when the scan
 * says round; a translucent measurement box was the wrong thing to draw for
 * something nobody is going to carry out.
 */
function ColumnMesh({
  placed,
  selected,
  onGrab,
}: {
  placed: PlacedFurniture;
  selected: boolean;
  onGrab: () => void;
}) {
  const wallFinish = useConfiguratorStore((s) => s.wallFinish);
  const size = placedSize(placed);
  // Cylinder and box UVs run 0…1 up the side, so one UV unit is the height.
  const material = useFinishMaterial(wallFinish, { uvUnitMm: size.height });
  const round = placed.column === 'round';

  return (
    <group
      position={[placed.position.x, 0, placed.position.z]}
      rotation={[0, placed.rotationY, 0]}
      onPointerDown={(e) => {
        e.stopPropagation();
        onGrab();
      }}
    >
      <mesh castShadow receiveShadow position={[0, size.height / 2, 0]} material={material}>
        {round ? (
          <cylinderGeometry args={[size.width / 2, size.width / 2, size.height, 48]} />
        ) : (
          <boxGeometry args={[size.width, size.height, size.depth]} />
        )}
      </mesh>
      {selected && (
        <mesh position={[0, size.height / 2, 0]}>
          {round ? (
            <cylinderGeometry args={[size.width / 2 + 30, size.width / 2 + 30, size.height + 20, 48]} />
          ) : (
            <boxGeometry args={[size.width + 60, size.height + 20, size.depth + 60]} />
          )}
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.16} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}

function FurnitureMesh({
  placed,
  selected,
  dragging,
  onGrab,
}: {
  placed: PlacedFurniture;
  selected: boolean;
  dragging: boolean;
  onGrab: () => void;
}) {
  const item = furnitureItem(placed.itemId);
  const parts = useMemo(() => (item ? furnitureParts(item) : []), [item]);
  const measured = placedSize(placed);
  // A finish is a per-instance OVERRIDE. Absent, the item keeps the colours its
  // parts were authored with — the same rule as `DesignState.add`, which
  // deliberately leaves `finish` nil so placing a sofa does not flatten its
  // authored materials into one swatch.
  const override = useOverrideMaterial(placed.finish);

  // A scanned piece has no catalogue entry and no model — it is a measurement
  // of what is in the room today. Drawn as the box it was measured as, in a
  // colour that says so, and removable like anything else.
  if (!item) {
    return (
      <group
        position={[placed.position.x, 0, placed.position.z]}
        rotation={[0, placed.rotationY, 0]}
        onPointerDown={(e) => {
          e.stopPropagation();
          onGrab();
        }}
      >
        <mesh castShadow receiveShadow position={[0, measured.height / 2, 0]}>
          <boxGeometry args={[measured.width, measured.height, measured.depth]} />
          <meshStandardMaterial
            color={dragging ? '#7dd3fc' : '#9aa3ad'}
            roughness={0.85}
            transparent
            opacity={0.55}
          />
        </mesh>
        {selected && (
          <mesh position={[0, measured.height / 2, 0]}>
            <boxGeometry args={[measured.width + 60, measured.height + 60, measured.depth + 60]} />
            <meshBasicMaterial color="#38bdf8" transparent opacity={0.16} depthWrite={false} />
          </mesh>
        )}
      </group>
    );
  }

  const height = item.size.height;

  return (
    <group
      position={[placed.position.x, 0, placed.position.z]}
      rotation={[0, placed.rotationY, 0]}
      onPointerDown={(e) => {
        e.stopPropagation(); // don't let OrbitControls start a spin
        onGrab();
      }}
    >
      <Suspense fallback={<Blocks parts={parts} override={override} dragging={dragging} />}>
        <Model
          url={furnitureModelUrl(item.id)}
          // The model keeps its authored materials until someone actually
          // chooses a finish. Flattening its normal and roughness maps into one
          // colour is what makes a model look like plastic, and nobody asked
          // for that by not choosing anything.
          override={override ?? (dragging ? DRAG_MATERIAL : null)}
          fallback={<Blocks parts={parts} override={override} dragging={dragging} />}
        />
      </Suspense>

      {selected && (
        // The iPad's selection halo: a translucent box around the item, sized
        // from the catalogue so it is right before any model has loaded.
        <mesh position={[0, height / 2, 0]}>
          <boxGeometry args={[item.size.width + 60, height + 60, item.size.depth + 60]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.16} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}

/** The tint on the piece being carried, so it is obvious what a drop applies to. */
const DRAG_MATERIAL = new THREE.MeshStandardMaterial({ color: '#7dd3fc', roughness: 0.6 });

/**
 * The converted model. A missing or unreadable file falls back to the composed
 * boxes rather than leaving a hole — a room that silently loses a sofa is worse
 * than one showing a sofa-shaped block.
 */
function Model({
  url,
  override,
  fallback,
}: {
  url: string;
  override: THREE.Material | null;
  fallback: React.ReactNode;
}) {
  const gltf = useGLTF(url);
  const object = useMemo(() => {
    if (!gltf?.scene) return null;
    const clone = gltf.scene.clone(true);
    clone.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (override) mesh.material = override;
    });
    return clone;
  }, [gltf, override]);

  if (!object) return <>{fallback}</>;
  return <primitive object={object} />;
}

function Blocks({
  parts,
  override,
  dragging,
}: {
  parts: { c: [number, number, number]; s: [number, number, number]; color: string; roughness: number; metalness: number }[];
  override: THREE.MeshStandardMaterial | null;
  dragging: boolean;
}) {
  return (
    <>
      {parts.map((part, i) => (
        <mesh key={i} castShadow receiveShadow position={part.c}>
          <boxGeometry args={part.s} />
          {override ? (
            <primitive object={override} attach="material" />
          ) : (
            <meshStandardMaterial
              color={dragging ? '#7dd3fc' : part.color}
              roughness={part.roughness}
              metalness={part.metalness}
            />
          )}
        </mesh>
      ))}
    </>
  );
}

/** A per-instance finish override, or null to keep the authored part colours. */
function useOverrideMaterial(finish: SurfaceFinish | undefined): THREE.MeshStandardMaterial | null {
  const empty = useMemo<SurfaceFinish>(
    () => ({ swatchId: '', kind: 'matte', textureScale: 1, rotation: 0 }),
    [],
  );
  const texture = useFinishTexture(finish ?? empty);
  const swatch = finish ? swatchById(finish.swatchId) : undefined;
  const kind = materialKind(finish?.kind ?? 'matte');

  return useMemo(() => {
    if (!finish) return null;
    const material = new THREE.MeshStandardMaterial();
    if (texture) {
      const map = texture.clone();
      map.needsUpdate = true;
      // Furniture faces carry 0…1 box UVs, and a cabinet door is roughly half a
      // metre, so half a tile across a door is the right density.
      const repeat = 0.5 * finish.textureScale;
      map.repeat.set(repeat, repeat);
      map.center.set(0.5, 0.5);
      map.rotation = finish.rotation;
      material.map = map;
      material.color = new THREE.Color(finish.tint ?? '#ffffff');
    } else {
      material.color = new THREE.Color(finish.tint ?? swatch?.color ?? '#cccccc');
    }
    material.roughness = kind.roughness;
    material.metalness = kind.metalness;
    if (finish.kind === 'glass') {
      material.transparent = true;
      material.opacity = kind.opacity;
    }
    return material;
  }, [finish, texture, swatch?.color, kind.roughness, kind.metalness, kind.opacity]);
}

/**
 * Drag an item across the floor. The floor is the drag surface because a
 * pointer ray always meets it — a drag that stops tracking when you sweep past
 * the room feels broken even though nothing is wrong.
 */
function useFloorDrag(move: (id: string, p: { x: number; z: number }) => void) {
  const [drag, setDrag] = useState<string | null>(null);
  const { camera, gl } = useThree();
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const hit = useMemo(() => new THREE.Vector3(), []);
  const pointer = useRef(new THREE.Vector2());

  const begin = useCallback(
    (id: string) => {
      setDrag(id);

      const onMove = (event: PointerEvent) => {
        const rect = gl.domElement.getBoundingClientRect();
        pointer.current.set(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          -((event.clientY - rect.top) / rect.height) * 2 + 1,
        );
        raycaster.setFromCamera(pointer.current, camera);
        if (!raycaster.ray.intersectPlane(plane, hit)) return;
        // The scene authors millimetres inside a mm→m group, so metres come back.
        move(id, { x: hit.x * 1000, z: hit.z * 1000 });
      };

      const end = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', end);
        setDrag(null);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', end);
    },
    [camera, gl, plane, raycaster, hit, move],
  );

  return { drag, begin };
}
