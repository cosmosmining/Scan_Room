'use client';

import { useState } from 'react';
import { manualDimensionsToRoomGeometry } from '@/systems/scan';
import { useConfiguratorStore } from '@/state/useConfiguratorStore';
import { ArMeasureButton } from './ArMeasureButton';
import { CameraScan } from './CameraScan';
import { FloorplanScanner } from './FloorplanScanner';
import { LidarScan } from './LidarScan';

type Mode = 'none' | 'camera' | 'floorplan' | 'lidar';

/**
 * Room capture. Three paths, all emitting the same `RoomGeometry`:
 *  • manual W/D/H,
 *  • camera viewfinder (visual reference + manual measure),
 *  • floorplan trace (tap corners → real 3D room of any shape).
 *
 * True LiDAR/AR 3D scanning is NOT possible in iOS Safari (no WebXR) — that
 * needs a native app. These are the honest web-capable approximations.
 */
export function RoomControls() {
  const room = useConfiguratorStore((s) => s.room);
  const applyRoomGeometry = useConfiguratorStore((s) => s.applyRoomGeometry);
  const setRoom = useConfiguratorStore((s) => s.setRoom);
  const regenerateLayout = useConfiguratorStore((s) => s.regenerateLayout);

  const xs = room.footprint.map((p) => p.x);
  const zs = room.footprint.map((p) => p.z);
  const currentWidth = Math.round(Math.max(...xs) - Math.min(...xs));
  const currentDepth = Math.round(Math.max(...zs) - Math.min(...zs));
  const [width, setWidth] = useState(currentWidth);
  const [depth, setDepth] = useState(currentDepth);
  const [height, setHeight] = useState(room.height);
  const [mode, setMode] = useState<Mode>('none');

  const apply = () => {
    // Only the height changed: change only the height. Replacing the room with
    // a fresh width × depth box threw away a scanned room's real shape — and,
    // with it, the furniture and columns measured inside that shape — for what
    // was only ever meant to be a taller ceiling.
    if (width === currentWidth && depth === currentDepth) {
      setRoom({ ...room, height, walls: room.walls.map((w) => ({ ...w, height })) });
      regenerateLayout();
      return;
    }
    applyRoomGeometry(
      manualDimensionsToRoomGeometry({ width, depth, height, unitSystem: room.unitSystem }),
    );
  };

  const fields = (compact: boolean) => (
    <div className={compact ? 'grid grid-cols-3 gap-2' : 'space-y-3'}>
      <DimField label="Width" value={width} onChange={setWidth} compact={compact} />
      <DimField label="Depth" value={depth} onChange={setDepth} compact={compact} />
      <DimField label="Height" value={height} onChange={setHeight} compact={compact} />
    </div>
  );

  return (
    <div className="space-y-4">
      <p className="text-xs text-neutral-500">
        Scan your room, or enter dimensions. The LiDAR scan builds a box model of
        your space (it replays without a depth sensor, so it works on any device).
      </p>

      <button
        type="button"
        onClick={() => setMode('lidar')}
        className="flex w-full items-center justify-center gap-2 rounded-md bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-neutral-950 hover:bg-cyan-400"
      >
        ◳ Scan room (LiDAR)
      </button>

      {fields(false)}

      <button
        type="button"
        onClick={apply}
        className="w-full rounded-md border border-white/15 px-4 py-2 text-sm font-medium text-neutral-200 hover:bg-white/5"
      >
        Apply dimensions
      </button>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setMode('camera')}
          className="rounded-md border border-white/15 px-3 py-2 text-sm text-neutral-200 hover:bg-white/5"
        >
          📷 Camera
        </button>
        <button
          type="button"
          onClick={() => setMode('floorplan')}
          className="rounded-md border border-white/15 px-3 py-2 text-sm text-neutral-200 hover:bg-white/5"
        >
          ✏️ Trace plan
        </button>
      </div>

      <ArMeasureButton />

      {mode === 'camera' && (
        <CameraScan
          onClose={() => setMode('none')}
          onEstimate={(e) => {
            setWidth(e.width);
            setDepth(e.depth);
            setHeight(e.height);
          }}
        >
          <div className="space-y-3">
            {fields(true)}
            <button
              type="button"
              onClick={() => {
                apply();
                setMode('none');
              }}
              className="w-full rounded-md bg-cyan-500 px-4 py-2 text-sm font-medium text-neutral-950"
            >
              Use these dimensions
            </button>
          </div>
        </CameraScan>
      )}

      {mode === 'floorplan' && <FloorplanScanner onClose={() => setMode('none')} />}
      {mode === 'lidar' && <LidarScan onClose={() => setMode('none')} />}
    </div>
  );
}

function DimField({
  label,
  value,
  onChange,
  compact,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  compact: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-neutral-400">
        {label}
        {!compact && ' (mm)'}
      </span>
      <input
        type="number"
        inputMode="numeric"
        min={500}
        max={12000}
        step={50}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-cyan-400/50"
      />
    </label>
  );
}
