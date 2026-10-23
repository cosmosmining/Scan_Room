'use client';

import { useState } from 'react';
import {
  MATERIAL_KINDS,
  SWATCHES,
  SWATCH_CATEGORIES,
  materialKind,
  swatchById,
  swatchesIn,
  type FinishTarget,
  type MaterialKind,
  type SurfaceFinish,
  type SwatchCategory,
} from '@/systems/aesthetic/finishes';

/**
 * The finish editor — the web twin of the iPad's "Change Colour" sheet.
 *
 * Same four controls in the same order, because they are the four decisions:
 * WHAT you are finishing (an item, or the walls, floor, ceiling), WHICH swatch
 * from which category, HOW the surface behaves (matte through mirror), and how
 * the texture sits on it (scale and rotation).
 *
 * The swatch list is generated from the iPad's own table, so Walnut 02 here is
 * Walnut 02 there. A finish library that drifts between devices produces two
 * different quotes for the same kitchen, which is the kind of bug that is only
 * discovered by a customer.
 */

const TARGETS: { kind: FinishTarget['kind']; label: string; icon: string }[] = [
  { kind: 'item', label: 'Selected', icon: '◧' },
  { kind: 'wall', label: 'Walls', icon: '▤' },
  { kind: 'floor', label: 'Floor', icon: '▬' },
  { kind: 'ceiling', label: 'Ceiling', icon: '▔' },
];

export function MaterialEditor({
  finish,
  onChange,
  target,
  onTargetChange,
  hasSelection = false,
  selectionId = null,
  targetName = null,
  initialCategory,
}: {
  finish: SurfaceFinish;
  onChange: (finish: SurfaceFinish) => void;
  target: FinishTarget;
  onTargetChange: (target: FinishTarget) => void;
  /** Whether an item is selected — "Selected" is meaningless without one. */
  hasSelection?: boolean;
  /** Which item, so "Selected" targets the one actually selected. */
  selectionId?: string | null;
  /** What that item is called, so the editor can say what it will recolour. */
  targetName?: string | null;
  /** Which swatch category to open on, when the target has no finish yet. */
  initialCategory?: SwatchCategory;
}) {
  // Open on the current finish's category — unless nothing has been chosen yet,
  // in which case honouring the fallback lands you on Finishes, whose single
  // plaster swatch reads as an empty grid rather than a colour picker.
  const [category, setCategory] = useState<SwatchCategory>(
    initialCategory ?? swatchById(finish.swatchId)?.category ?? 'wood',
  );
  const swatches = swatchesIn(category);
  const active = swatchById(finish.swatchId);

  return (
    <div className="flex flex-col gap-5 text-sm">
      {/* 1 — what am I finishing? */}
      <section>
        <h3 className="mb-2 text-xs uppercase tracking-wider text-neutral-500">Apply to</h3>
        <div className="flex flex-wrap gap-2">
          {TARGETS.map((t) => {
            const isItem = t.kind === 'item';
            const selected = target.kind === t.kind;
            return (
              <button
                key={t.label}
                type="button"
                disabled={isItem && !hasSelection}
                onClick={() =>
                  onTargetChange(
                    isItem ? { kind: 'item', id: selectionId ?? '' } : { kind: t.kind } as FinishTarget,
                  )
                }
                className={`rounded-lg border px-3 py-2 text-xs disabled:opacity-35 ${
                  selected ? 'border-sky-400 bg-sky-400/10 text-sky-200' : 'border-white/15 text-neutral-300'
                }`}
              >
                <span className="mr-1.5">{t.icon}</span>
                {t.label}
              </button>
            );
          })}
        </div>
        {/* Say what a swatch tap will change. The editor applies live — there is
            no Apply button here and none on the iPad either — so the one thing
            it owes you is a plain statement of what it is about to recolour. */}
        <p className="mt-2 text-xs text-neutral-500">
          {target.kind === 'item'
            ? hasSelection
              ? `Tap a swatch — it applies to ${targetName ?? 'the selected unit'} straight away.`
              : 'Nothing selected. Tap a unit on the plan or in 3D, then come back — or finish the walls, floor or ceiling instead.'
            : `Tap a swatch — it applies to the ${target.kind} straight away.`}
        </p>
      </section>

      {/* 2 — which swatch? */}
      <section>
        <h3 className="mb-2 text-xs uppercase tracking-wider text-neutral-500">
          Finish{active ? ` · ${active.name}` : ''}
        </h3>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {SWATCH_CATEGORIES.filter((c) => swatchesIn(c).length > 0).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={`rounded-full px-3 py-1 text-xs capitalize ${
                c === category ? 'bg-white text-neutral-950' : 'bg-white/10 text-neutral-300'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-6 gap-2">
          {swatches.map((s) => (
            <button
              key={s.id}
              type="button"
              title={s.name}
              onClick={() => onChange({ ...finish, swatchId: s.id })}
              className={`aspect-square rounded-md border-2 ${
                s.id === finish.swatchId ? 'border-sky-400' : 'border-transparent'
              }`}
              style={{ background: s.color }}
            />
          ))}
        </div>
      </section>

      {/* 3 — how does the surface behave? */}
      <section>
        <h3 className="mb-2 text-xs uppercase tracking-wider text-neutral-500">Material</h3>
        <div className="flex flex-wrap gap-1.5">
          {MATERIAL_KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              onClick={() => onChange({ ...finish, kind: k.id as MaterialKind })}
              className={`rounded-full px-3 py-1 text-xs ${
                k.id === finish.kind ? 'bg-white text-neutral-950' : 'bg-white/10 text-neutral-300'
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          roughness {materialKind(finish.kind).roughness} · metalness{' '}
          {materialKind(finish.kind).metalness}
          {materialKind(finish.kind).opacity < 1 ? ' · translucent' : ''}
        </p>
      </section>

      {/* 4 — how does the texture sit on it? */}
      <section className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="flex justify-between text-xs text-neutral-400">
            <span>Texture scale</span>
            <span className="tabular-nums">{finish.textureScale.toFixed(2)}×</span>
          </span>
          <input
            type="range"
            min={0.25}
            max={4}
            step={0.05}
            value={finish.textureScale}
            onChange={(e) => onChange({ ...finish, textureScale: Number(e.target.value) })}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="flex justify-between text-xs text-neutral-400">
            <span>Rotation</span>
            <span className="tabular-nums">
              {Math.round((finish.rotation * 180) / Math.PI)}°
            </span>
          </span>
          <input
            type="range"
            min={0}
            max={Math.PI * 2}
            step={0.01}
            value={finish.rotation}
            onChange={(e) => onChange({ ...finish, rotation: Number(e.target.value) })}
          />
        </label>
        <label className="flex items-center gap-3">
          <span className="text-xs text-neutral-400">Tint</span>
          <input
            type="color"
            value={finish.tint ?? active?.color ?? '#ffffff'}
            onChange={(e) => onChange({ ...finish, tint: e.target.value })}
            className="h-7 w-12 rounded border border-white/15 bg-transparent"
          />
          {finish.tint && (
            <button
              type="button"
              onClick={() => onChange({ ...finish, tint: undefined })}
              className="text-xs text-neutral-400 underline"
            >
              clear
            </button>
          )}
        </label>
      </section>

      <p className="text-xs text-neutral-500">
        {SWATCHES.length} finishes, shared with the MOZU iPad app.
      </p>
    </div>
  );
}
