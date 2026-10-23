'use client';

import { useState, type PointerEvent } from 'react';
import { floorplanSketchToRoomGeometry } from '@/systems/scan';
import { useConfiguratorStore } from '@/state/useConfiguratorStore';

interface Pt {
  x: number;
  z: number;
}

/**
 * Tap-to-trace floorplan capture. You tap the room's corners (top-down); the
 * traced polygon is scaled so its overall width matches the number you enter,
 * then built into a real 3D room of that exact shape (L / U / anything) via
 * `floorplanSketchToRoomGeometry`. The closest honest "room capture" the web
 * allows on iPhone — no LiDAR/WebXR involved.
 */
export function FloorplanScanner({ onClose }: { onClose: () => void }) {
  const applyRoomGeometry = useConfiguratorStore((s) => s.applyRoomGeometry);
  const unitSystem = useConfiguratorStore((s) => s.room.unitSystem);

  const [pts, setPts] = useState<Pt[]>([]);
  const [widthMm, setWidthMm] = useState(4000);
  const [height, setHeight] = useState(2700);

  const addPoint = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setPts((p) => [...p, { x: e.clientX - r.left, z: e.clientY - r.top }]);
  };

  const build = () => {
    if (pts.length < 3) return;
    const xs = pts.map((p) => p.x);
    const zs = pts.map((p) => p.z);
    const spanX = Math.max(...xs) - Math.min(...xs) || 1;
    const scale = widthMm / spanX; // width sets the real-world scale
    const minX = Math.min(...xs);
    const minZ = Math.min(...zs);
    const vertices = pts.map((p) => ({
      x: Math.round((p.x - minX) * scale),
      z: Math.round((p.z - minZ) * scale),
    }));
    applyRoomGeometry(floorplanSketchToRoomGeometry({ vertices, height, unitSystem }));
    onClose();
  };

  const poly = pts.map((p) => `${p.x},${p.z}`).join(' ');
  const first = pts[0];
  const last = pts[pts.length - 1];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-950">
      <div className="flex items-center justify-between p-4">
        <p className="text-sm text-neutral-200">Tap your room’s corners</p>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-md bg-white/10 px-3 py-1.5 text-sm text-white">
          ✕
        </button>
      </div>

      <svg
        onPointerDown={addPoint}
        className="flex-1 touch-none"
        style={{
          backgroundColor: '#0a0a0a',
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.07) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      >
        {pts.length > 1 && (
          <polyline points={poly} fill="rgba(34,211,238,0.12)" stroke="#22d3ee" strokeWidth={3} />
        )}
        {pts.length > 2 && first && last && (
          <line x1={last.x} y1={last.z} x2={first.x} y2={first.z} stroke="#22d3ee" strokeWidth={2} strokeDasharray="7 7" />
        )}
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.z} r={8} fill="#22d3ee" stroke="#0a0a0a" strokeWidth={2} />
        ))}
      </svg>

      <div className="space-y-3 border-t border-white/10 p-4">
        <div className="grid grid-cols-2 gap-2">
          <Num label="Room width (mm)" value={widthMm} onChange={setWidthMm} />
          <Num label="Ceiling (mm)" value={height} onChange={setHeight} />
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setPts((p) => p.slice(0, -1))}
            disabled={pts.length === 0}
            className="rounded-md border border-white/15 px-3 py-2 text-sm text-neutral-200 disabled:opacity-30"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={() => setPts([])}
            disabled={pts.length === 0}
            className="rounded-md border border-white/15 px-3 py-2 text-sm text-neutral-200 disabled:opacity-30"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={build}
            disabled={pts.length < 3}
            className="flex-1 rounded-md bg-cyan-500 px-3 py-2 text-sm font-medium text-neutral-950 hover:bg-cyan-400 disabled:opacity-30"
          >
            Build 3D room ({pts.length})
          </button>
        </div>
        <p className="text-xs text-neutral-500">
          Width sets the scale; the shape comes from your trace. A true LiDAR scan
          needs a native app — it isn’t possible in a browser on iPhone.
        </p>
      </div>
    </div>
  );
}

function Num({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-neutral-400">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={500}
        max={20000}
        step={50}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-cyan-400/50"
      />
    </label>
  );
}
