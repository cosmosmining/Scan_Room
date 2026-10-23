import { describe, expect, it } from 'vitest';
import { defaultCatalog, SURFACE_ROLES, isMaterialAllowed } from '@/systems/catalog';
import {
  THEMES,
  matchTheme,
  getTheme,
  themeToStylePreset,
  generateThemeVariations,
} from '@/systems/aesthetic';

const catalog = defaultCatalog;

describe('curated aesthetic themes', () => {
  it('every theme palette references real, role-valid catalog materials', () => {
    for (const theme of THEMES) {
      for (const role of SURFACE_ROLES) {
        const ids = theme.palette[role] ?? [];
        expect(ids.length, `${theme.id}.${role} has options`).toBeGreaterThan(0);
        for (const id of ids) {
          const material = catalog.materials[id];
          expect(material, `${theme.id}.${role} → ${id} exists`).toBeDefined();
          expect(material!.roles, `${id} permits ${role}`).toContain(role);
        }
        // The default must be a member of the locked palette.
        expect(ids).toContain(theme.defaults[role]);
      }
    }
  });

  it('matches a free-text directive to the right theme', () => {
    expect(matchTheme('I want a warm Japandi kitchen')?.id).toBe('japandi');
    expect(matchTheme('something scandinavian and airy')?.id).toBe('nordic-oak');
    expect(matchTheme('modern handleless look')?.id).toBe('modern-matte');
    expect(matchTheme('dark industrial loft vibe')?.id).toBe('industrial-loft');
    expect(matchTheme('zen')?.id).toBe('japandi');
    expect(matchTheme('asdfghjkl')).toBeNull();
  });

  it('bridges a theme to a valid StylePreset (the lock still holds)', () => {
    const japandi = getTheme('japandi')!;
    const preset = themeToStylePreset(japandi);
    expect(preset.id).toBe('theme-japandi');
    for (const role of SURFACE_ROLES) {
      // Defaults survive the style-lock check against their own palette.
      expect(isMaterialAllowed(preset, role, preset.defaults[role])).toBe(true);
    }
  });

  it('generates distinct, in-palette variations (the AI design options)', () => {
    const japandi = getTheme('japandi')!;
    const variations = generateThemeVariations(japandi, 3);
    expect(variations.length).toBeGreaterThanOrEqual(2);
    expect(variations.length).toBeLessThanOrEqual(3);

    const signatures = new Set(variations.map((v) => JSON.stringify(v.materials)));
    expect(signatures.size).toBe(variations.length); // all distinct

    for (const variation of variations) {
      for (const role of SURFACE_ROLES) {
        expect(japandi.palette[role]).toContain(variation.materials[role]);
      }
    }
  });
});
