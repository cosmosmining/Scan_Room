import { useConfiguratorStore } from '@/state/useConfiguratorStore';
import { roomBounds } from './units';

const FALLBACK_COLOR = '#c9c7c2';
const PAD = 400; // mm padding around the plan

/**
 * 2D top-down fallback. Pure SVG (no WebGL, no AR) — the universal view for
 * devices that can't run the 3D scene, and a useful plan view in its own right.
 * The viewBox is in millimetres, so everything draws at real coordinates.
 */
export function Plan2D() {
  const room = useConfiguratorStore((s) => s.room);
  const instances = useConfiguratorStore((s) => s.instances);
  const catalog = useConfiguratorStore((s) => s.catalog);
  const showAvatar = useConfiguratorStore((s) => s.showAvatar);

  const b = roomBounds(room);
  const viewBox = `${b.minX - PAD} ${b.minZ - PAD} ${b.maxX - b.minX + 2 * PAD} ${b.maxZ - b.minZ + 2 * PAD}`;
  const footprint = room.footprint.map((p) => `${p.x},${p.z}`).join(' ');

  return (
    <div className="relative h-full w-full bg-neutral-900">
      <svg viewBox={viewBox} className="h-full w-full" preserveAspectRatio="xMidYMid meet">
        <polygon points={footprint} fill="#161618" stroke="#3f3f46" strokeWidth={40} />

        {instances.map((inst) => {
          const def = catalog.definitions[inst.definitionId];
          if (!def) return null;
          const w = inst.width ?? def.dimensions.width;
          const d = def.dimensions.depth;
          const deg = (-inst.rotationY * 180) / Math.PI;
          const color =
            (inst.finishId && catalog.materials[inst.finishId]?.albedo) ||
            FALLBACK_COLOR;
          return (
            <g
              key={inst.id}
              transform={`translate(${inst.position.x} ${inst.position.z}) rotate(${deg})`}
            >
              <rect
                x={-w / 2}
                y={-d / 2}
                width={w}
                height={d}
                fill={color}
                stroke="#0a0a0a"
                strokeWidth={12}
              />
            </g>
          );
        })}

        {showAvatar && <circle cx={900} cy={2300} r={170} fill="#5b6472" />}
      </svg>
      <span className="absolute left-3 top-3 rounded bg-black/50 px-2 py-1 text-xs text-neutral-300">
        2D plan
      </span>
    </div>
  );
}
