import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Room, Wall, WallOpening } from '@/lib/types';
import { TRIM_COLOR, type SurfaceFinish } from '@/systems/aesthetic/finishes';
import { useConfiguratorStore } from '@/state/useConfiguratorStore';
import { useFinishMaterial } from './finishMaterial';
import { roomBounds } from './units';

/**
 * Read a room finish out of the store. A hook rather than a prop so every
 * caller of `RoomShell` gets the finishes without threading three more props
 * through the scene graph.
 */
function useRoomFinish(surface: 'wall' | 'floor' | 'ceiling'): SurfaceFinish {
  return useConfiguratorStore((s) =>
    surface === 'wall' ? s.wallFinish : surface === 'floor' ? s.floorFinish : s.ceilingFinish,
  );
}

/**
 * The room shell — floor, walls and ceiling — ported from
 * `Design/Render/Room3DBuilder.swift`.
 *
 * The web used to draw a grey plane and grey slabs, which is why a room that
 * looked like somewhere you could stand on an iPad looked like a cardboard box
 * in a browser. Everything the iPad does to make the shell read as a real room
 * is here: the scanned finishes on real PBR materials, openings genuinely cut
 * out of the wall (so a doorway has a reveal you can see the thickness of),
 * painted jambs and heads and window sills, glass in the windows, and a
 * baseboard that breaks at every door.
 *
 * Culling follows the iPad's dollhouse rule — from outside you look straight
 * into the room rather than at the back of a lid. The ceiling gets it for free
 * by facing down; a wall cannot, because giving it real thickness (which is
 * what makes a doorway have a reveal) also gives it a genuine outward face, so
 * each wall hides itself while the camera is on its outward side. Authored in
 * millimetres inside the scene's mm→m group.
 */
export function RoomShell({ room }: { room: Room }) {
  const wallFinish = useRoomFinish('wall');
  const floorFinish = useRoomFinish('floor');
  const ceilingFinish = useRoomFinish('ceiling');

  const b = useMemo(() => roomBounds(room), [room]);
  const height = room.walls[0]?.height ?? room.height;

  // UVs come out of the geometry in millimetres, so one UV unit is one
  // millimetre and the texture tiles at real-world density.
  const floorMaterial = useFinishMaterial(floorFinish, { uvUnitMm: 1 });
  const ceilingMaterial = useFinishMaterial(ceilingFinish, { uvUnitMm: 1 });

  const floorGeometry = useMemo(() => polygonGeometry(room.footprint, 'floor'), [room.footprint]);
  const ceilingGeometry = useMemo(() => polygonGeometry(room.footprint, 'ceiling'), [room.footprint]);

  // A degenerate footprint (a scan that produced two points) would triangulate
  // to nothing; fall back to the bounding rectangle so there is still a floor.
  const hasPolygon = room.footprint.length >= 3;

  return (
    <group>
      {hasPolygon ? (
        <mesh receiveShadow geometry={floorGeometry} material={floorMaterial} rotation={[-Math.PI / 2, 0, 0]} />
      ) : (
        <mesh
          receiveShadow
          material={floorMaterial}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[(b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2]}
        >
          <planeGeometry args={[b.maxX - b.minX, b.maxZ - b.minZ]} />
        </mesh>
      )}

      {hasPolygon && (
        <mesh
          geometry={ceilingGeometry}
          material={ceilingMaterial}
          rotation={[Math.PI / 2, 0, 0]}
          position={[0, height, 0]}
        />
      )}

      {room.walls.map((wall) => (
        <WallMesh key={wall.id} wall={wall} finish={wallFinish} room={room} />
      ))}
    </group>
  );
}

/**
 * Triangulate the footprint. `THREE.Shape` writes UVs straight from the shape's
 * own coordinates, so they arrive in millimetres — which is what makes the
 * texture tile by real size rather than being stretched to fit the room.
 *
 * The floor's front face points up and the ceiling's points down, so an orbit
 * camera above the room sees through the ceiling into it (the iPad's dollhouse
 * cutaway) instead of at a lid.
 */
