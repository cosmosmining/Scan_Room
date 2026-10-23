'use client';

import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MassingModel } from '@/three/MassingModel';
import { ScanEdges } from '@/three/ScanEdges';
import { MM_TO_M, roomBounds } from '@/three/units';
import {
  createScanAccumulator,
  type MassingObject,
  type PlaneObservation,
  type ScanSnapshot,
} from '@/systems/scan';
import { useConfiguratorStore } from '@/state/useConfiguratorStore';

/**
 * The LiDAR scan experience — Phase 1 made visible. As "walls are detected" the
 * boundary lines light up and the white box massing grows (the closet included),
 * exactly like the reference app. It runs as a guided replay of the room's
 * planes, so it works on any device (no depth sensor required) and still lands
 * the user in the configurator on a real, dimensioned room — the answer to
 * "they need a LiDAR sensor which I don't have, I couldn't try it."
 *
 * On a depth-capable device the same accumulator is fed by the live sensor
 * (see `LidarScanner`); the visualization is identical.
 */
const STEP_MS = 650;

export function LidarScan({ onClose }: { onClose: () => void }) {
  const room = useConfiguratorStore((s) => s.room);
  const applyRoomGeometry = useConfiguratorStore((s) => s.applyRoomGeometry);

  const [scanKey, setScanKey] = useState(0);
  const accumulator = useMemo(
    () => createScanAccumulator({ expectedWalls: room.walls.length, unitSystem: room.unitSystem }),
    // A new accumulator per room and per rescan (scanKey) — a clean capture.
    [room, scanKey],
  );

  // The plane "observations" to feed, in wall order, plus one detected object
  // (the closet/wardrobe) to echo the box scan from the video.
  const planes = useMemo<PlaneObservation[]>(
    () =>
      room.walls.map((w) => ({
        start: { x: w.start.x, z: w.start.z },
        end: { x: w.end.x, z: w.end.z },
        height: w.height,
        thickness: w.thickness,
      })),
    [room],
  );
  const object = useMemo<MassingObject>(() => {
    const b = roomBounds(room);
    return {
      category: 'wardrobe',
      center: { x: b.minX + 700, z: b.minZ + 400 },
      width: 1000,
      depth: 600,
      height: 2000,
    };
  }, [room]);

  const [snapshot, setSnapshot] = useState<ScanSnapshot>(() => accumulator.snapshot());
  const [phase, setPhase] = useState<'scanning' | 'done'>('scanning');
  const stepRef = useRef(0);

  // Reset to a clean capture whenever the accumulator changes (mount / rescan).
  useEffect(() => {
    stepRef.current = 0;
    setSnapshot(accumulator.snapshot());
    setPhase('scanning');
  }, [accumulator]);

  // Drive the capture: one plane per tick, then the object, then finish.
  useEffect(() => {
    if (phase !== 'scanning') return;
    const id = setTimeout(() => {
      const i = stepRef.current;
      if (i < planes.length) {
        setSnapshot(accumulator.addPlane(planes[i]));
      } else if (i === planes.length) {
        setSnapshot(accumulator.addObject(object));
      } else {
        const { snapshot: done } = accumulator.finish();
        setSnapshot(done);
        setPhase('done');
        return;
      }
      stepRef.current += 1;
    }, STEP_MS);
    return () => clearTimeout(id);
  }, [phase, snapshot, accumulator, planes, object]);

  const goToPlanning = () => {
    const { geometry } = accumulator.finish();
    applyRoomGeometry(geometry);
    onClose();
  };

  const b = roomBounds(room);
  const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * MM_TO_M;
  const cx = ((b.minX + b.maxX) / 2) * MM_TO_M;
  const cz = ((b.minZ + b.maxZ) / 2) * MM_TO_M;

  const caption =
    phase === 'done'
      ? 'Scan complete'
      : stepRef.current === 0
        ? 'Point camera at the bottom edge of a wall'
        : `Capturing walls — ${snapshot.planeCount} detected`;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0b0b0d]">
      <div className="relative flex-1">
        <Canvas
          shadows
          dpr={[1, 2]}
          camera={{ position: [cx + span * 1.1, span * 0.9 + 1.2, cz + span * 1.1], fov: 45 }}
        >
          <ambientLight intensity={0.7} />
          <directionalLight position={[cx + 4, 8, cz + 4]} intensity={1.1} castShadow />
          <group scale={MM_TO_M}>
            <MassingModel model={snapshot.massing} opacity={phase === 'done' ? 1 : 0.92} />
            <ScanEdges edges={snapshot.edges} />
          </group>
          <OrbitControls
            makeDefault
            autoRotate
            autoRotateSpeed={phase === 'done' ? 0.8 : 1.6}
            enablePan={false}
            target={[cx, 1, cz]}
          />
        </Canvas>

        {/* Top bar */}
        <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-black/50 px-3 py-1.5 text-sm text-white backdrop-blur"
          >
            ✕
          </button>
          <div className="rounded-full bg-black/50 px-3 py-1.5 text-xs font-medium text-white backdrop-blur">
            LiDAR scan · {Math.round(snapshot.progress * 100)}%
          </div>
        </div>

        {/* Caption + reticle hint */}
        <div className="pointer-events-none absolute inset-x-0 top-16 flex justify-center">
          <div className="rounded-lg bg-black/55 px-4 py-2 text-center text-sm text-white backdrop-blur">
            {caption}
          </div>
        </div>
      </div>

      {/* Bottom controls */}
      <div className="space-y-3 border-t border-white/10 bg-[#0b0b0d] p-5">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-cyan-400 transition-[width] duration-300"
            style={{ width: `${Math.round(snapshot.progress * 100)}%` }}
          />
        </div>
        {phase === 'done' ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setScanKey((k) => k + 1)}
              className="flex-1 rounded-md border border-white/15 px-4 py-2.5 text-sm text-neutral-200 hover:bg-white/5"
            >
              Rescan
            </button>
            <button
              type="button"
              onClick={goToPlanning}
              className="flex-[2] rounded-md bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-neutral-950 hover:bg-cyan-400"
            >
              Go to planning →
            </button>
          </div>
        ) : (
          <p className="text-center text-xs text-neutral-500">
            Detecting walls, floor and objects… the box model builds as it scans.
          </p>
        )}
      </div>
    </div>
  );
}
