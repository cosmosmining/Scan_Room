// Types for scripts/scan-accuracy.mjs, so the tests can import it.
export interface AccuracyRow {
  check: string;
  measured: unknown;
  scanned: unknown;
  error: unknown;
  limit: unknown;
  pass: boolean;
}
export const LIMITS: {
  wallMm: number;
  wallPct: number;
  areaPct: number;
  ceilingMm: number;
  columnDiameterMm: number;
};
export function alignWalls(
  scanned: number[],
  measured: number[],
): { measured: number; scanned: number }[] | null;
export function compareScan(scan: unknown, truth: unknown): AccuracyRow[];
export function formatReport(rows: AccuracyRow[]): string;
