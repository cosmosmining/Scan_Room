/**
 * Naming and sizing for wall fixtures — the "label it" half of fixture
 * detection. One place decides what a detected socket or pipe is CALLED and how
 * a pipe's measured diameter maps to a service, so the plan, the SVG, the iOS
 * app and the conflict engine all say the same thing.
 *
 * Pure and dependency-free.
 */
import type { Millimeters, ScanFixture, ScanFixtureType } from './types';

/** Human-readable name per fixture type. */
export const FIXTURE_LABEL: Record<ScanFixtureType, string> = {
  socket: 'Socket',
  switch: 'Switch',
  water: 'Water',
  waste: 'Waste',
  gas: 'Gas',
  vent: 'Vent',
  radiator: 'Radiator',
};

/** Single-character plan glyph per type (monochrome-safe). */
export const FIXTURE_GLYPH: Record<ScanFixtureType, string> = {
  socket: 'S',
  switch: 'W',
  water: 'H',
  waste: 'D',
  gas: 'G',
  vent: 'V',
  radiator: 'R',
};

/** The pipework types — the ones a diameter is meaningful for. */
export const PIPE_TYPES: ScanFixtureType[] = ['water', 'waste', 'gas'];

export const isPipe = (type: ScanFixtureType): boolean => PIPE_TYPES.includes(type);

/**
 * Nominal outside-diameter bands (millimetres) for the services we classify.
 *
 * Domestic reality: supply pipework is small (15 / 22 / 28 mm copper or plastic),
 * gas runs in the same small-bore range but typically 22–35 mm, and waste/soil is
 * unmistakably fatter (32 / 40 / 50 mm wastes, 110 mm soil stacks). Diameter alone
 * separates waste from the rest cleanly; water vs gas overlaps and needs a cue.
 */
export const PIPE_DIAMETER_BANDS = {
  water: { min: 8, max: 30 },
  gas: { min: 20, max: 36 },
  waste: { min: 32, max: 130 },
} as const;

export interface PipeClassification {
  type: ScanFixtureType;
  confidence: number;
  /** Why this call was made — surfaced in the UI so a user can sanity-check it. */
  reason: string;
}

export interface PipeCues {
  /** Height of the pipe's centre above the floor (mm). */
  heightMm?: Millimeters;
  /** True when the pipe runs vertically (a stack/riser rather than a branch). */
  vertical?: boolean;
  /** Mean yellow-ness 0..1, if colour was sampled (gas pipework is often yellow). */
  yellowness?: number;
}

/**
 * Classify a pipe from its measured diameter, breaking the water/gas overlap
 * with secondary cues.
 *
 * Waste is decided by size alone — nothing else in a domestic wall is that fat.
 * Inside the small-bore overlap the tie-breakers are: yellow paint/sleeve (gas
 * convention), and a low horizontal run near the floor (gas services commonly
 * enter low, supply more often drops to appliances). Neither is decisive on its
 * own, so the returned confidence stays honest.
 */
export function classifyPipe(
  diameterMm: Millimeters,
  cues: PipeCues = {},
): PipeClassification {
  if (diameterMm >= PIPE_DIAMETER_BANDS.waste.min) {
    const big = diameterMm >= 80;
    return {
      type: 'waste',
      confidence: big ? 0.92 : 0.8,
      reason: `${Math.round(diameterMm)}mm — too fat for supply, ${big ? 'soil stack' : 'waste branch'}`,
    };
  }

  // Small bore: water or gas.
  if (cues.yellowness !== undefined && cues.yellowness > 0.45) {
    return {
      type: 'gas',
      confidence: 0.78,
      reason: `${Math.round(diameterMm)}mm and yellow — gas convention`,
    };
  }
  if (diameterMm >= PIPE_DIAMETER_BANDS.gas.min && cues.vertical === false && (cues.heightMm ?? 9999) < 400) {
    return {
      type: 'gas',
      confidence: 0.6,
      reason: `${Math.round(diameterMm)}mm running low and horizontal — likely gas service`,
    };
  }
  return {
    type: 'water',
    confidence: diameterMm <= 30 ? 0.72 : 0.55,
    reason: `${Math.round(diameterMm)}mm small bore — supply pipework`,
  };
}

/**
 * Convert an apparent width in pixels to a real diameter in millimetres.
 *
 * Pinhole camera: a span of `pixels` at distance `distanceMm`, in an image
 * `imageWidthPx` wide with vertical field of view `fovY` and aspect
 * `imageWidthPx / imageHeightPx`, subtends
 *
 *     mm = 2 · distance · tan(fovX / 2) · (pixels / imageWidthPx)
 *
 * where `tan(fovX/2) = tan(fovY/2) · aspect`. The distance is the ray-cast hit
 * distance to the wall, which the LiDAR geometry already gives us.
 */
export function apparentWidthToMm(
  pixels: number,
  distanceMm: Millimeters,
  fovY: number,
  imageWidthPx: number,
  imageHeightPx: number,
): Millimeters {
  if (pixels <= 0 || distanceMm <= 0 || imageWidthPx <= 0 || imageHeightPx <= 0) return 0;
  const aspect = imageWidthPx / imageHeightPx;
  const tanX = Math.tan(fovY / 2) * aspect;
  return 2 * distanceMm * tanX * (pixels / imageWidthPx);
}

/**
 * The label drawn on the plan: the service name, plus the measured bore for
 * pipework (`Waste ⌀110`). An explicit `label` on the fixture always wins.
 */
export function fixtureLabel(fixture: ScanFixture): string {
  if (fixture.label) return fixture.label;
  const base = FIXTURE_LABEL[fixture.type] ?? fixture.type;
  if (isPipe(fixture.type) && fixture.diameterMm && fixture.diameterMm > 0) {
    return `${base} ⌀${Math.round(fixture.diameterMm)}`;
  }
  return base;
}

/** Longer description for lists / tooltips: label, height, confidence, source. */
export function describeFixture(fixture: ScanFixture): string {
  const pct = Math.round(Math.max(0, Math.min(1, fixture.confidence)) * 100);
  const how = fixture.source === 'manual' ? 'added by hand' : `${pct}% confident`;
  return `${fixtureLabel(fixture)} · ${Math.round(fixture.height)}mm high · ${how}`;
}
