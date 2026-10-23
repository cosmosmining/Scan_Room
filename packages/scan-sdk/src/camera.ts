/**
 * Camera "turn-around" estimate (works on any phone, incl. iOS Safari, where
 * there is no depth sensor and no WebXR). The user stands in the centre and
 * slowly rotates while frames are captured; the frames are sent to an estimate
 * endpoint (vision model) that returns approximate W×D×H. Coarser than a real
 * scan — the user confirms the numbers — but it is the universal fallback.
 *
 * Browser-only; safe to import during SSR.
 */
import { rectangleScan } from './floorplan';
import type { RoomScan, UnitSystem } from './types';

export interface CaptureOptions {
  /** Number of frames to grab over the turn (default 6, ~60° apart). */
  frames?: number;
  /** Milliseconds between frames (default 1200). */
  intervalMs?: number;
  /** Downscale longest edge to bound upload size (default 1024 px). */
  maxWidth?: number;
  onProgress?: (captured: number, total: number) => void;
}

/** Grab a rotation sweep of base64 JPEG frames from a playing <video>. */
export function captureRotationFrames(
  video: HTMLVideoElement,
  opts: CaptureOptions = {},
): Promise<string[]> {
  const total = opts.frames ?? 6;
  const intervalMs = opts.intervalMs ?? 1200;
  const maxWidth = opts.maxWidth ?? 1024;
  const frames: string[] = [];

  const grab = (): string | null => {
    const vw = video.videoWidth || 1280;
    const vh = video.videoHeight || 720;
    const s = Math.min(1, maxWidth / vw);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vw * s);
    canvas.height = Math.round(vh * s);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.6).split(',')[1] ?? null;
  };

  return new Promise((resolve) => {
    const tick = () => {
      const f = grab();
      if (f) {
        frames.push(f);
        opts.onProgress?.(frames.length, total);
      }
      if (frames.length >= total) resolve(frames);
      else window.setTimeout(tick, intervalMs);
    };
    window.setTimeout(tick, 400);
  });
}

export interface EstimateOptions {
  /** Endpoint that accepts `{ images: string[] }` and returns mm dimensions. */
  endpoint?: string;
  unitSystem?: UnitSystem;
}

interface EstimateResponse {
  widthMm: number;
  depthMm: number;
  heightMm: number;
  confidence?: string;
  note?: string;
}

const CONFIDENCE: Record<string, number> = { low: 0.4, medium: 0.6, high: 0.75 };

/** POST captured frames to the estimate endpoint → a rectangular RoomScan. */
export async function estimateRoomFromImages(
  images: string[],
  opts: EstimateOptions = {},
): Promise<RoomScan> {
  if (images.length === 0) throw new Error('No frames captured.');
  const res = await fetch(opts.endpoint ?? '/api/estimate-room', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ images }),
  });
  const data = (await res.json()) as EstimateResponse & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Estimate failed (${res.status}).`);

  const scan = rectangleScan(
    data.widthMm,
    data.depthMm,
    data.heightMm,
    opts.unitSystem ?? 'metric',
    'camera',
  );
  scan.confidence = CONFIDENCE[data.confidence ?? 'low'] ?? 0.4;
  return scan;
}
