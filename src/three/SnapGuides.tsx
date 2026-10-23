import { useMemo } from 'react';
import type { Room } from '@/lib/types';
import { buildRuns, DEFAULT_RULES } from '@/systems/layout';

/**
 * Wall-snapping visualization: a cyan rail along each run's usable interval —
 * exactly where modules snap (back-to-wall, between the corner reserves). Reuses
 * the Step 4 engine's `buildRuns`, so the guides always match real placement.
 */
export function SnapGuides({ room }: { room: Room }) {
  const runs = useMemo(
    () => [...buildRuns(room, room.walls.map((w) => w.id), DEFAULT_RULES).values()],
    [room],
  );

  return (
    <group>
      {runs.map((run) => {
        const length = run.usableEnd - run.usableStart;
        if (length <= 0) return null;
        const mid = run.usableStart + length / 2;
        const inset = 30; // nudge off the wall so the rail is visible
        const px = run.origin.x + run.dir.x * mid + run.normal.x * inset;
        const pz = run.origin.z + run.dir.z * mid + run.normal.z * inset;
        const rotationY = Math.atan2(-run.dir.z, run.dir.x);
        return (
          <mesh key={run.id} position={[px, 60, pz]} rotation={[0, rotationY, 0]}>
            <boxGeometry args={[length, 100, 16]} />
            <meshBasicMaterial color="#22d3ee" transparent opacity={0.45} />
          </mesh>
        );
      })}
    </group>
  );
}
