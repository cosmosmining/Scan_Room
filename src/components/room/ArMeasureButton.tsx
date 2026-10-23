'use client';

import { useEffect, useState } from 'react';
import { floorplanSketchToRoomGeometry } from '@/systems/scan';
import { useConfiguratorStore } from '@/state/useConfiguratorStore';
import { isWebXrArSupported, runWebXrMeasure } from '@/three/ar/webxrScan';

/**
 * Real metric room capture via WebXR hit-test. Renders only where
 * `immersive-ar` is supported (Android Chrome / headset browsers) — it stays
 * hidden on iOS Safari, which has no WebXR.
 */
export function ArMeasureButton() {
  const applyRoomGeometry = useConfiguratorStore((s) => s.applyRoomGeometry);
  const unitSystem = useConfiguratorStore((s) => s.room.unitSystem);
  const [supported, setSupported] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    let active = true;
    isWebXrArSupported().then((v) => active && setSupported(v));
    return () => {
      active = false;
    };
  }, []);

  if (!supported) return null;

  const run = async () => {
    setStatus('Starting AR…');
    try {
      const result = await runWebXrMeasure();
      if (!result) {
        setStatus('Cancelled.');
        return;
      }
      applyRoomGeometry(
        floorplanSketchToRoomGeometry({
          vertices: result.vertices,
          height: result.height,
          unitSystem,
        }),
      );
      setStatus(`Measured ${result.vertices.length} corners → 3D room built.`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'AR measure failed.');
    }
  };

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={run}
        className="w-full rounded-md border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200 hover:bg-emerald-500/20"
      >
        📐 AR measure (metric · Android)
      </button>
      {status && <p className="text-xs text-neutral-500">{status}</p>}
    </div>
  );
}
