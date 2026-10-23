import { SURFACE_ROLES, type StylePreset, type SurfaceRole } from '@/systems/catalog';
import { THEMES, THEMES_BY_ID } from './themes';
import type { AestheticTheme, ThemeVariation } from './types';

/**
 * Resolve a free-text directive ("a warm japandi kitchen", "something modern")
 * to the best curated theme. Matches a theme when any of its keywords appears in
 * the directive (or vice-versa for short directives), preferring the longest /
 * most specific keyword hit. Returns null when nothing matches.
 */
export function matchTheme(
  directive: string,
  themes: AestheticTheme[] = THEMES,
): AestheticTheme | null {
  const q = directive.trim().toLowerCase();
  if (!q) return null;

  let best: { theme: AestheticTheme; score: number } | null = null;
  for (const theme of themes) {
    const candidates = [theme.name.toLowerCase(), ...theme.keywords];
    for (const kw of candidates) {
      const hit = q.includes(kw) || (kw.length > 4 && kw.includes(q));
      if (!hit) continue;
      const score = kw.length; // longer keyword = more specific match
      if (!best || score > best.score) best = { theme, score };
    }
  }
  return best?.theme ?? null;
}

/** Look a theme up by id. */
export function getTheme(id: string): AestheticTheme | undefined {
  return THEMES_BY_ID[id];
}

/**
 * Bridge a theme onto the catalog's {@link StylePreset} contract so the existing
 * style lock, material resolution and pricing all keep working unchanged — the
 * theme simply becomes a selectable, brand-curated style.
 */
export function themeToStylePreset(theme: AestheticTheme): StylePreset {
  return {
    id: `theme-${theme.id}`,
    name: theme.name,
    description: theme.description,
    palette: theme.palette,
    defaults: theme.defaults,
  };
}

/** The role → material map a theme applies by default (its hero look). */
export function themeMaterials(theme: AestheticTheme): Record<SurfaceRole, string> {
  return { ...theme.defaults };
}

/**
 * Generate up to `count` optimised variations within a theme — the "few design
 * options" the AI offers. Variation 1 is the hero (defaults); the rest walk the
 * expressive roles (front, then worktop, then handle) through the palette's
 * alternatives. Deterministic and always within the locked palette.
 */
export function generateThemeVariations(
  theme: AestheticTheme,
  count = 3,
): ThemeVariation[] {
  const hero = themeMaterials(theme);
  const variations: ThemeVariation[] = [
    { id: `${theme.id}-v1`, themeId: theme.id, name: `${theme.name} · Signature`, materials: hero },
  ];

  // Roles worth varying, most expressive first, paired with a flattering label.
  const expressive: { role: SurfaceRole; label: (m: string) => string }[] = [
    { role: 'front', label: () => 'Tonal fronts' },
    { role: 'worktop', label: () => 'Stone swap' },
    { role: 'handle', label: () => 'Hardware accent' },
  ];

  for (const { role, label } of expressive) {
    if (variations.length >= count) break;
    const options = theme.palette[role] ?? [];
    const alt = options.find((m) => m !== hero[role]);
    if (!alt) continue;
    variations.push({
      id: `${theme.id}-v${variations.length + 1}`,
      themeId: theme.id,
      name: `${theme.name} · ${label(alt)}`,
      materials: { ...hero, [role]: alt },
    });
  }

  return variations.slice(0, count);
}

/** Roles, re-exported for callers iterating a theme's palette. */
export { SURFACE_ROLES };
