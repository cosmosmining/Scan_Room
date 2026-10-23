'use client';

import { useConfiguratorStore } from '@/state/useConfiguratorStore';
import { SceneCanvas } from '@/three/SceneCanvas';

/**
 * Hosts the 3D viewport plus a lightweight HUD that reflects live store state,
 * proving the state → view wiring end to end.
 */
export function RightPanel() {
  const domain = useConfiguratorStore((s) => s.domain);
  const layoutType = useConfiguratorStore((s) => s.layoutType);
  const moduleCount = useConfiguratorStore((s) => s.instances.length);
  const viewMode = useConfiguratorStore((s) => s.viewMode);

  return (
    <main className="relative min-w-0 flex-1">
      <SceneCanvas />
      {/* A 3D-viewport HUD. The 2D plan has its own toolbar in the same corner,
          and two bars stacked on each other are less readable than either. */}
      <div
        className={`pointer-events-none absolute left-4 top-4 gap-2 text-xs ${
          viewMode === '3d' ? 'flex' : 'hidden'
        }`}
      >
        <span className="rounded-md bg-black/40 px-2 py-1 capitalize text-neutral-200 backdrop-blur">
          {domain}
        </span>
        <span className="rounded-md bg-black/40 px-2 py-1 capitalize text-neutral-200 backdrop-blur">
          {layoutType.replace('-', ' ')}
        </span>
        <span className="rounded-md bg-black/40 px-2 py-1 text-neutral-200 backdrop-blur">
          {moduleCount} modules
        </span>
      </div>
    </main>
  );
}
