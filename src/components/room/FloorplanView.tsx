'use client';

import { useMemo } from 'react';
import {
  floorplanToSvg,
  formatArea,
  formatLength,
  roomToFloorplan,
} from '@/systems/scan/floorplan';
import { useConfiguratorStore } from '@/state/useConfiguratorStore';

const SOURCE_LABEL: Record<string, string> = {
  roomplan: 'Apple RoomPlan',
  webxr: 'AR measure',
  camera: 'Camera estimate',
  manual: 'Manual',
};

/**
 * The "2 Floorplan" panel: the dimensioned, top-down plan auto-generated from
 * the captured room. Every wall is labelled with its measured length, with floor
 * area and ceiling height — the output of the scan → floorplan pipeline. The plan
 * is rendered once by `@mozu/scan-sdk` (`floorplanToSvg`) so it's identical to
 * what the extensions and the iOS app produce.
 */
export function FloorplanView() {
  const room = useConfiguratorStore((s) => s.room);

  const floorplan = useMemo(() => roomToFloorplan(room), [room]);
  const svg = useMemo(() => floorplanToSvg(floorplan, { theme: 'dark' }), [floorplan]);

  const download = () => {
    const light = floorplanToSvg(floorplan, { theme: 'light' });
    const blob = new Blob([light], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${room.name.replace(/\s+/g, '-').toLowerCase()}-floorplan.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="relative h-full w-full bg-neutral-900">
      <div
        className="absolute inset-0 p-4 [&>svg]:h-full [&>svg]:w-full"
        // SVG is generated from numeric geometry with all text escaped — no user HTML.
        dangerouslySetInnerHTML={{ __html: svg }}
      />

      <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2">
        <span className="rounded bg-black/50 px-2 py-1 text-xs text-neutral-200 backdrop-blur">
          Floorplan · auto-measured
        </span>
        <span className="rounded bg-cyan-500/20 px-2 py-1 text-xs text-cyan-200 backdrop-blur">
          {SOURCE_LABEL[floorplan.source] ?? floorplan.source}
        </span>
      </div>

      <div className="pointer-events-none absolute bottom-20 left-1/2 flex -translate-x-1/2 gap-2 text-xs sm:bottom-24">
        <Stat label="Area" value={formatArea(floorplan.areaMm2, floorplan.unitSystem)} />
        <Stat label="Perimeter" value={formatLength(floorplan.perimeterMm, floorplan.unitSystem)} />
        <Stat label="Ceiling" value={formatLength(floorplan.height, floorplan.unitSystem)} />
        <Stat label="Walls" value={String(floorplan.walls.length)} />
        {floorplan.fixtures.length > 0 && (
          <Stat label="Fixtures" value={String(floorplan.fixtures.length)} />
        )}
      </div>

      <button
        type="button"
        onClick={download}
        className="absolute right-3 top-3 rounded-md bg-white/10 px-3 py-1.5 text-xs text-white backdrop-blur hover:bg-white/20"
      >
        ↓ Download SVG
      </button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-black/50 px-2.5 py-1.5 text-center backdrop-blur">
      <div className="text-[10px] uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="tabular-nums text-neutral-100">{value}</div>
    </div>
  );
}
