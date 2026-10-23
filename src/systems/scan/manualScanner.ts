import { manualDimensionsToRoomGeometry } from './geometry';
import type { RoomGeometry, ScannerCapabilities, SpaceScanner } from './types';

const MANUAL_CAPABILITIES: ScannerCapabilities = {
  inBrowser: true,
  detectsGeometry: false,
  detectsOpenings: false,
  detectsFixtures: false,
  typicalErrorMm: 0, // user-asserted; as accurate as their measurements
  requiresDepthSensor: false,
};

/**
 * The always-available fallback provider. It senses nothing: `scan` returns the
 * seed geometry and `fallbackInput` yields a default rectangular room the manual
 * UI then edits. Guarantees the configurator always has a room to work with,
 * even with no sensors, no permissions, and no AR support.
 */
export class ManualScanner implements SpaceScanner {
  readonly id = 'manual' as const;
  readonly capabilities = MANUAL_CAPABILITIES;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async scan(): Promise<RoomGeometry> {
    return this.fallbackInput();
  }

  fallbackInput(): RoomGeometry {
    return manualDimensionsToRoomGeometry({
      width: 4000,
      depth: 3000,
      height: 2700,
      unitSystem: 'metric',
    });
  }
}
