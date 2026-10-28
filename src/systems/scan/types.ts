import type {
  FixtureScanSummary,
  Millimeters,
  RoomCeiling,
  RoomSource,
  UnitSystem,
  Vec3,
  Wall,
} from '@/lib/types';
import type { ScanObject } from '@mozu/scan-sdk';

/** Fine-grained provenance for a capture. */
export type ScannerId =
  | 'manual'
  | 'floorplan'
  | 'webxr-depth'
  | 'roomplan'
  | 'polycam'
  | 'matterport'
  | 'twindo';

/**
 * Normalized geometric output of ANY capture path (scanner or fallback).
 *
 * This is the single contract every provider must satisfy. It is intentionally
 * smaller than the domain {@link import('@/lib/types').Room} — no id, name, or
 * timestamps — and is lifted into a `Room` via `roomGeometryToRoom`.
 */
export interface RoomGeometry {
  /** Ordered, closed floor polygon (millimetres, Y-up world space). */
  footprint: Vec3[];
  /**
   * Walls carry the fixtures (sockets, pipes, …) found during this capture on
   * `wall.fixtures` — same pass as the geometry. Empty when the provider can't
   * see fixtures (`detectsFixtures === false`).
   */
  walls: Wall[];
  /** What the fixture-detection pass did. Absent when the provider never looks. */
  fixtureScan?: FixtureScanSummary;
  /** Ceiling height. */
  height: Millimeters;
  /** Bulkheads, recesses and a see-through ceiling, when the scan found them. */
  ceiling?: RoomCeiling;
  /** Display preference captured at input time. */
  unitSystem: UnitSystem;
  /** Domain-level provenance. */
  source: RoomSource;
  /** Fine-grained provider that produced this geometry. */
  provider: ScannerId;
  /** Overall capture confidence, 0..1 (1 = exact / user-asserted). */
  confidence: number;
  /**
   * Furniture the scan found in the room. These are measurements of what is
   * there today, not products to be quoted — most of it is going out before the
   * kitchen goes in, so every one of them has to be removable.
   */
  objects?: ScanObject[];
  capturedAt: string;
}

/** Static description of what a provider can do — used to rank providers. */
export interface ScannerCapabilities {
  /** Runs entirely in the browser (no app install / native bridge). */
  inBrowser: boolean;
  /** Detects wall geometry automatically vs. requiring manual authoring. */
  detectsGeometry: boolean;
  /** Detects doors / windows / openings. */
  detectsOpenings: boolean;
  /** Detects wall MEP fixtures (sockets, switches, visible pipes/valves). */
  detectsFixtures: boolean;
  /** Typical dimensional error in millimetres (lower is better). */
  typicalErrorMm: number;
  /** Needs a LiDAR-class depth sensor. */
  requiresDepthSensor: boolean;
}

export interface ScanProgress {
  phase: 'initializing' | 'capturing' | 'processing' | 'detecting' | 'done';
  /** 0..1 when known. */
  ratio?: number;
  message?: string;
}

export interface ScanOptions {
  signal?: AbortSignal;
  onProgress?: (progress: ScanProgress) => void;
  /**
   * Run the fixture-detection pass over the capture's camera frames.
   * Defaults to ON — finding the sockets and pipes is part of scanning the
   * room, not a separate opt-in step.
   */
  detectFixtures?: boolean;
}

/**
 * What the fixture pass actually did. Lets the UI say "6 found — add anything
 * it missed" (optional) instead of demanding hand entry, and lets it be honest
 * when no frames were available to look at. Re-exported from the domain types
 * so the capture contract and the `Room` cannot drift apart.
 */
export type { FixtureScanSummary };

/**
 * The capture abstraction. Every path — manual entry, floorplan sketch, WebXR
 * depth, a RoomPlan companion app, Polycam/Matterport/Twindo imports — is a
 * `SpaceScanner`. The UI and store depend only on this interface, never on a
 * concrete provider.
 *
 * The core surface requested for MOZU is `scan()` + `fallbackInput()`; `id`,
 * `capabilities`, and `isAvailable()` exist so the registry can pick the best
 * available provider per device (progressive enhancement).
 */
export interface SpaceScanner {
  readonly id: ScannerId;
  readonly capabilities: ScannerCapabilities;

  /** Cheap runtime check (sensors, permissions, browser support). */
  isAvailable(): Promise<boolean>;

  /** Run a capture. Rejects if unavailable, cancelled, or it fails. */
  scan(options?: ScanOptions): Promise<RoomGeometry>;

  /** Synchronous seed geometry for the manual fallback path. Always available. */
  fallbackInput(): RoomGeometry;
}

// ── Fallback inputs ──────────────────────────────────────────────────────────

export interface ManualDimensions {
  width: Millimeters;
  depth: Millimeters;
  height: Millimeters;
  unitSystem: UnitSystem;
}

/** A point in the top-down floor plane (x right, z forward), millimetres. */
export interface FloorplanVertex {
  x: Millimeters;
  z: Millimeters;
}

export interface FloorplanSketch {
  /** Ordered polygon, top-down. Requires 3+ vertices. */
  vertices: FloorplanVertex[];
  height: Millimeters;
  unitSystem: UnitSystem;
}
