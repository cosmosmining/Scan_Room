'use client';

import { useEffect, useState } from 'react';
import { scanFromParams } from '@mozu/scan-sdk';
import { ConfiguratorShell } from '@/components/shell/ConfiguratorShell';
import { scanToGeometry } from '@/systems/scan/scanToGeometry';
import { useConfiguratorStore } from '@/state/useConfiguratorStore';
import { ScanCodeEntry } from './ScanCodeEntry';

/**
 * Ingest a room measured by a native companion (Apple RoomPlan / ARCore) or a
 * browser extension, then drop into the configurator on that room — landing on
 * its auto-generated floorplan.
 *
 *   /scan?w=4000&d=3000&h=2700                          ← rectangle (mm)
 *   /scan?poly=0,0;4000,0;4000,3000;0,3000&h=2700       ← polygon (mm, x,z;…)
 *   /scan?poly=…&h=…&scan=<base64>                       ← + openings/objects
 *   /scan/B7K4M2                                        ← handoff code
 *
 * Arriving with no scan at all is the common case for someone who scanned on an
 * iPad and is now sitting at a laptop, so that lands on the code entry rather
 * than silently opening a default room they did not ask for.
 */
export function ScanIngest() {
  const applyRoomGeometry = useConfiguratorStore((s) => s.applyRoomGeometry);
  const [state, setState] = useState<'loading' | 'ready' | 'needsCode'>('loading');

  useEffect(() => {
    try {
      const scan = scanFromParams(window.location.search);
      if (scan) {
        applyRoomGeometry(scanToGeometry(scan));
        setState('ready');
        return;
      }
    } catch {
      /* fall through to the code entry */
    }
    setState('needsCode');
  }, [applyRoomGeometry]);

  if (state === 'loading') {
    return (
      <div className="flex h-dvh items-center justify-center bg-neutral-950 text-neutral-400">
        Loading scanned room…
      </div>
    );
  }
  if (state === 'needsCode') return <ScanCodeEntry />;
  return <ConfiguratorShell />;
}
