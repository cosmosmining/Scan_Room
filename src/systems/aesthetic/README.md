# systems/aesthetic/ — Curated Aesthetic Mapping (Phase 3)

The user types a stylistic directive — **"Japandi"** — and the system references a
pre-curated library, locks a matching palette, and offers a few optimised
variations. This is the app's *Change Color / Apply to all*, elevated from
per-surface fiddling to a one-word, brand-curated theme. Pure, deterministic.

## Contract

A theme is a superset of a catalog `StylePreset` (same `palette` + `defaults`, so
the existing material lock and pricing keep working) plus the metadata the curated
experience needs:

```ts
AestheticTheme = {
  id, name, keywords[],        // free-text directives that resolve here
  description, mood, accent,   // card copy + UI colour
  palette: Record<SurfaceRole, string[]>,   // curated, role-valid material ids
  defaults: Record<SurfaceRole, string>,    // the hero look
}
```

## API

- **`matchTheme(directive)`** — free-text → best theme ("a warm japandi kitchen"
  → Japandi, "dark industrial loft" → Industrial Loft), or `null`.
- **`themeToStylePreset(theme)`** — bridge onto the catalog `StylePreset` contract;
  the theme becomes a selectable, locked style.
- **`generateThemeVariations(theme, n)`** — the "few design options": variation 1 is
  the hero; the rest walk the expressive roles (front → worktop → handle) through
  the palette. Always in-palette, always distinct.

The store's `applyTheme(theme)` injects the preset, selects it, and sets the hero
materials; `applyThemeVariation(materials)` switches between the options.

## Themes

`Japandi` (the worked example), `Modern Matte`, `Nordic Oak`, `Industrial Loft`,
`Classic Walnut`. Every theme references real catalog materials valid for their
role — enforced by `__tests__/aesthetic.test.ts` (the test that caught a graphite
carcass). In production this hydrates from the brand's curated library — Mozu's
exclusive Layer-3 content (see `systems/tenant`).
