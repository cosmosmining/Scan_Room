'use client';

import { useCallback, useState } from 'react';
import {
  QUALITY,
  buildRenderRequest,
  type RenderCamera,
  type RenderItem,
  type RenderQuality,
} from '@/systems/aesthetic/renderRequest';
import { DEFAULT_FINISH, type SurfaceFinish } from '@/systems/aesthetic/finishes';
import { furnitureItem, placedSize } from '@/systems/furniture/catalog';
import { useConfiguratorStore } from '@/state/useConfiguratorStore';

/**
 * Photoreal render — the web twin of the iPad's render sheet.
 *
 * Same two quality presets, the same `mozu.render/1` request, and the same
 * server, so a browser render and an iPad render of the same room are the same
 * picture. It goes through `/api/photoreal` because a page on HTTPS cannot post
 * to a render box on a LAN, which the iPad can.
 *
 * A final render path-traces for minutes, so the wait is stated up front rather
 * than left as a spinner people assume has hung.
 */
export function PhotorealRender({
  wall = DEFAULT_FINISH,
  floor = DEFAULT_FINISH,
  ceiling = DEFAULT_FINISH,
}: {
  wall?: SurfaceFinish;
  floor?: SurfaceFinish;
  ceiling?: SurfaceFinish;
}) {
  const room = useConfiguratorStore((s) => s.room);
  const instances = useConfiguratorStore((s) => s.instances);
  const catalog = useConfiguratorStore((s) => s.catalog);
  const designItems = useConfiguratorStore((s) => s.designItems);

  const [quality, setQuality] = useState<RenderQuality>('preview');
  const [phase, setPhase] = useState<'idle' | 'rendering' | 'done' | 'failed'>('idle');
  const [image, setImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const start = useCallback(async () => {
    setPhase('rendering');
    setError(null);
    setElapsed(0);
    const tick = window.setInterval(() => setElapsed((s) => s + 1), 1000);

    try {
      // Frame the whole room from a corner, at eye height — the shot someone
      // would actually take, rather than the current orbit position which may
      // be inside a cabinet.
      const xs = room.footprint.map((p) => p.x / 1000);
      const zs = room.footprint.map((p) => p.z / 1000);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
      const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
      const camera: RenderCamera = {
        pos: [cx + span * 0.75, 1.6, cz + span * 0.75],
        target: [cx, 1.1, cz],
        fovDeg: 55,
      };

      // Both kinds of placement go in the same request: the parametric module
      // run AND the freely-placed catalogue furniture. A render that quietly
      // drops the sofa is a render of a different room.
      const modules: RenderItem[] = instances.flatMap((inst) => {
        const def = catalog.definitions[inst.definitionId];
        if (!def) return [];
        return [{
          model: def.modelUrl ?? null,
          x: inst.position.x / 1000,
          z: inst.position.z / 1000,
          rotationY: inst.rotationY,
          size: [
            (inst.width ?? def.dimensions.width) / 1000,
            def.dimensions.height / 1000,
            def.dimensions.depth / 1000,
          ] as [number, number, number],
          finish: null,
        }];
      });

      const furniture: RenderItem[] = designItems.flatMap((placed) => {
        const item = furnitureItem(placed.itemId);
        // A scanned piece is a measurement of what is in the room TODAY — most
        // of it is going out before the kitchen goes in — and has no model, so
        // it would only ever render as a grey box in a picture of the new room.
        // Columns stay: they are the room, and render as the box they occupy.
        if (!item && !placed.column) return [];
        // A column meets the ceiling, whatever height the room is now.
        const size = placed.column ? { ...placedSize(placed), height: room.height } : placedSize(placed);
        return [{
          // The render server resolves a model by catalogue id, the same id the
          // iPad sends for the same piece.
          model: item?.id ?? null,
          x: placed.position.x / 1000,
          z: placed.position.z / 1000,
          rotationY: placed.rotationY,
          size: [size.width / 1000, size.height / 1000, size.depth / 1000] as [number, number, number],
          finish: placed.finish ?? null,
        }];
      });

      const items: RenderItem[] = [...modules, ...furniture];

      const request = buildRenderRequest({ room, wall, floor, ceiling, items, camera, quality });
      const res = await fetch('/api/photoreal', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? `Render failed (${res.status}).`);
        setPhase('failed');
        return;
      }

      const blob = await res.blob();
      setImage((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(blob);
      });
      setPhase('done');
    } catch (e) {
      setError((e as Error).message);
      setPhase('failed');
    } finally {
      window.clearInterval(tick);
    }
  }, [room, instances, catalog, designItems, wall, floor, ceiling, quality]);

  return (
    <div className="flex flex-col gap-4 text-sm">
      <div>
        <h3 className="mb-2 text-xs uppercase tracking-wider text-neutral-500">Quality</h3>
        <div className="flex gap-2">
          {(['preview', 'final'] as RenderQuality[]).map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => setQuality(q)}
              className={`flex-1 rounded-lg border px-3 py-2 text-xs capitalize ${
                q === quality ? 'border-sky-400 bg-sky-400/10 text-sky-200' : 'border-white/15 text-neutral-300'
              }`}
            >
              {q}
              <span className="ml-1.5 text-neutral-500">
                {QUALITY[q].width}×{QUALITY[q].height} · {QUALITY[q].samples} spp
              </span>
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={() => void start()}
        disabled={phase === 'rendering'}
        className="rounded-lg bg-white px-4 py-2.5 font-medium text-neutral-950 disabled:opacity-40"
      >
        {phase === 'rendering' ? `Rendering… ${elapsed}s` : 'Render'}
      </button>

      {phase === 'rendering' && (
        <p className="text-xs text-neutral-500">
          {quality === 'final'
            ? 'A final render path-traces at 400 samples — several minutes is normal.'
            : 'A preview takes about a minute.'}
        </p>
      )}

      {phase === 'failed' && error && (
        <p role="alert" className="rounded-lg bg-red-950/60 px-3 py-2 text-xs text-red-200">
          {error}
        </p>
      )}

      {image && (
        <div className="flex flex-col gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image} alt="Photoreal render of the room" className="w-full rounded-lg" />
          <a
            href={image}
            download="mozu-render.png"
            className="rounded-lg border border-white/15 px-3 py-2 text-center text-xs text-neutral-300"
          >
            Download image
          </a>
        </div>
      )}
    </div>
  );
}
