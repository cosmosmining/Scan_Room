import type { StateCreator } from 'zustand';
import type { ConfiguratorState, LayoutSlice } from '@/state/types';

export const createLayoutSlice: StateCreator<
  ConfiguratorState,
  [],
  [],
  LayoutSlice
> = (set) => ({
  domain: 'kitchen',
  layoutType: 'straight',
  setDomain: (domain) => set({ domain }),
  setLayoutType: (layoutType) => set({ layoutType }),
});
