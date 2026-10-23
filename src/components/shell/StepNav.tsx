'use client';

import { APP_NAME, STEPS } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { useConfiguratorStore } from '@/state/useConfiguratorStore';

export function StepNav() {
  const currentStep = useConfiguratorStore((s) => s.currentStep);
  const setStep = useConfiguratorStore((s) => s.setStep);
  const nextStep = useConfiguratorStore((s) => s.nextStep);
  const prevStep = useConfiguratorStore((s) => s.prevStep);
  const leftPanelOpen = useConfiguratorStore((s) => s.leftPanelOpen);
  const toggleLeftPanel = useConfiguratorStore((s) => s.toggleLeftPanel);

  const activeIndex = STEPS.findIndex((s) => s.id === currentStep);

  return (
    <header className="flex items-center gap-3 border-b border-white/10 bg-neutral-900/60 px-3 py-3 backdrop-blur sm:gap-6 sm:px-6">
      <button
        type="button"
        onClick={toggleLeftPanel}
        aria-label={leftPanelOpen ? 'Hide panel' : 'Show panel'}
        aria-pressed={leftPanelOpen}
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/10 text-neutral-300 transition hover:bg-white/10',
          leftPanelOpen && 'bg-white/10 text-white',
        )}
      >
        <span className="text-base leading-none">☰</span>
      </button>
      <div className="flex items-baseline gap-2">
        <span className="text-lg font-semibold tracking-tight">{APP_NAME}</span>
        <span className="hidden text-xs text-neutral-400 sm:inline">
          Configurator
        </span>
      </div>

      <nav className="flex flex-1 items-center justify-center gap-1">
        {STEPS.map((step, i) => {
          const isActive = step.id === currentStep;
          const isDone = i < activeIndex;
          return (
            <button
              key={step.id}
              type="button"
              onClick={() => setStep(step.id)}
              className={cn(
                'flex items-center gap-2 rounded-full px-3 py-1.5 text-sm transition',
                isActive
                  ? 'bg-white text-neutral-900'
                  : 'text-neutral-400 hover:text-neutral-100',
              )}
            >
              <span
                className={cn(
                  'flex h-5 w-5 items-center justify-center rounded-full text-xs',
                  isActive
                    ? 'bg-neutral-900 text-white'
                    : isDone
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-white/10 text-neutral-300',
                )}
              >
                {i + 1}
              </span>
              <span className="hidden md:inline">{step.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={prevStep}
          disabled={activeIndex === 0}
          className="rounded-md px-3 py-1.5 text-sm text-neutral-300 transition hover:bg-white/5 disabled:opacity-30"
        >
          Back
        </button>
        <button
          type="button"
          onClick={nextStep}
          disabled={activeIndex === STEPS.length - 1}
          className="rounded-md bg-white px-4 py-1.5 text-sm font-medium text-neutral-900 transition hover:bg-neutral-200 disabled:opacity-30"
        >
          Next
        </button>
      </div>
    </header>
  );
}
