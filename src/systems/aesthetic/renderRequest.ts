/**
 * `mozu.render/1` — the request the photoreal render server expects.
 *
 * Byte-identical to what `apps/ios/MozuScanner/Export/PhotorealRenderer.swift`
 * sends, so the SAME render server serves the iPad and the browser. Anything
 * else would mean two renderers, two sets of bugs, and two answers to "what
 * will my kitchen look like".
 *
 * Units are METRES here, not the millimetres the rest of the web app uses —
 * because that is what the iPad sends and the server parses. The conversion
 * happens once, in `buildRenderRequest`, rather than being everyone's problem.
 */

import type { Room } from '@/lib/types';
import { materialKind, swatchById, type SurfaceFinish } from './finishes';

export interface RenderFinish {
  swatch: string | null;
  texture: string | null;
  color: [number, number, number];
  roughness: number;
  metalness: number;
  opacity: number;
  textureScale: number;
  rotation: number;
}

export interface RenderRequest {
  schema: 'mozu.render/1';
  room: {
    footprint: [number, number][];
    height: number;
    wall: RenderFinish;
    floor: RenderFinish;
    ceiling: RenderFinish;
    openings: {
      wall: number;
      offset: number;
      width: number;
      height: number;
      sill: number;
      type: string;
    }[];
  };
  extraRooms: unknown[];
  items: {
    model: string | null;
    x: number;
    z: number;
    rotationY: number;
    size: [number, number, number];
    finish: RenderFinish | null;
  }[];
  camera: { pos: [number, number, number]; target: [number, number, number]; fovDeg: number };
  render: { width: number; height: number; samples: number };
}

export type RenderQuality = 'preview' | 'final';

/** Same presets as the iPad: a quick look, or a hero shot. */
export const QUALITY = {
  preview: { width: 1100, height: 700, samples: 96 },
  final: { width: 1920, height: 1200, samples: 400 },
} as const;

const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
};

export function finishPayload(finish: SurfaceFinish): RenderFinish {
  const swatch = swatchById(finish.swatchId);
  const kind = materialKind(finish.kind);
  return {
    swatch: swatch?.id ?? null,
    texture: swatch?.texture ?? null,
    color: hexToRgb(finish.tint ?? swatch?.color ?? '#cccccc'),
    roughness: kind.roughness,
    metalness: kind.metalness,
    opacity: kind.opacity,
    textureScale: finish.textureScale,
    rotation: finish.rotation,
  };
}

export interface RenderCamera {
  pos: [number, number, number];
  target: [number, number, number];
  fovDeg: number;
}

export interface RenderItem {
  model?: string | null;
  /** Metres. */
  x: number;
  z: number;
  rotationY: number;
  /** Metres. */
  size: [number, number, number];
  finish?: SurfaceFinish | null;
}

/**
 * Build the request from a web room. Millimetres in, metres out — the one place
 * that conversion lives.
 */
export function buildRenderRequest(opts: {
  room: Room;
  wall: SurfaceFinish;
  floor: SurfaceFinish;
  ceiling: SurfaceFinish;
  items: RenderItem[];
  camera: RenderCamera;
  quality: RenderQuality;
}): RenderRequest {
  const { room, quality } = opts;
  const size = QUALITY[quality];

  return {
    schema: 'mozu.render/1',
    room: {
      footprint: room.footprint.map((p) => [p.x / 1000, p.z / 1000] as [number, number]),
      height: (room.walls[0]?.height ?? 2500) / 1000,
      wall: finishPayload(opts.wall),
      floor: finishPayload(opts.floor),
      ceiling: finishPayload(opts.ceiling),
      openings: room.walls.flatMap((w, wallIndex) =>
        (w.openings ?? []).map((o) => ({
          wall: wallIndex,
          offset: o.offset / 1000,
          width: o.width / 1000,
          height: o.height / 1000,
          sill: (o.sillHeight ?? 0) / 1000,
          type: o.type,
        })),
      ),
    },
    extraRooms: [],
    items: opts.items.map((i) => ({
      model: i.model ?? null,
      x: i.x,
      z: i.z,
      rotationY: i.rotationY,
      size: i.size,
      finish: i.finish ? finishPayload(i.finish) : null,
    })),
    camera: opts.camera,
    render: { width: size.width, height: size.height, samples: size.samples },
  };
}