function polygonGeometry(footprint: { x: number; z: number }[], face: 'floor' | 'ceiling') {
  const shape = new THREE.Shape();
  const flip = face === 'floor' ? -1 : 1;
  if (footprint.length < 3) return new THREE.BufferGeometry();
  shape.moveTo(footprint[0].x, footprint[0].z * flip);
  for (const p of footprint.slice(1)) shape.lineTo(p.x, p.z * flip);
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.computeVertexNormals();
  return geometry;
}

/** Where an opening sits on its wall, resolved and clamped — `OpeningSpan`. */
interface Span {
  t0: number; t1: number; y0: number; y1: number;
  type: WallOpening['type'];
  /** Doors and archways reach the floor, so they break the baseboard run. */
  reachesFloor: boolean;
}

function resolveSpans(wall: Wall, length: number): Span[] {
  const spans: Span[] = [];
  for (const o of wall.openings ?? []) {
    // `offset` is the LEADING edge — the shared RoomScan contract — so the
    // opening spans [offset, offset + width]. Reading it as a centre puts every
    // door half its own width out of place.
    const t0 = Math.max(o.offset, 20);
    const t1 = Math.min(o.offset + o.width, length - 20);
    if (t1 - t0 <= 50) continue;
    const y0 = o.type === 'window' ? (o.sillHeight ?? 0) : 0;
    const y1 = Math.min(y0 + o.height, wall.height);
    if (y1 <= y0) continue;
    spans.push({ t0, t1, y0, y1, type: o.type, reachesFloor: o.type !== 'window' });
  }
  return spans.sort((a, b) => a.t0 - b.t0);
}

function WallMesh({ wall, finish, room }: { wall: Wall; finish: SurfaceFinish; room: Room }) {
  const dx = wall.end.x - wall.start.x;
  const dz = wall.end.z - wall.start.z;
  const length = Math.hypot(dx, dz);
  const midX = (wall.start.x + wall.end.x) / 2;
  const midZ = (wall.start.z + wall.end.z) / 2;
  const rotationY = Math.atan2(-dz, dx);

  const spans = useMemo(() => resolveSpans(wall, length), [wall, length]);

  // Which side of this wall is the room. Trim and sills protrude inward, and
  // the wall hides itself when the camera is on the other side.
  const inward = useMemo(() => {
    const c = room.footprint.reduce(
      (acc, p) => ({ x: acc.x + p.x / room.footprint.length, z: acc.z + p.z / room.footprint.length }),
      { x: 0, z: 0 },
    );
    const n = { x: -dz / (length || 1), z: dx / (length || 1) };
    return (n.x * (c.x - midX) + n.z * (c.z - midZ)) >= 0 ? n : { x: -n.x, z: -n.z };
  }, [room.footprint, dx, dz, length, midX, midZ]);

  const group = useRef<THREE.Group>(null);
  useFrame(({ camera }) => {
    const g = group.current;
    if (!g) return;
    // Camera is in metres; the wall is in millimetres inside the mm→m group.
    const toCamX = camera.position.x * 1000 - midX;
    const toCamZ = camera.position.z * 1000 - midZ;
    // Positive dot with the INWARD normal means the camera is in the room's
    // half-space for this wall, so the face you would see is the inside one.
    g.visible = inward.x * toCamX + inward.z * toCamZ > -50;
  });

  const geometry = useMemo(() => {
    const shape = new THREE.Shape();
    // Centred on the wall's midpoint, so the mesh drops in where the box did.
    shape.moveTo(-length / 2, 0);
    shape.lineTo(length / 2, 0);
    shape.lineTo(length / 2, wall.height);
    shape.lineTo(-length / 2, wall.height);
    shape.closePath();

    for (const span of spans) {
      const x0 = span.t0 - length / 2;
      const x1 = span.t1 - length / 2;
      const hole = new THREE.Path();
      hole.moveTo(x0, span.y0);
      hole.lineTo(x1, span.y0);
      hole.lineTo(x1, span.y1);
      hole.lineTo(x0, span.y1);
      hole.closePath();
      shape.holes.push(hole);
    }

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: wall.thickness,
      bevelEnabled: false,
      curveSegments: 1,
    });
    // Extrusion runs along +Z from the shape plane; recentre on the wall line.
    geo.translate(0, 0, -wall.thickness / 2);
    geo.computeVertexNormals();
    return geo;
  }, [length, wall.height, wall.thickness, spans]);

  // Extrude writes the face UVs from the shape's own coordinates — along-wall
  // and up, in millimetres — so plaster tiles at its real size on a 5 m wall.
  const material = useFinishMaterial(finish, { uvUnitMm: 1, side: THREE.DoubleSide });

  return (
    <group ref={group} position={[midX, 0, midZ]} rotation={[0, rotationY, 0]}>
      <mesh castShadow receiveShadow geometry={geometry} material={material} />
      {spans.map((span, i) => (
        <OpeningTrim key={i} span={span} length={length} thickness={wall.thickness} />
      ))}
      <Baseboard spans={spans} length={length} thickness={wall.thickness} />
    </group>
  );
}

