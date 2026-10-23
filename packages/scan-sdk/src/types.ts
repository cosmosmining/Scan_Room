/**
 * @mozu/scan-sdk — shared contract types.
 *
 * Every capture path (Apple RoomPlan on iOS, WebXR hit-test on Android, the
 * camera AI estimate, or manual entry) ultimately produces a {@link RoomScan}.
 * `buildFloorplan` turns that into a {@link Floorplan} — the dimensioned,
 * top-down plan shown in the "2 Floorplan" step. Keeping this one contract is
 * what lets the iOS app, the browser extensions, and the web app interoperate.
 *
 * Internal unit of length is the **millimetre**. The floor plane is X (right) /
 * Z (forward); Y is up (height), matching Three.js and the MOZU web app.
 */

/** Schema tag stamped onto serialized scans for forward-compatibility. */
export const ROOMSCAN_SCHEMA = 'mozu.roomscan/1' as const;

export type Millimeters = number;

/** Imperial is a display concern only; storage is always millimetres. */
export type UnitSystem = 'metric' | 'imperial';

/** A point on the top-down floor plane (millimetres). */
export interface Vec2 {
  x: Millimeters;
  z: Millimeters;
}

/** Where a scan came from — drives confidence and UI copy. */
export type ScanSource = 'roomplan' | 'webxr' | 'camera' | 'manual';

/** A door / window / opening detected in (or added to) a wall. */
export interface ScanOpening {
  type: 'door' | 'window' | 'archway';
  /** Index of the wall in `polygon` this opening sits on (edge i → i+1). */
  wall: number;
  /** Distance along the wall from its start vertex (millimetres). */
  offset: Millimeters;
  width: Millimeters;
  height: Millimeters;
  /** Bottom of the opening above the floor (0 for doors). */
  sill?: Millimeters;
}

/**
 * A mechanical/electrical/plumbing point found on a wall.
 *
 * `socket`/`switch` are electrical; `water`/`waste`/`gas` are the pipework;
 * `vent`/`radiator` need airflow. In a normal room these are all **exposed on
 * the wall surface**, so the scan detects them — `source: 'manual'` exists only
 * for the optional case where someone adds or corrects one by hand.
 */
export type ScanFixtureType =
  | 'socket'
  | 'switch'
  | 'water'
  | 'waste'
  | 'gas'
  | 'vent'
  | 'radiator';

/** How a fixture got onto the plan. Detection is the default path. */
export type ScanFixtureSource = 'detected' | 'manual';

export interface ScanFixture {
  type: ScanFixtureType;
  /** Index of the wall in `polygon` this fixture sits on (edge i → i+1). */
  wall: number;
  /** Distance along the wall from its start vertex (millimetres). */
  offset: Millimeters;
  /** Height of the fixture centre above the floor (millimetres). */
  height: Millimeters;
  source: ScanFixtureSource;
  /** Detector confidence 0..1 (1 for a user-asserted fixture). */
  confidence: number;
  /** Measured outside diameter for pipework (millimetres), when sized. */
  diameterMm?: Millimeters;
  /** Optional override for the generated display label. */
  label?: string;
}

/** An object detected by a scanner that returns furniture (e.g. RoomPlan). */
export interface ScanObject {
  category: string;
  /** Centre of the object's footprint (millimetres). */
  center: Vec2;
  width: Millimeters;
  depth: Millimeters;
  /** Y rotation, radians. */
  rotation: number;
  /** Height of the object (millimetres), when the sensor reports it. */
  height?: Millimeters;
}

/**
 * The normalized output of any capture path. This is the wire format the iOS
 * app and extensions hand to the web app (see `serializeScan`/`parseScan`).
 */
export interface RoomScan {
  schema: typeof ROOMSCAN_SCHEMA;
  /** Ordered, closed floor polygon (millimetres). Requires 3+ vertices. */
  polygon: Vec2[];
  /** Ceiling height (millimetres). */
  height: Millimeters;
  openings: ScanOpening[];
  objects: ScanObject[];
  /**
   * MEP fixtures found on the walls (sockets, pipes, …). Optional so older
   * payloads still parse; a scan that looked and found none sends `[]`.
   */
  fixtures?: ScanFixture[];
  source: ScanSource;
  /** Display preference captured at input time. */
  unitSystem: UnitSystem;
  /** Capture confidence, 0..1 (1 = exact / user-asserted). */
  confidence: number;
  capturedAt: string;
}

// ── Floorplan (derived view) ────────────────────────────────────────────────

/** One wall segment of the plan with its auto-captured length. */
export interface FloorplanWall {
  index: number;
  start: Vec2;
  end: Vec2;
  /** Auto-captured wall length (millimetres) — the "sizes" in the screenshot. */
  length: Millimeters;
  /** Direction angle of the wall, radians (atan2(dz, dx)). */
  angle: number;
  /** Unit normal pointing OUT of the room (for placing dimension labels). */
  outward: Vec2;
}

export interface FloorplanBounds {
  minX: Millimeters;
  minZ: Millimeters;
  maxX: Millimeters;
  maxZ: Millimeters;
  width: Millimeters;
  depth: Millimeters;
}

/**
 * A fixture resolved onto the plan: the same {@link ScanFixture} plus where it
 * actually sits in floor coordinates and the text to draw beside it. Computed
 * once by `buildFloorplan` so every renderer (SVG, React, iOS) agrees.
 */
export interface FloorplanFixture extends ScanFixture {
  /** Position on the floor plane (millimetres) — the point on the wall line. */
  point: Vec2;
  /** Unit normal pointing INTO the room (for offsetting the marker/label). */
  inward: Vec2;
  /** Resolved display label, e.g. `Waste ⌀110`. */
  text: string;
}

/**
 * The dimensioned, top-down plan derived from a {@link RoomScan}. Pure data —
 * `floorplanToSvg` renders it; the web app draws the same model in React.
 */
export interface Floorplan {
  points: Vec2[];
  walls: FloorplanWall[];
  openings: ScanOpening[];
  objects: ScanObject[];
  /** MEP fixtures placed on the plan, each with its label. */
  fixtures: FloorplanFixture[];
  /** Floor area (square millimetres). */
  areaMm2: number;
  perimeterMm: Millimeters;
  height: Millimeters;
  bounds: FloorplanBounds;
  unitSystem: UnitSystem;
  source: ScanSource;
  confidence: number;
}
