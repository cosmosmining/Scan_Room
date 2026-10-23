/**
 * `MozuScanner` — the one entry point a host (browser extension, web page)
 * uses. It detects the best available capture path for the device, runs it,
 * and exposes the floorplan + hand-off helpers. Progressive enhancement:
 *
 *   WebXR (Android Chrome) ─▶ metric corner tap
 *   Camera (any phone, incl. iOS Safari) ─▶ AI W×D×H estimate
 *   Manual ─▶ typed dimensions (always available)
 *
 * iOS's most accurate path (Apple RoomPlan) is the native app in `apps/ios`,
 * which hands off through the same {@link RoomScan} contract.
 */
import { estimateRoomFromImages, captureRotationFrames } from './camera';
import { buildFloorplan, rectangleScan } from './floorplan';
import { buildMassing, type MassingModel } from './massing';
import { handoffUrl } from './serialize';
import { floorplanToSvg, type FloorplanSvgOptions } from './svg';
import type { Floorplan, RoomScan, UnitSystem } from './types';
import { isWebXrSupported, scanRoomWithWebXR } from './webxr';

export type Capability = 'webxr' | 'camera' | 'manual';

export interface MozuScannerOptions {
  /** MOZU web host for hand-off deep links (e.g. https://app.mozu.example). */
  webBase?: string;
  /** Endpoint for the camera AI estimate. */
  estimateEndpoint?: string;
  unitSystem?: UnitSystem;
}

export class MozuScanner {
  constructor(private readonly opts: MozuScannerOptions = {}) {}

  /** Best capture path available on this device, best-first. */
  async capability(): Promise<Capability> {
    if (await isWebXrSupported()) return 'webxr';
    if (typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function')
      return 'camera';
    return 'manual';
  }

  /** Metric AR corner-tap scan (Android). Resolves null if cancelled. */
  scanWithAR(): Promise<RoomScan | null> {
    return scanRoomWithWebXR({ unitSystem: this.opts.unitSystem });
  }

  /** Capture a rotation sweep and estimate W×D×H with the vision endpoint. */
  async scanWithCamera(
    video: HTMLVideoElement,
    onProgress?: (n: number, total: number) => void,
  ): Promise<RoomScan> {
    const images = await captureRotationFrames(video, { onProgress });
    return estimateRoomFromImages(images, {
      endpoint: this.opts.estimateEndpoint,
      unitSystem: this.opts.unitSystem,
    });
  }

  /** Manual rectangle (the universal fallback / seed for editing). */
  manual(width: number, depth: number, height: number): RoomScan {
    return rectangleScan(width, depth, height, this.opts.unitSystem ?? 'metric', 'manual');
  }

  /** Scan → dimensioned floorplan. */
  floorplan(scan: RoomScan): Floorplan {
    return buildFloorplan(scan);
  }

  /** Scan → box massing model (walls + floor + detected objects). */
  massing(scan: RoomScan): MassingModel {
    return buildMassing(scan);
  }

  /** Scan (or floorplan) → standalone SVG plan. */
  toSvg(input: RoomScan | Floorplan, svgOpts?: FloorplanSvgOptions): string {
    const fp = 'walls' in input ? input : buildFloorplan(input);
    return floorplanToSvg(fp, svgOpts);
  }

  /** Deep link that opens the MOZU configurator on this measured room. */
  handoff(scan: RoomScan): string {
    if (!this.opts.webBase) throw new Error('webBase not configured.');
    return handoffUrl(this.opts.webBase, scan);
  }
}
