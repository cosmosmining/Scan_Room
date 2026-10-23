'use client';

import { useEffect, useState } from 'react';
import { parseScan } from '@mozu/scan-sdk';
import { ConfiguratorShell } from '@/components/shell/ConfiguratorShell';
import { ScanCodeEntry } from '@/components/scan/ScanCodeEntry';
import { scanToGeometry } from '@/systems/scan/scanToGeometry';
import { useConfiguratorStore } from '@/state/useConfiguratorStore';

/**
 * Fetch a scan by its handoff code and open the configurator on that room.
 *
 * A failure here falls back to the code entry rather than an error page, because
 * the most likely reason to be looking at this screen with a bad code is a typo
 * or an expired one — and in both cases the useful next thing on screen is a box
 * to type a new code into, not an apology.
 */
export function ScanCodeLoader({ code }: { code: string }) {
  const applyRoomGeometry = useConfiguratorStore((s) => s.applyRoomGeometry);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/scan-handoff?code=${encodeURIComponent(code)}`);
        if (!res.ok) throw new Error('not found');
        const { scan } = (await res.json()) as { scan: unknown };
        const parsed = parseScan(JSON.stringify(scan));
        if (!parsed) throw new Error('unreadable');
        if (cancelled) return;
        applyRoomGeometry(scanToGeometry(parsed));
        setState('ready');
      } catch {
        if (!cancelled) setState('failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, applyRoomGeometry]);

  if (state === 'loading') {
    return (
      <div className="flex h-dvh items-center justify-center bg-neutral-950 text-neutral-400">
        Opening room {code.toUpperCase()}…
      </div>
    );
  }
  if (state === 'failed') return <ScanCodeEntry />;
  return <ConfiguratorShell />;
}
