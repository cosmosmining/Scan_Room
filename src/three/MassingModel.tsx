'use client';

import type { MassingModel as MassingModelData, MassingKind } from '@/systems/scan';

/**
 * The white "box massing" model — walls as slabs, the floor as a thin slab, and
 * detected furniture (the closet) as labelled boxes. This is the solid that
 * grows during a LiDAR scan and that the user rotates before "Go to planning".
 * Authored in millimetres; wrap in a `<group scale={MM_TO_M}>`.
 */
const KIND_COLOR: Record<MassingKind, string> = {
  wall: '#f4f4f2',
  floor: '#dedbd2',
  object: '#c9cfd6',
};

export function MassingModel({
  model,
  opacity = 1,
}: {
  model: MassingModelData;
  opacity?: number;
}) {
  return (
    <group>
      {model.boxes.map((box) => (
        <mesh
          key={box.id}
          position={[box.center.x, box.center.y, box.center.z]}
          rotation={[0, box.rotationY, 0]}
          castShadow={box.kind !== 'floor'}
          receiveShadow
        >
          <boxGeometry args={[box.size.x, box.size.y, box.size.z]} />
          <meshStandardMaterial
            color={KIND_COLOR[box.kind]}
            roughness={0.9}
            metalness={0}
            transparent={opacity < 1}
            opacity={opacity}
          />
        </mesh>
      ))}
    </group>
  );
}
