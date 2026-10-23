'use client';

import type { LightingPreset, ViewMode } from '@/state/types';
import { AVATAR_MAX_CM, AVATAR_MIN_CM } from '@/state/slices/viewerSlice';
import { useConfiguratorStore } from '@/state/useConfiguratorStore';
import { cn } from '@/lib/utils';
import { ARButton } from './ar/ARButton';

const LIGHTING: LightingPreset[] = ['studio', 'daylight', 'evening'];

export function ViewerControls() {
  const lightingPreset = useConfiguratorStore((s) => s.lightingPreset);
  const setLightingPreset = useConfiguratorStore((s) => s.setLightingPreset);
  const avatarHeight = useConfiguratorStore((s) => s.avatarHeight);
  const setAvatarHeight = useConfiguratorStore((s) => s.setAvatarHeight);
  const showAvatar = useConfiguratorStore((s) => s.showAvatar);
  const toggleAvatar = useConfiguratorStore((s) => s.toggleAvatar);
  const showSnapGuides = useConfiguratorStore((s) => s.showSnapGuides);
  const toggleSnapGuides = useConfiguratorStore((s) => s.toggleSnapGuides);
  const viewMode = useConfiguratorStore((s) => s.viewMode);
  const setViewMode = useConfiguratorStore((s) => s.setViewMode);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-4">
      <div className="pointer-events-auto flex flex-wrap items-center gap-4 rounded-xl border border-white/10 bg-neutral-900/80 px-4 py-3 text-xs text-neutral-200 backdrop-blur">
        {/* View mode */}
        <Segmented
          options={[
            { value: '3d', label: '3D' },
            { value: '2d', label: '2D' },
            { value: 'floorplan', label: 'Plan' },
          ]}
          value={viewMode}
          onChange={(v) => setViewMode(v as ViewMode)}
        />

        {/* Lighting */}
        <Segmented
          options={LIGHTING.map((p) => ({ value: p, label: p }))}
          value={lightingPreset}
          onChange={(v) => setLightingPreset(v as LightingPreset)}
          disabled={viewMode !== '3d'}
        />

        {/* Avatar height slider */}
        <label className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleAvatar}
            className={cn('rounded px-2 py-1', showAvatar ? 'bg-white/15' : 'bg-white/5 text-neutral-500')}
          >
            Avatar
          </button>
          <input
            type="range"
            min={AVATAR_MIN_CM}
            max={AVATAR_MAX_CM}
            value={avatarHeight}
            onChange={(e) => setAvatarHeight(Number(e.target.value))}
            className="w-28 accent-cyan-400"
          />
          <span className="w-12 tabular-nums text-neutral-400">{avatarHeight}cm</span>
        </label>

        {/* Snap guides */}
        <button
          type="button"
          onClick={toggleSnapGuides}
          disabled={viewMode !== '3d'}
          className={cn(
            'rounded px-2 py-1 disabled:opacity-30',
            showSnapGuides ? 'bg-cyan-500/20 text-cyan-300' : 'bg-white/5',
          )}
        >
          Snap guides
        </button>

        <ChangeColourButton />
        <ARButton />
      </div>
    </div>
  );
}

/**
 * The iPad's bottom-bar "Change Colour", in the same place: next to whatever you
 * just tapped. It appears only with something selected, because a recolour with
 * no target is the state people read as the button being broken.
 */
function ChangeColourButton() {
  const furniture = useConfiguratorStore((s) => s.designSelection);
  const module = useConfiguratorStore((s) => s.selectedNodeId);
  const setFinishTarget = useConfiguratorStore((s) => s.setFinishTarget);
  const setStep = useConfiguratorStore((s) => s.setStep);
  const id = furniture ?? module;
  if (!id) return null;

  return (
    <button
      type="button"
      onClick={() => {
        setFinishTarget({ kind: 'item', id });
        setStep('style');
      }}
      // Accent, not another grey chip in a row of grey chips. This is the one
      // control here that acts on the thing you just selected, and it has been
      // missed twice sitting at the same weight as "Snap guides".
      className="rounded bg-cyan-500 px-2.5 py-1 font-medium text-neutral-950 hover:bg-cyan-400"
    >
      Change colour
    </button>
  );
}

interface Option {
  value: string;
  label: string;
}

function Segmented({
  options,
  value,
  onChange,
  disabled,
}: {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className={cn('flex overflow-hidden rounded-md border border-white/10', disabled && 'opacity-30')}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            'px-2.5 py-1 capitalize',
            value === o.value ? 'bg-white text-neutral-900' : 'text-neutral-300 hover:bg-white/5',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
