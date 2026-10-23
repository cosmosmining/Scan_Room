import type { SurfaceRole } from '@/systems/catalog';

/**
 * Curated Aesthetic Mapping (Phase 3 of the MOZU pipeline). The user types a
 * stylistic directive — "Japandi" — and the system references a pre-curated
 * library, locks a matching palette, and generates a few optimised variations
 * to choose from. This is the "Change Color / Apply to all" step in the app,
 * elevated from per-surface fiddling to a one-word brand-curated theme.
 *
 * A theme is a superset of a catalog {@link import('@/systems/catalog').StylePreset}:
 * same palette/defaults contract (so pricing and the material lock keep working)
 * plus the metadata the curated experience needs — keywords for free-text
 * matching, a mood line, and a UI accent.
 */
export interface AestheticTheme {
  id: string;
  name: string;
  /** Free-text directives that resolve to this theme (lowercased, matched loosely). */
  keywords: string[];
  description: string;
  /** Short mood line shown on the theme card. */
  mood: string;
  /** UI accent colour (hex). */
  accent: string;
  /** Curated allowed materials per surface role — the locked palette. */
  palette: Record<SurfaceRole, string[]>;
  /** Default material id per role (must be a member of `palette[role]`). */
  defaults: Record<SurfaceRole, string>;
}

/** One optimised styling the AI offers within a theme (the app's variations). */
export interface ThemeVariation {
  id: string;
  themeId: string;
  name: string;
  /** Concrete material id per surface role. */
  materials: Record<SurfaceRole, string>;
}
