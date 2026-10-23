export * from './types';
export type { Vec2, Rect } from './geometry2d';
export { rectsOverlap, inwardNormal, rotationYFromNormal } from './geometry2d';
export { buildRuns } from './runs';
export {
  packRun,
  placementToInstance,
  placementToRect,
  yBand,
} from './pack';
export { detectCollisions, checkClearances } from './constraints';
export { detectFixtureConflicts, detectOpeningObstruction } from './fixtures';
export { GreedyStrategy, generateLayout } from './strategy';
export type { LayoutStrategy } from './strategy';
export { snapToWall } from './snap';
export { placeByHand, SNAP_REACH } from './handPlace';
export type { HandPlacement } from './handPlace';
export type { SnapOptions } from './snap';
