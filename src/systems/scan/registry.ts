import { LidarScanner } from './lidarScanner';
import { ManualScanner } from './manualScanner';
import type { SpaceScanner } from './types';

/**
 * Capability-based scanner resolution (progressive enhancement).
 *
 * Providers are tried best-first; the first available one wins, with
 * ManualScanner as the guaranteed floor. The depth scanner ({@link LidarScanner},
 * WebXR depth / RoomPlan-class) is preferred when the device exposes an
 * immersive-AR session; otherwise resolution falls through to manual. Further
 * cloud adapters (Polycam / Matterport / Twindo imports) prepend here later —
 * nothing else changes, everything codes against `SpaceScanner`.
 */
const manual = new ManualScanner();
const lidar = new LidarScanner();

const providers: SpaceScanner[] = [lidar, manual];

export async function resolveScanner(): Promise<SpaceScanner> {
  for (const provider of providers) {
    if (await provider.isAvailable()) return provider;
  }
  return manual;
}

export { manual as manualScanner, lidar as lidarScanner };
