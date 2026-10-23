'use client';

import Link from 'next/link';
import { FurniturePanel } from '@/components/furniture/FurniturePanel';
import { LayoutAdvisor } from '@/components/layout/LayoutAdvisor';
import { RoomControls } from '@/components/room/RoomControls';
import { ThemePicker } from '@/components/style/ThemePicker';
import { StylePanel } from '@/components/style/StylePanel';
import { STEPS } from '@/lib/constants';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useConfiguratorStore } from '@/state/useConfiguratorStore';

/**
 * Control panel. On desktop it's a fixed column; on mobile it's a dismissible
 * overlay (toggle in the top bar, plus a backdrop and a close button) so it
 * never blocks the 3D viewport.
 */
export function LeftPanel() {
  const currentStep = useConfiguratorStore((s) => s.currentStep);
  const total = useConfiguratorStore((s) => s.pricing.total);
  const currency = useConfiguratorStore((s) => s.pricing.currency);
  const open = useConfiguratorStore((s) => s.leftPanelOpen);
  const setOpen = useConfiguratorStore((s) => s.setLeftPanelOpen);
  const step = STEPS.find((s) => s.id === currentStep) ?? STEPS[0];

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Close panel"
          onClick={() => setOpen(false)}
          className="absolute inset-0 z-10 bg-black/50 md:hidden"
        />
      )}

      <aside
        className={cn(
          'absolute inset-y-0 left-0 z-20 w-[86vw] max-w-[340px] flex-col border-r border-white/10 bg-neutral-950',
          'md:relative md:z-0 md:w-[340px] md:max-w-none md:bg-neutral-900/40',
          open ? 'flex' : 'hidden',
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-white/10 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
              {step.label}
            </h2>
            <p className="mt-1 text-sm text-neutral-500">{step.description}</p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close panel"
            className="shrink-0 rounded-md p-1 text-neutral-400 hover:bg-white/10 hover:text-white md:hidden"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {currentStep === 'review' ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-white/10 bg-neutral-900/60 p-4">
                <div className="text-xs text-neutral-500">Estimated total</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">
                  {formatMoney(total, currency)}
                </div>
              </div>
              <Link
                href="/summary"
                className="block rounded-md bg-cyan-500 px-4 py-2.5 text-center text-sm font-medium text-neutral-950 hover:bg-cyan-400"
              >
                Open quote summary →
              </Link>
              <p className="text-xs text-neutral-600">
                Itemized breakdown, shareable link, and designer handoff.
              </p>
            </div>
          ) : currentStep === 'room' ? (
            <RoomControls />
          ) : currentStep === 'layout' ? (
            <LayoutAdvisor />
          ) : currentStep === 'style' ? (
            <StylePanel />
          ) : (
            <FurniturePanel />
          )}
        </div>
      </aside>
    </>
  );
}
