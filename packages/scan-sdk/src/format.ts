/**
 * Human-readable length / area formatting. Metric is millimetres internally;
 * imperial is rendered as feet-and-inches and square feet.
 */
import type { Millimeters, UnitSystem } from './types';

const MM_PER_INCH = 25.4;
const MM2_PER_SQFT = 92_903.04; // (12 * 25.4)^2
const MM2_PER_SQM = 1_000_000;

/** e.g. 4000 → "4.00 m"; 4000 imperial → "13′ 1″". */
export function formatLength(mm: Millimeters, unit: UnitSystem): string {
  if (unit === 'imperial') {
    const totalInches = mm / MM_PER_INCH;
    let feet = Math.floor(totalInches / 12);
    let inches = Math.round(totalInches - feet * 12);
    if (inches === 12) {
      feet += 1;
      inches = 0;
    }
    return `${feet}′ ${inches}″`;
  }
  return mm >= 1000
    ? `${(mm / 1000).toFixed(2)} m`
    : `${Math.round(mm)} mm`;
}

/** Compact length for inline dimension ticks (no unit suffix in metric metres). */
export function formatLengthShort(mm: Millimeters, unit: UnitSystem): string {
  if (unit === 'imperial') return formatLength(mm, unit);
  return mm >= 1000 ? `${(mm / 1000).toFixed(2)}` : `${Math.round(mm)}`;
}

/** e.g. 12_000_000 mm² → "12.0 m²" or "129 ft²". */
export function formatArea(mm2: number, unit: UnitSystem): string {
  if (unit === 'imperial') {
    return `${(mm2 / MM2_PER_SQFT).toFixed(0)} ft²`;
  }
  return `${(mm2 / MM2_PER_SQM).toFixed(1)} m²`;
}
