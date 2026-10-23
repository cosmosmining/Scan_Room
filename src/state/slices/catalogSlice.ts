import type { StateCreator } from 'zustand';
import { defaultCatalog } from '@/systems/catalog';
import type { CatalogSlice, ConfiguratorState } from '@/state/types';

export const createCatalogSlice: StateCreator<
  ConfiguratorState,
  [],
  [],
  CatalogSlice
> = (set) => ({
  catalog: defaultCatalog,
  setCatalog: (catalog) => set({ catalog }),
});
