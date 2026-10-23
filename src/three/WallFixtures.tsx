import { useMemo } from 'react';
import type { Room, Wall, WallFixture } from '@/lib/types';

/**
 * Sockets, switches and pipework, on the walls, in 3D.
 *
 * The plan has always shown these; the 3D view has not, which made the two
 * views disagree about the room — and the 3D view is the one people design in.
 * A cabinet that visibly covers a socket is an argument you cannot miss; the
 * same cabinet with the socket invisible is a warning in a panel someone will
 * scroll past.
 *
 * Geometry matches the iPad's `Room3DBuilder` so a room looks the same in both
 * places: a faceplate standing proud of the wall's inward face, carrying darker
 * slots, and pipes as vertical cylinders at their real measured diameter.
 */

const PLATE = { w: 86, h: 86, d: 11 };      // mm — a single-gang faceplate
const SWITCH_PLATE = { w: 86, h: 86, d: 12 };

const PIPE_COLOR: Record<string, string> = {
  water: '#b6c3cc',
  waste: '#d7d7d2',
  gas: '#e0b23a',
};

/** Everything that reads as a plate rather than a pipe. */
const PLATED = new Set(['socket', 'switch']);

export function WallFixtures({ room }: { room: Room }) {
  const items = useMemo(() => {
    const out: { key: string; wall: Wall; fixture: WallFixture }[] = [];
    for (const wall of room.walls) {
      for (const [i, fixture] of (wall.fixtures ?? []).entries()) {
        out.push({ key: `${wall.id}_${i}`, wall, fixture });
      }
    }
    return out;
  }, [room]);

  if (!items.length) return null;

  return (
    <group>
      {items.map(({ key, wall, fixture }) => (
        <FixtureOnWall key={key} wall={wall} fixture={fixture} />
      ))}
    </group>
  );
}

function FixtureOnWall({ wall, fixture }: { wall: Wall; fixture: WallFixture }) {
  const dx = wall.end.x - wall.start.x;
  const dz = wall.end.z - wall.start.z;
  const length = Math.hypot(dx, dz) || 1;
  const ux = dx / length;
  const uz = dz / length;

  // Along the wall to the fixture, then off the face into the room. Which side
  // is "into the room" is the wall's own inward normal; both candidates are
  // perpendicular, and the one pointing at the room centre is the right one.
  const t = Math.min(Math.max(fixture.offset, 0), length);
  const px = wall.start.x + ux * t;
  const pz = wall.start.z + uz * t;
  const rotationY = Math.atan2(-dz, dx);

  // Perpendicular, pointing away from the wall's own line. Rendered on BOTH
  // faces would be wrong; the room side is the one that matters, and the wall
  // is thin enough that half a thickness of offset settles it.
  const nx = -uz;
  const nz = ux;
  const standoff = wall.thickness / 2;

  if (PLATED.has(fixture.type)) {
    const plate = fixture.type === 'switch' ? SWITCH_PLATE : PLATE;
    return (
      <group
        position={[px + nx * standoff, fixture.height, pz + nz * standoff]}
        rotation={[0, rotationY, 0]}
      >
        {/* Faceplate, standing proud of the wall. */}
        <mesh castShadow>
          <boxGeometry args={[plate.w, plate.h, plate.d]} />
          <meshStandardMaterial color="#f4f4f1" roughness={0.45} />
        </mesh>
        {fixture.type === 'socket' ? (
          // Two pin slots, so it reads as an outlet rather than a blank tile.
          <>
            <mesh position={[-17, 4, plate.d / 2]}>
              <boxGeometry args={[5, 16, 2]} />
              <meshStandardMaterial color="#1a1a1c" roughness={0.9} />
            </mesh>
            <mesh position={[17, 4, plate.d / 2]}>
              <boxGeometry args={[5, 16, 2]} />
              <meshStandardMaterial color="#1a1a1c" roughness={0.9} />
            </mesh>
          </>
        ) : (
          // A rocker.
          <mesh position={[0, 0, plate.d / 2]}>
            <boxGeometry args={[38, 44, 3]} />
            <meshStandardMaterial color="#e6e6e2" roughness={0.5} />
          </mesh>
        )}
      </group>
    );
  }

  // Pipework: a vertical run at its measured diameter, from the floor up past
  // the fixture height, because that is what is actually in the way.
  const diameter = fixture.diameterMm ?? (fixture.type === 'waste' ? 110 : 22);
  const top = Math.max(fixture.height + 260, 420);
  return (
    <mesh
      castShadow
      position={[px + nx * (standoff + diameter / 2), top / 2, pz + nz * (standoff + diameter / 2)]}
    >
      <cylinderGeometry args={[diameter / 2, diameter / 2, top, 16]} />
      <meshStandardMaterial
        color={PIPE_COLOR[fixture.type] ?? '#c8c8c4'}
        roughness={fixture.type === 'gas' ? 0.5 : 0.75}
        metalness={fixture.type === 'gas' ? 0.35 : 0.1}
      />
    </mesh>
  );
}