/**
 * Trim around an opening, in the wall's local frame: local +X runs along the
 * wall from start to end and local +Z is the wall's own thickness direction, so
 * everything here is placed by (distance along, height) exactly as
 * `Room3DBuilder.wallBox` does.
 *
 * Windows get glass, jambs, a head and a protruding sill; doors get jambs and a
 * head; archways stay clean cut-throughs.
 */
function OpeningTrim({ span, length, thickness }: { span: Span; length: number; thickness: number }) {
  if (span.type === 'archway') return null;

  const w = span.t1 - span.t0;
  const h = span.y1 - span.y0;
  const tMid = (span.t0 + span.t1) / 2 - length / 2;
  const t0 = span.t0 - length / 2;
  const t1 = span.t1 - length / 2;
  const yMid = (span.y0 + span.y1) / 2;
  const casing = Math.max(thickness + 10, 100);

  if (span.type === 'window') {
    const jamb = 50;
    return (
      <group>
        <mesh position={[tMid, yMid, 0]}>
          <boxGeometry args={[w, h, 12]} />
          {/* Slightly blue, highly transparent — `glassMaterial()`. */}
          <meshStandardMaterial
            color="#c7dbf0"
            roughness={0.03}
            metalness={0}
            transparent
            opacity={0.18}
            side={THREE.DoubleSide}
          />
        </mesh>
        <TrimBox position={[t0, yMid, 0]} size={[jamb, h + jamb, casing]} />
        <TrimBox position={[t1, yMid, 0]} size={[jamb, h + jamb, casing]} />
        <TrimBox position={[tMid, span.y1, 0]} size={[w + jamb, jamb, casing]} />
        {/* Sill board: wider, deeper, protruding into the room. */}
        <TrimBox position={[tMid, span.y0, 20]} size={[w + 80, 40, 160]} />
      </group>
    );
  }

  const jamb = 55;
  return (
    <group>
      <TrimBox position={[t0, span.y1 / 2, 0]} size={[jamb, span.y1, casing]} />
      <TrimBox position={[t1, span.y1 / 2, 0]} size={[jamb, span.y1, casing]} />
      <TrimBox position={[tMid, span.y1, 0]} size={[w + jamb, jamb, casing]} />
    </group>
  );
}

/** Skirting along the floor, broken where doors and archways cut through. */
function Baseboard({ spans, length, thickness }: { spans: Span[]; length: number; thickness: number }) {
  const runs = useMemo(() => {
    const out: [number, number][] = [];
    let cursor = 0;
    for (const s of spans) {
      if (!s.reachesFloor) continue;
      if (s.t0 > cursor + 30) out.push([cursor, s.t0]);
      cursor = Math.max(cursor, s.t1);
    }
    if (cursor < length - 30) out.push([cursor, length]);
    return out;
  }, [spans, length]);

  const height = 90;
  const depth = 16;
  return (
    <group>
      {runs.map(([r0, r1], i) => (
        <TrimBox
          key={i}
          position={[(r0 + r1) / 2 - length / 2, height / 2, (thickness + depth) / 2]}
          size={[r1 - r0, height, depth]}
        />
      ))}
    </group>
  );
}

function TrimBox({
  position,
  size,
}: {
  position: [number, number, number];
  size: [number, number, number];
}) {
  return (
    <mesh castShadow receiveShadow position={position}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={TRIM_COLOR} roughness={0.35} metalness={0} />
    </mesh>
  );
}
