'use client';

import { useARSupport } from './useARSupport';

/**
 * Shown only when WebXR `immersive-ar` is available. Launching the immersive
 * session that renders this R3F scene in AR is wired via `@react-three/xr`
 * (createXRStore().enterAR) — deferred so the core install stays minimal. This
 * button is the integration seam + capability gate.
 */
export function ARButton() {
  const supported = useARSupport();
  if (!supported) return null;

  return (
    <button
      type="button"
      onClick={() => {
        // Seam: const store = createXRStore(); store.enterAR();
        console.info('[MOZU] WebXR immersive-ar supported — AR session wires in via @react-three/xr.');
      }}
      className="rounded-md bg-cyan-500/90 px-3 py-1.5 text-xs font-medium text-neutral-950 hover:bg-cyan-400"
    >
      View in AR
    </button>
  );
}
