'use client';

import { LeftPanel } from './LeftPanel';
import { RightPanel } from './RightPanel';
import { StepNav } from './StepNav';

/**
 * Top-level configurator layout: step navigation bar across the top, a control
 * panel on the left, and the 3D viewport on the right.
 */
export function ConfiguratorShell() {
  return (
    <div className="flex h-dvh flex-col bg-neutral-950 text-neutral-100">
      <StepNav />
      <div className="relative flex min-h-0 flex-1">
        <LeftPanel />
        <RightPanel />
      </div>
    </div>
  );
}
