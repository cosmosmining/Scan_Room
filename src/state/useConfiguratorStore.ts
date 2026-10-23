import { create } from 'zustand';
import { createCatalogSlice } from './slices/catalogSlice';
import { createConfigurationSlice } from './slices/configurationSlice';
import { createDesignSlice } from './slices/designSlice';
import { createLayoutSlice } from './slices/layoutSlice';
import { createPricingSlice } from './slices/pricingSlice';
import { createRoomSlice } from './slices/roomSlice';
import { createStyleSlice } from './slices/styleSlice';
import { createUiSlice } from './slices/uiSlice';
import { createViewerSlice } from './slices/viewerSlice';
import type { ConfiguratorState } from './types';

/**
 * The single configurator store, composed from focused slices:
 * room · catalog · configuration · layout · style · pricing · ui.
 *
 * The module tree (configuration slice) is the source of truth. Placed
 * `instances`, the `layoutGraph`, and `pricing` are derived — the 3D scene and
 * quote are projections of the tree, never independent state.
 */
export const useConfiguratorStore = create<ConfiguratorState>()((...a) => ({
  ...createRoomSlice(...a),
  ...createCatalogSlice(...a),
  ...createConfigurationSlice(...a),
  ...createLayoutSlice(...a),
  ...createStyleSlice(...a),
  ...createPricingSlice(...a),
  ...createUiSlice(...a),
  ...createViewerSlice(...a),
  ...createDesignSlice(...a),
}));
