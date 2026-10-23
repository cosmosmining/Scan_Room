import type { StateCreator } from 'zustand';
import { themeToStylePreset } from '@/systems/aesthetic';
import { DEFAULT_STYLE_ID, SURFACE_ROLES, isMaterialAllowed } from '@/systems/catalog';
import { coerceToPalette } from '@/systems/config';
import type { ConfiguratorState, StyleSlice } from '@/state/types';

export const createStyleSlice: StateCreator<
  ConfiguratorState,
  [],
  [],
  StyleSlice
> = (set, get) => ({
  styleId: DEFAULT_STYLE_ID,
  materialOverrides: {},

  setStyle: (styleId) => {
    const style = get().catalog.styles[styleId];
    if (!style) return;
    // Selecting a style locks the palette: drop overrides it no longer allows.
    set((s) => ({
      styleId,
      materialOverrides: coerceToPalette(s.materialOverrides, style),
    }));
    get().recomputePricing();
  },

  setRoleMaterial: (role, materialId) => {
    const { catalog, styleId } = get();
    const style = catalog.styles[styleId];
    if (!style || !isMaterialAllowed(style, role, materialId)) return; // locked
    set((s) => ({
      materialOverrides: { ...s.materialOverrides, [role]: materialId },
    }));
    get().recomputePricing();
  },

  applyTheme: (theme) => {
    // Register the curated theme as a selectable, locked style, then select it
    // and set its hero materials — the one-word "apply to all" from the app.
    const preset = themeToStylePreset(theme);
    set((s) => ({
      catalog: {
        ...s.catalog,
        styles: { ...s.catalog.styles, [preset.id]: preset },
      },
    }));
    get().setStyle(preset.id);
    for (const role of SURFACE_ROLES) {
      get().setRoleMaterial(role, theme.defaults[role]);
    }
  },

  applyThemeVariation: (materials) => {
    for (const role of SURFACE_ROLES) {
      const id = materials[role];
      if (id) get().setRoleMaterial(role, id);
    }
  },
});
