'use client';

import dynamic from 'next/dynamic';
import { useEffect } from 'react';
import { FloorplanView } from '@/components/room/FloorplanView';
import { useConfiguratorStore } from '@/state/useConfiguratorStore';
import { PlanEditor } from '@/components/room/PlanEditor';
import { ViewerControls } from './ViewerControls';
import { roomCenterM } from './units';

/**
 * three.js and the scene, fetched the first time the 3D view is shown and
 * never rendered on the server (there is no WebGL there).
 */
const Viewport3D = dynamic(() => import('./Viewport3D'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-sm text-neutral-500">
      Loading viewport…
    </div>
  ),
});

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
      ) : (
        <Viewport3D cx={cx} cz={cz} />
      )}

      <ViewerControls />
    </div>
  );
}
