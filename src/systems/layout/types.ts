import type {
  FixtureType,
  Millimeters,
  ModuleCategory,
  ModuleInstance,
  MountType,
  Room,
} from '@/lib/types';
import type { Vec2 } from './geometry2d';

export interface Interval {
  start: Millimeters;
  end: Millimeters;
}

/** What put a {@link Blocker} on a run. */
export type BlockerKind = 'opening' | 'fixture' | 'column' | 'unit';

/**
 * A stretch of a run that some units must keep clear of, and which ones.
 *
 * A bare `Interval` is an old-style blocker and stops every unit. The optional
 * fields narrow it: a window stops what would stand in front of the glass but
 * not the base cabinets under its sill; a socket stops only the units at its
 * height, and not one built to connect to it; a column a little way off the
 * wall stops units deep enough to reach it.
 */
export interface Blocker extends Interval {
  kind?: BlockerKind;
  /** Vertical extent off the floor, mm. Omitted: floor to ceiling. */
  bottom?: Millimeters;
  top?: Millimeters;
  /** How far out from the wall it starts; a unit no deeper than this fits behind it. */
  fromWall?: Millimeters;
  /** A unit that connects this utility may cover it (a sink base over its water). */
  fixtureType?: FixtureType;
  /** What it is, for messages: the fixture or column id. */
  sourceId?: string;
}

/**
 * Something standing in the room that units must not be packed into — a
 * scanned column. Plan-sense yaw: the width axis runs along (cos, sin).
 */
export interface LayoutObstacle {
  id: string;
  center: Vec2;
  /** Footprint, mm. A round one uses `width` as its diameter. */
  width: Millimeters;
  depth: Millimeters;
  rotation: number;
  shape: 'box' | 'round';
}

/** A usable straight stretch of wall that modules pack along (1D coordinate). */
export interface WallRun {
  id: string;
  wallId: string;
  origin: Vec2; // run start (wall.start) in XZ
  dir: Vec2; // unit vector along the run
  normal: Vec2; // unit inward normal (into the room)
  length: Millimeters;
  usableStart: Millimeters; // after corner reserve / wall gap
  usableEnd: Millimeters;
  /** Stretches units must keep clear of: openings, fixtures, columns. */
  blocked: Blocker[];
}

/** Lightweight placement spec derived from a ModuleDefinition + chosen config. */
export interface PlacementModule {
  /** Optional caller reference (e.g. config-tree node id) carried to the instance. */
  ref?: string;
  definitionId: string;
  category: ModuleCategory;
  mount: MountType;
  width: Millimeters;
  depth: Millimeters;
  height: Millimeters;
  /** Base elevation off the floor; wall units > 0. Defaults to 0. */
  elevation?: Millimeters;
  /** Required clear space in front (appliances). Falls back to walkway rule. */
  frontClearance?: Millimeters;
  finishId?: string;
  /**
   * Utilities this unit is DESIGNED to sit over (e.g. a sink base connects
   * `['water','waste']`). Covering one of these is the intended connection, not
   * a conflict. Covering any other fixture is still flagged.
   */
  connectsUtilities?: FixtureType[];
  /**
   * Utilities this unit REQUIRES within reach (e.g. an oven needs `['socket']`,
   * a gas hob `['gas']`). A missing one on the same wall warns.
   */
  needsUtilities?: FixtureType[];
}

/**
 * A fixture projected into the layout frame: which wall, how far along it
 * (same 1D coordinate as {@link Placement.offset}), and its height off the floor.
 */
export interface LayoutFixture {
  id: string;
  type: FixtureType;
  wallId: string;
  offset: Millimeters;
  height: Millimeters;
}

/** Tunable engine rules (all millimetres). */
export interface LayoutRules {
  /** Minimum circulation gap kept in front of units (e.g. galley walkway). */
  walkwayClearance: Millimeters;
  /** Space reserved at inside corners so adjacent runs don't collide. */
  cornerReserve: Millimeters;
  /** Gap kept at the ends of each run. */
  wallGap: Millimeters;
  /** Floor runs are blocked by openings whose sill sits below this height. */
  openingSillThreshold: Millimeters;
  /** Access gap kept clear around a socket/valve; a unit inside it warns. */
  fixtureClearance: Millimeters;
  /** Stricter clear zone around a gas point (breaching it warns). */
  gasClearance: Millimeters;
  /** How far along the wall a required utility (socket/gas) may be for reach. */
  utilityReach: Millimeters;
}

export const DEFAULT_RULES: LayoutRules = {
  walkwayClearance: 1000,
  cornerReserve: 600,
  wallGap: 0,
  openingSillThreshold: 900,
  fixtureClearance: 150,
  gasClearance: 300,
  utilityReach: 600,
};

/** Which wall to fill, and with what (in order). */
export interface RunAssignment {
  wallId: string;
  modules: PlacementModule[];
}

export interface LayoutRequest {
  room: Room;
  assignments: RunAssignment[];
  rules?: Partial<LayoutRules>;
  /**
   * Fixtures to validate placements against. Omit to read them from the room's
   * walls (`wall.fixtures`); pass explicitly to override.
   */
  fixtures?: LayoutFixture[];
  /** Columns and the like standing in the room; units are packed clear of them. */
  obstacles?: LayoutObstacle[];
}

/** Intermediate placement along a run, before world transform. */
export interface Placement {
  module: PlacementModule;
  run: WallRun;
  offset: Millimeters; // along-run start
}

export type ViolationKind =
  | 'collision'
  | 'clearance'
  | 'unplaced'
  | 'fixture-blocked' // a unit seals a socket / pipe that must stay accessible
  | 'fixture-clearance' // a unit sits inside a fixture's access zone
  | 'utility-reach' // an appliance has no required socket/gas within reach
  | 'obstruction'; // a unit sits across a door / window opening
export type ViolationSeverity = 'error' | 'warning';

export interface Violation {
  kind: ViolationKind;
  severity: ViolationSeverity;
  message: string;
  instanceIds: string[];
  shortfallMm?: number;
  /** The fixture involved, for fixture-* violations. */
  fixtureId?: string;
}

export interface LayoutResult {
  instances: ModuleInstance[];
  placements: Placement[];
  violations: Violation[];
  unplaced: PlacementModule[];
}
