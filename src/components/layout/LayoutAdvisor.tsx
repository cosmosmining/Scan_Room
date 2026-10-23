'use client';

import { useMemo } from 'react';
import type { LayoutType } from '@/lib/types';
import { recommendLayouts, type LayoutRecommendation, type LayoutShape } from '@/systems/ai';
import { useConfiguratorStore } from '@/state/useConfiguratorStore';

/**
 * Phase 2 surfaced: AI-generated layout suggestions — the "Kitchen Sets" with a
 * RECOMMENDED badge and the "Need advice" answer. Each card is a ready-to-use
 * set the user can drop in with one tap, then modify in the module step.
 */
const SHAPE_TO_LAYOUT: Record<LayoutShape, LayoutType> = {
  'single-wall': 'straight',
  galley: 'galley',
  'l-shaped': 'l-shaped',
  'u-shaped': 'u-shaped',
};

export function LayoutAdvisor() {
  const room = useConfiguratorStore((s) => s.room);
  const catalog = useConfiguratorStore((s) => s.catalog);
  const domain = useConfiguratorStore((s) => s.domain);
  const applyPlannedModules = useConfiguratorStore((s) => s.applyPlannedModules);
  const setLayoutType = useConfiguratorStore((s) => s.setLayoutType);
  const setStep = useConfiguratorStore((s) => s.setStep);

  const recommendations = useMemo(
    () => recommendLayouts(room, catalog, { domain }),
    [room, catalog, domain],
  );

  const apply = (rec: LayoutRecommendation) => {
    applyPlannedModules(rec.modules);
    setLayoutType(SHAPE_TO_LAYOUT[rec.shape]);
    setStep('modules');
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-cyan-400/20 bg-cyan-400/5 p-3">
        <p className="text-sm font-medium text-cyan-200">AI layout suggestions</p>
        <p className="mt-1 text-xs text-neutral-400">
          Generated from your scanned boundary. Tap a set to drop it in — then add,
          remove or swap units in the next step.
        </p>
      </div>

      {recommendations.length === 0 ? (
        <p className="text-sm text-neutral-500">
          No layout fits this room yet — capture or enlarge the space first.
        </p>
      ) : (
        recommendations.map((rec) => (
          <RecommendationCard key={rec.id} rec={rec} onApply={() => apply(rec)} />
        ))
      )}
    </div>
  );
}

function RecommendationCard({
  rec,
  onApply,
}: {
  rec: LayoutRecommendation;
  onApply: () => void;
}) {
  const errors = rec.result.violations.filter((v) => v.severity === 'error').length;
  return (
    <div className="rounded-lg border border-white/10 bg-neutral-900/60 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-neutral-100">{rec.name}</h3>
        {rec.recommended && (
          <span className="rounded-full bg-cyan-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-300">
            Recommended
          </span>
        )}
      </div>

      <p className="mt-1.5 text-xs leading-relaxed text-neutral-400">{rec.rationale}</p>

      <div className="mt-3 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-cyan-400"
            style={{ width: `${Math.round(rec.score * 100)}%` }}
          />
        </div>
        <span className="text-[10px] tabular-nums text-neutral-500">
          {Math.round(rec.score * 100)}% fit
        </span>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span className="text-[11px] text-neutral-500">
          {rec.result.instances.length} units
          {errors > 0 && <span className="text-amber-400"> · {errors} to review</span>}
        </span>
        <button
          type="button"
          onClick={onApply}
          className="rounded-md bg-cyan-500 px-3 py-1.5 text-xs font-medium text-neutral-950 hover:bg-cyan-400"
        >
          Use this set →
        </button>
      </div>
    </div>
  );
}
