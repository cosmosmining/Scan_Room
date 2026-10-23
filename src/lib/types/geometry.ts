/**
 * Geometry primitives shared across MOZU.
 *
 * Internal unit of length is the millimetre. Coordinate system is right-handed,
 * Y-up (matching Three.js). Imperial/metric is a display concern only — storage
 * is always millimetres.
 */

export type Millimeters = number;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Display preference only. Storage is always millimetres. */
export type UnitSystem = 'metric' | 'imperial';

export interface Dimensions {
  width: Millimeters;
  height: Millimeters;
  depth: Millimeters;
}

/** A configurable dimension (e.g. adjustable-width filler panels). */
export interface DimensionRange {
  min: Millimeters;
  max: Millimeters;
  step: Millimeters;
  default: Millimeters;
}
