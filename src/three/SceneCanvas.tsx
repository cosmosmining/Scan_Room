'use client';

import { Canvas } from '@react-three/fiber';
import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { FloorplanView } from '@/components/room/FloorplanView';
import { useConfiguratorStore } from '@/state/useConfiguratorStore';
import { PlanEditor } from '@/components/room/PlanEditor';
import { Scene } from './Scene';
import { ViewerControls } from './ViewerControls';
import { roomCenterM } from './units';

/**
 * 3D viewport host.
 *
 * Performance-first: `frameloop="demand"` (renders only on change), clamped
 * `dpr`, instanced modules, and a single shadow-casting light per preset. The
 * Canvas mounts client-side only (WebGL is not server-rendered); the 2D plan is
 * the fallback for `viewMode === '2d'` and for any device without WebGL.
 */
export function SceneCanvas() {
  const viewMode = useConfiguratorStore((s) => s.viewMode);
  const room = useConfiguratorStore((s) => s.room);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Seed a demo kitchen on first mount so the viewport shows room + modules.
  useEffect(() => {
    const s = useConfiguratorStore.getState();
    if (s.moduleTree.children.length > 0) return;
    s.addModule('base-800', { wallId: 'wall_0' });
    s.addModule('cad-base-600', { wallId: 'wall_0' }); // STEP-sourced GLB model
    s.addModule('oven-600', { wallId: 'wall_0' });
    s.addModule('closet-1000', { wallId: 'wall_1' }); // STEP-sourced GLB model
  }, []);

  const [cx, , cz] = roomCenterM(room);

  return (
    <div className="relative h-full w-full bg-neutral-900">
      {viewMode === 'floorplan' ? (
        <FloorplanView />
      ) : viewMode === '2d' ? (
        <PlanEditor />
      ) : mounted ? (
        <Canvas
          shadows
          frameloop="demand"
          dpr={[1, 2]}
          // ACES filmic + sRGB is what RealityKit tonemaps through, and it is
          // what keeps a sunlit plaster wall off pure white.
          gl={{
            antialias: true,
            powerPreference: 'high-performance',
            toneMapping: THREE.ACESFilmicToneMapping,
            toneMappingExposure: 1.05,
            outputColorSpace: THREE.SRGBColorSpace,
          }}
          camera={{ position: [cx + 3.5, 2.6, cz + 4.5], fov: 45, near: 0.1, far: 100 }}
        >
          <Scene />
        </Canvas>
      ) : (
        <div className="flex h-full w-full items-center justify-center text-sm text-neutral-500">
          Loading viewport…
        </div>
      )}

      <ViewerControls />
    </div>
  );
}
