import type { Millimeters, UnitSystem, Vec3 } from './geometry';

export interface WallOpening {
  id: string;
  type: 'door' | 'window' | 'archway';
  /** Distance along the wall from its start point. */
  offset: Millimeters;
  width: Millimeters;
  height: Millimeters;
  /** Bottom of the opening from the floor (0 for doors). */
  sillHeight: Millimeters;
  /**
   * Suggested from depth readings that went through the wall — probably glass,
   * possibly a mirror. Drawn as a suggestion; confirming clears it.
   */
  glass?: boolean;
}

/**
 * A mechanical/electrical/plumbing (MEP) point on a wall — the things furniture
 * must not seal off. `socket`/`switch` are electrical; `water`/`waste`/`gas` are
 * the "pipes"; `vent`/`radiator` need airflow.
 *
 * In a normal room every one of these is exposed on the wall surface, so the
 * scan detects them; hand entry is an optional correction, not a required step.
 */
export type FixtureType =
  | 'socket'
  | 'switch'
  | 'water'
  | 'waste'
  | 'gas'
  | 'vent'
  | 'radiator';

/**
 * How a fixture got onto the plan. `detected` is the default path — the scan
 * finds it; `manual` is the optional escape hatch for adding or correcting one.
 */
export type FixtureSource = 'detected' | 'manual';

export interface WallFixture {
  id: string;
  type: FixtureType;
  /** Distance along the wall from its start point (mm) — same frame as openings. */
  offset: Millimeters;
  /** Height of the fixture centre off the floor (mm). */
  height: Millimeters;
  /** Scan-detected (default) vs. optionally user-entered. */
  source: FixtureSource;
  /** Detector confidence 0..1 (1 for manual / user-asserted). */
  confidence: number;
  /** Measured outside diameter for pipework (mm), when the scan could size it. */
  diameterMm?: Millimeters;
  /** Why the detector called it this — shown so a user can sanity-check it. */
  reason?: string;
}

export interface Wall {
  id: string;
  start: Vec3; // floor-level start
  end: Vec3; // floor-level end
  height: Millimeters;
  thickness: Millimeters;
  openings: WallOpening[];
  /** MEP fixtures on this wall (sockets, pipes, …). Optional for back-compat. */
  fixtures?: WallFixture[];
}

export type RoomSource = 'manual' | 'ar-scan';

/**
 * What the scan's fixture pass found. Kept on the room so the UI can report
 * "6 found — add anything it missed" instead of demanding hand entry, and can
 * be honest when there were no frames to look at.
 */
export interface FixtureScanSummary {
  /** The detection pass ran (false when disabled or the provider can't see). */
  attempted: boolean;
  /** Camera frames the detector was given. */
  frames: number;
  /** Fixtures found and placed on the walls. */
  detected: number;
}

/**
 * Part of the ceiling at another height than the rest — a bulkhead or soffit
 * boxed in along the windows (lower), or a recess (higher). Outlined as the
 * scan found it, angled and L-shaped edges included.
 */
export interface CeilingZone {
  /** Outline on the floor plane (x, z), millimetres, counter-clockwise. */
  polygon: { x: Millimeters; z: Millimeters }[];
  /** Height of the ceiling over this area, off the floor. */
  height: Millimeters;
}

/** What the scan found on the ceiling beyond its one height. */
export interface RoomCeiling {
  zones: CeilingZone[];
  /** A see-through ceiling (expanded-metal mesh): the slab seen through it, mm off the floor. */
  seeThroughTo?: Millimeters;
}

export interface Room {
  id: string;
  name: string;
  /** Ordered, closed polygon on the floor plane. MVP constrains to 4 points. */
  footprint: Vec3[];
  walls: Wall[];
  /** Default ceiling height. */
  height: Millimeters;
  unitSystem: UnitSystem;
  source: RoomSource;
  /** Outcome of the scan's fixture pass, when a scan produced this room. */
  fixtureScan?: FixtureScanSummary;
  /** Bulkheads, recesses and a see-through ceiling, when a scan found them. */
  ceiling?: RoomCeiling;
  createdAt: string;
  updatedAt: string;
}
