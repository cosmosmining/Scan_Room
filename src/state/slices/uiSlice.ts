import type { StateCreator } from 'zustand';
import { STEPS } from '@/lib/constants';
import type { ConfiguratorState, UiSlice } from '@/state/types';

export const createUiSlice: StateCreator<ConfiguratorState, [], [], UiSlice> = (
  set,
) => ({
  currentStep: 'room',
  selectedNodeId: null,
  leftPanelOpen: true,
  setStep: (step) => set({ currentStep: step }),
  nextStep: () =>
    set((s) => {
      const i = STEPS.findIndex((step) => step.id === s.currentStep);
      return { currentStep: STEPS[Math.min(i + 1, STEPS.length - 1)].id };
    }),
  prevStep: () =>
    set((s) => {
      const i = STEPS.findIndex((step) => step.id === s.currentStep);
      return { currentStep: STEPS[Math.max(i - 1, 0)].id };
    }),
  selectNode: (id) => set({ selectedNodeId: id }),
  toggleLeftPanel: () => set((s) => ({ leftPanelOpen: !s.leftPanelOpen })),
  setLeftPanelOpen: (open) => set({ leftPanelOpen: open }),
});
