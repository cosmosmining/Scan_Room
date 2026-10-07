export * from './types';
export {
  manualDimensionsToRoomGeometry,
  floorplanSketchToRoomGeometry,
  roomGeometryToRoom,
} from './geometry';
export { ManualScanner } from './manualScanner';
export { LidarScanner } from './lidarScanner';
export {
  detectSockets,
  classifyPlate,
  saturatedFraction,
  SATURATED_LEVEL,
  MAX_SATURATED_FRACTION,
  MAX_MEASURED_CANDIDATES,
  RESOLVABLE_PLATE_PX,
  type PlateKind,
  heuristicSocketDetector,
  type DetectorImage,
  type SocketDetection,
  type SocketDetector,
  type DetectorOptions,
} from './fixtureDetector';
export {
  detectPipes,
  heuristicPipeDetector,
  type PipeDetection,
  type PipeDetector,
} from './pipeDetector';
export {
  projectDetectionToWall,
  detectWallFixtures,
  detectWallSockets,
  assignFixturesToWalls,
  type PinholeCamera,
  type CameraFrame,
  type WallHit,
  type DetectedFixture,
  type DetectedSocket,
  type DetectFixturesOptions,
} from './fixtureProjection';
export {
  measurePlate,
  integrateSighting,
  pinTrack,
  lookWeight,
  confirmedTracks,
  isConfirmed,
  trackConfidence,
  trackKind,
  PLATE_LIMITS,
  TRACK_POLICY,
  type DepthFrame,
  type PlateIntrinsics,
  type PlateGeometry,
  type SocketTrack,
  type CameraTransform,
} from './plateGeometry';
export { resolveScanner, manualScanner, lidarScanner } from './registry';
export {
  buildMassing,
  type MassingModel,
  type MassingBox,
  type MassingKind,
  type MassingObject,
} from './massing';
export {
  createScanAccumulator,
  planesFromGeometry,
  type ScanAccumulator,
  type ScanSnapshot,
  type ScanEdge,
  type ScanEdgeKind,
  type ScanPhase,
  type PlaneObservation,
} from './lidarSession';
export {
  analyseWalls,
  wallLoop,
  WALL_LOOP_DEFAULTS,
  type LoopSegment,
  type Pillar,
  type WallAnalysis,
} from './wallLoop';
export {
  findGlass,
  GLASS_DEFAULTS,
  type DepthRay,
  type GlassOpening,
  type GlassOptions,
} from './glassFinder';
export {
  findPillars,
  mergePillars,
  PILLAR_DEFAULTS,
  type Footprint,
  type PillarOptions,
} from './pillarFinder';
