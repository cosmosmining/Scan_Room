/**
 * WebXR AR room measure (Android Chrome / headset browsers — NOT iOS Safari).
 *
 * Starts an `immersive-ar` session with hit-test, lets the user tap their
 * room's floor corners, and returns them as a metric {@link RoomScan}. Because
 * the positions come from real hit-tests against detected surfaces, this is the
 * one in-browser path that genuinely *measures* — the basis for "auto capture
 * sizes" on Android. iOS uses the native RoomPlan app instead.
 *
 * Browser-only: every DOM/WebXR access happens inside the call, so importing
 * this module is safe during SSR.
 */
import { ROOMSCAN_SCHEMA } from './types';
import type { RoomScan, Vec2 } from './types';

const DEFAULT_HEIGHT_MM = 2700;

type AnyXR = { isSessionSupported?: (m: string) => Promise<boolean>; requestSession?: (m: string, o?: unknown) => Promise<any> };
const getXR = (): AnyXR | undefined =>
  typeof navigator !== 'undefined' ? (navigator as unknown as { xr?: AnyXR }).xr : undefined;

/** True on Android Chrome / Android XR / compatible headset browsers. */
export async function isWebXrSupported(): Promise<boolean> {
  try {
    return (await getXR()?.isSessionSupported?.('immersive-ar')) ?? false;
  } catch {
    return false;
  }
}

export interface WebXrScanOptions {
  height?: number;
  unitSystem?: RoomScan['unitSystem'];
}

/** Run the immersive AR corner-tapping flow. Resolves null if cancelled. */
export async function scanRoomWithWebXR(opts: WebXrScanOptions = {}): Promise<RoomScan | null> {
  const xr = getXR();
  if (!xr?.requestSession) throw new Error('WebXR is not available on this device/browser.');

  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    pointerEvents: 'none',
    fontFamily: 'system-ui, sans-serif',
    color: 'white',
  });
  overlay.innerHTML = `
    <div style="padding:16px;pointer-events:none">
      <div style="background:rgba(0,0,0,.55);padding:8px 12px;border-radius:8px;font-size:13px;max-width:80%">
        Aim the dot at a floor corner and tap <b>Add corner</b>. Walk the room, add every corner, then <b>Done</b>.
      </div>
    </div>
    <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none">
      <div id="ar-reticle" style="width:22px;height:22px;border:3px solid #22d3ee;border-radius:50%;opacity:.5"></div>
    </div>
    <div style="padding:16px;display:flex;gap:8px;align-items:center;pointer-events:auto">
      <button id="ar-add" style="flex:1;padding:12px;border:0;border-radius:8px;background:#22d3ee;color:#06121a;font-weight:600;font-size:15px">Add corner (<span id="ar-count">0</span>)</button>
      <button id="ar-done" style="padding:12px 16px;border:0;border-radius:8px;background:white;color:#111;font-weight:600">Done</button>
      <button id="ar-cancel" style="padding:12px 14px;border:0;border-radius:8px;background:rgba(255,255,255,.2);color:white">✕</button>
    </div>`;
  document.body.appendChild(overlay);

  const $ = (id: string) => overlay.querySelector(id) as HTMLElement;
  const reticle = $('#ar-reticle');
  const countEl = $('#ar-count');
  const addBtn = $('#ar-add') as HTMLButtonElement;
  const doneBtn = $('#ar-done') as HTMLButtonElement;
  const cancelBtn = $('#ar-cancel') as HTMLButtonElement;

  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl', { xrCompatible: true }) as WebGLRenderingContext | null;
  if (!gl) {
    overlay.remove();
    throw new Error('WebGL unavailable.');
  }

  let session: any;
  try {
    session = await xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay', 'local-floor'],
      domOverlay: { root: overlay },
    });
  } catch (e) {
    overlay.remove();
    throw e instanceof Error ? e : new Error('Could not start AR session.');
  }

  await (gl as unknown as { makeXRCompatible?: () => Promise<void> }).makeXRCompatible?.();
  const XRWebGLLayerCtor = (window as unknown as { XRWebGLLayer: any }).XRWebGLLayer;
  session.updateRenderState({ baseLayer: new XRWebGLLayerCtor(session, gl) });

  const refSpace = await session
    .requestReferenceSpace('local')
    .catch(() => session.requestReferenceSpace('viewer'));
  const viewerSpace = await session.requestReferenceSpace('viewer');
  const hitTestSource = await session.requestHitTestSource({ space: viewerSpace });

  const corners: Vec2[] = [];
  let lastHit: Vec2 | null = null;

  return await new Promise<RoomScan | null>((resolve) => {
    let settled = false;
    const finish = (result: RoomScan | null) => {
      if (settled) return;
      settled = true;
      try { hitTestSource.cancel?.(); } catch {}
      overlay.remove();
      try { session.end(); } catch {}
      resolve(result);
    };

    addBtn.onclick = () => {
      if (!lastHit) return;
      corners.push({ x: lastHit.x, z: lastHit.z });
      countEl.textContent = String(corners.length);
    };
    doneBtn.onclick = () =>
      finish(
        corners.length >= 3
          ? {
              schema: ROOMSCAN_SCHEMA,
              polygon: corners,
              height: opts.height ?? DEFAULT_HEIGHT_MM,
              openings: [],
              objects: [],
              source: 'webxr',
              unitSystem: opts.unitSystem ?? 'metric',
              confidence: 0.85,
              capturedAt: new Date().toISOString(),
            }
          : null,
      );
    cancelBtn.onclick = () => finish(null);
    session.addEventListener('end', () => finish(null));

    const onFrame = (_t: number, frame: any) => {
      if (settled) return;
      const layer = session.renderState.baseLayer;
      gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      const hits = frame.getHitTestResults(hitTestSource);
      if (hits.length > 0) {
        const pose = hits[0].getPose(refSpace);
        if (pose) {
          lastHit = { x: pose.transform.position.x * 1000, z: pose.transform.position.z * 1000 };
          reticle.style.opacity = '1';
        }
      } else {
        reticle.style.opacity = '.4';
      }
      session.requestAnimationFrame(onFrame);
    };
    session.requestAnimationFrame(onFrame);
  });
}
