import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MATERIAL_KINDS,
  SWATCHES,
  SWATCH_CATEGORIES,
  swatchById,
  type Swatch,
} from '../finishes';

/**
 * The finish library must not drift from the iPad's.
 *
 * A customer who picks Walnut 02 in a browser and Walnut 02 on an iPad has to
 * be picking the same material, or the quote is wrong — and that is a bug only
 * a customer finds, months later, holding a door that is the wrong colour. So
 * rather than trusting that the generated table stays generated, this reads the
 * Swift sources and compares. Adding a swatch on one platform and not the other
 * fails here, in seconds, instead of in a showroom.
 */

const swift = (path: string) =>
  readFileSync(resolve(process.cwd(), 'apps/ios/MozuScanner/Design', path), 'utf8');

interface SwiftSwatch {
  id: string;
  name: string;
  category: string;
  texture: string | null;
  /** The tone the iPad shows for this swatch: avgColor, else rgba. */
  rgb: [number, number, number] | null;
}

/**
 * Pull `Swatch(...)` literals out of a Swift source. Parsed a line at a time
 * and field by field: one regex spanning the whole literal has to stop
 * somewhere, and stopping at the first `)` swallows the `c(r, g, b)` colour —
 * which then reads as "no tone here" and quietly skips the comparison.
 */
function parseSwatches(source: string): SwiftSwatch[] {
  const out: SwiftSwatch[] = [];
  for (const raw of source.split('\n')) {
    if (!raw.includes('Swatch(id:')) continue;
    const id = /id:\s*"([^"]+)"/.exec(raw);
    const name = /name:\s*"([^"]+)"/.exec(raw);
    const category = /category:\s*\.(\w+)/.exec(raw);
    if (!id || !name || !category) continue;
    const texture = /textureName:\s*"([^"]+)"/.exec(raw);
    // `avgColor` is the tone for a textured swatch; `rgba` is the colour itself
    // for a flat one. Either way it is what the 2D plan and the no-texture
    // fallback paint with, so it is what the web's `color` must equal.
    const tone = /(?:avgColor|rgba):\s*c\(([\d.]+),\s*([\d.]+),\s*([\d.]+)\)/.exec(raw);
    out.push({
      id: id[1],
      name: name[1],
      category: category[1],
      texture: texture ? texture[1] : null,
      rgb: tone ? [Number(tone[1]), Number(tone[2]), Number(tone[3])] : null,
    });
  }
  return out;
}

const hex = ([r, g, b]: [number, number, number]) =>
  `#${[r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;

/**
 * The built-in textured swatches carry no `avgColor` — the iPad keeps their
 * tones in `MaterialFactory.averageTone(for:)` instead, and that is what its 2D
 * plan fills with and what it falls back to when a bitmap fails to load. So
 * that table is the source for those, and it has to be read too or half the
 * library goes unchecked.
 */
function parseAverageTones(source: string): Map<string, [number, number, number]> {
  const out = new Map<string, [number, number, number]>();
  const line = /case "([^"]+)":\s*return SIMD4<Float>\(([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*1\)/g;
  for (const m of source.matchAll(line)) {
    out.set(m[1], [Number(m[2]), Number(m[3]), Number(m[4])]);
  }
  return out;
}

const tones = parseAverageTones(swift('Render/MaterialFactory.swift'));
const builtIn = parseSwatches(swift('Model/Catalog.swift')).map((s) => ({
  ...s,
  rgb: s.rgb ?? (s.texture ? tones.get(s.texture) ?? null : null),
}));
const mozu = parseSwatches(swift('Model/MozuFinishes.swift'));
const expected = [...builtIn, ...mozu];

describe('finish library parity with the iPad', () => {
  it('parsed the Swift sources at all', () => {
    // A regex that silently matches nothing would make every test below pass.
    expect(builtIn.length).toBeGreaterThan(10);
    expect(mozu).toHaveLength(48);
    expect(tones.size).toBeGreaterThan(5);
    // Every swatch must be checked against a tone from somewhere, or a wrong
    // colour could sit in the library unnoticed.
    expect(expected.every((s) => s.rgb !== null)).toBe(true);
  });

  it('carries exactly the iPad swatches, in the iPad order', () => {
    expect(SWATCHES.map((s) => s.id)).toEqual(expected.map((s) => s.id));
  });

  it('agrees on every swatch name, category and texture', () => {
    for (const want of expected) {
      const got = swatchById(want.id) as Swatch;
      expect(got, `${want.id} exists`).toBeDefined();
      expect(got.name, `${want.id} name`).toBe(want.name);
      expect(got.category, `${want.id} category`).toBe(want.category);
      expect(got.texture, `${want.id} texture`).toBe(want.texture);
    }
  });

  it('agrees on every swatch tone within a rounding step', () => {
    for (const want of expected) {
      if (!want.rgb) continue;
      const got = swatchById(want.id) as Swatch;
      const a = got.color.replace('#', '').match(/../g)!.map((h) => parseInt(h, 16));
      const b = hex(want.rgb).replace('#', '').match(/../g)!.map((h) => parseInt(h, 16));
      for (let i = 0; i < 3; i++) {
        expect(Math.abs(a[i] - b[i]), `${want.id} channel ${i} (${got.color} vs ${hex(want.rgb)})`)
          .toBeLessThanOrEqual(2);
      }
    }
  });

  it('offers every category the iPad does', () => {
    for (const want of expected) {
      expect(SWATCH_CATEGORIES).toContain(want.category);
    }
  });
});

describe('material kinds parity with SurfaceMaterialKind.pbr', () => {
  const kinds = swift('Model/DesignTypes.swift');

  it('uses the iPad roughness and metalness for every kind', () => {
    // `case .matte: return (0.85, 0.0)`
    const pbr = new Map<string, [number, number]>();
    for (const m of kinds.matchAll(/case \.(\w+):\s*return \(([\d.]+),\s*([\d.]+)\)/g)) {
      pbr.set(m[1], [Number(m[2]), Number(m[3])]);
    }
    expect(pbr.size).toBe(7);

    for (const kind of MATERIAL_KINDS) {
      const want = pbr.get(kind.id);
      expect(want, `${kind.id} is a SurfaceMaterialKind`).toBeDefined();
      expect(kind.roughness, `${kind.id} roughness`).toBe(want![0]);
      expect(kind.metalness, `${kind.id} metalness`).toBe(want![1]);
    }
  });

  it('makes glass, and only glass, translucent', () => {
    for (const kind of MATERIAL_KINDS) {
      expect(kind.opacity < 1, `${kind.id} translucent`).toBe(kind.id === 'glass');
    }
    // `var opacity: Float { self == .glass ? 0.35 : 1.0 }`
    expect(MATERIAL_KINDS.find((k) => k.id === 'glass')!.opacity).toBe(0.35);
  });
});
