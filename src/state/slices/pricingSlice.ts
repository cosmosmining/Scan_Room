import type { StateCreator } from 'zustand';
import { computePricing, createEmptyBreakdown } from '@/systems/pricing';
import type { ConfiguratorState, PricingSlice } from '@/state/types';

const PRICING_OPTIONS = {
  taxRate: 0.2,
  deliveryFlat: 5000,
  installFlat: 15000,
  installPerModule: 6000,
};

export const createPricingSlice: StateCreator<
  ConfiguratorState,
  [],
  [],
  PricingSlice
> = (set, get) => ({
  pricing: createEmptyBreakdown(),
  isPricing: false,

  setPricing: (pricing) => set({ pricing }),

  recomputePricing: () => {
    const {
      styleId,
      materialOverrides,
      moduleTree,
      layoutGraph,
      selectedAddOnIds,
      catalog,
    } = get();
    const pricing = computePricing(
      { styleId, materialOverrides, moduleTree, layoutGraph, selectedAddOnIds },
      catalog,
      PRICING_OPTIONS,
    );
    set({ pricing });
  },
});
