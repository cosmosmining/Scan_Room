'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

interface Estimate {
  width: number;
  depth: number;
  height: number;
}

const SCAN_FRAMES = 6; // ~60° apart over a full turn
const FRAME_INTERVAL = 1200; // ms between captures
const MAX_WIDTH = 1024; // downscale frames to bound upload + tokens

/**
 * Live camera viewfinder (`getUserMedia`, rear camera, HTTPS only) with a
 * **rotation scan**: the user stands in the centre and slowly turns a full
 * circle while it captures several frames, then POSTs them together to
 * `/api/estimate-room` where Claude vision estimates the dimensions from the
 * multiple views. It estimates (no depth sensor) — the user confirms the
 * numbers in the overlaid form (`children`).
 */
export function CameraScan({
  onClose,
  onEstimate,
  children,
}: {
  onClose: () => void;
  onEstimate?: (estimate: Estimate) => void;
  children?: ReactNode;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const framesRef = useRef<string[]>([]);
  const timerRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'preview' | 'scanning' | 'estimating'>('preview');
  const [captured, setCaptured] = useState(0);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let stream: MediaStream | null = null;
    (async () => {
      try {
        const media = navigator.mediaDevices;
        if (!media?.getUserMedia) {
          throw new Error('Camera needs HTTPS and a supported browser.');
        }
        stream = await media.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not access the camera.');
      }
    })();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const captureFrame = (): string | null => {
    const video = videoRef.current;
    if (!video) return null;
    const vw = video.videoWidth || 1280;
    const vh = video.videoHeight || 720;
    const scale = Math.min(1, MAX_WIDTH / vw);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vw * scale);
    canvas.height = Math.round(vh * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.6).split(',')[1] ?? null;
  };

  const finishScan = async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const frames = framesRef.current;
    if (frames.length === 0) {
      setPhase('preview');
      setMessage('No frames captured — try again.');
      return;
    }
    setPhase('estimating');
    setMessage(`Analyzing ${frames.length} views with AI…`);
    try {
      const res = await fetch('/api/estimate-room', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ images: frames }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPhase('preview');
        setMessage(data.error ?? 'Estimate failed.');
        return;
      }
      onEstimate?.({ width: data.widthMm, depth: data.depthMm, height: data.heightMm });
      setPhase('preview');
      setMessage(`AI estimate (${data.confidence}) from ${data.views} views — review & apply.`);
    } catch {
      setPhase('preview');
      setMessage('Network error contacting the AI service.');
    }
  };

  const startScan = () => {
    if (!onEstimate) return;
    framesRef.current = [];
    setCaptured(0);
    setPhase('scanning');
    setMessage('Stand still and slowly turn all the way around…');

    const tick = () => {
      const frame = captureFrame();
      if (frame) {
        framesRef.current.push(frame);
        setCaptured(framesRef.current.length);
      }
      if (framesRef.current.length >= SCAN_FRAMES) {
        void finishScan();
      } else {
        timerRef.current = window.setTimeout(tick, FRAME_INTERVAL);
      }
    };
    timerRef.current = window.setTimeout(tick, 400);
  };

  const progress = Math.round((captured / SCAN_FRAMES) * 100);

  return (
    <div className="fixed inset-0 z-50 bg-black">
      {error ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm text-neutral-200">{error}</p>
          <p className="max-w-xs text-xs text-neutral-500">
            The camera only works over HTTPS and needs camera permission. You can
            still enter dimensions manually.
          </p>
          <button type="button" onClick={onClose} className="rounded-md bg-white px-4 py-2 text-sm font-medium text-neutral-900">
            Back
          </button>
        </div>
      ) : (
        <>
          <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 h-full w-full object-cover" />
          <div className="pointer-events-none absolute inset-0 m-10 rounded-2xl border-2 border-white/40" />

          <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-4">
            <p className="max-w-[72%] rounded-lg bg-black/55 px-3 py-2 text-xs text-neutral-100">
              Stand in the centre of the room and slowly turn a full circle. AI
              estimates the size from the views — then confirm the numbers.
            </p>
            <button type="button" onClick={onClose} aria-label="Close camera" className="rounded-md bg-black/55 px-3 py-2 text-sm text-white">
              ✕
            </button>
          </div>

          {phase === 'scanning' && (
            <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 flex-col items-center gap-2">
              <div className="text-4xl font-semibold text-white tabular-nums">{progress}%</div>
              <div className="text-xs text-neutral-300">
                Captured {captured}/{SCAN_FRAMES} — keep turning
              </div>
            </div>
          )}

          <div className="absolute inset-x-0 bottom-0 space-y-3 bg-gradient-to-t from-black/85 to-transparent p-4 pt-12">
            {onEstimate && phase === 'preview' && (
              <button
                type="button"
                onClick={startScan}
                className="w-full rounded-md bg-violet-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-400"
              >
                ✨ Scan room (turn around)
              </button>
            )}
            {phase === 'scanning' && (
              <button
                type="button"
                onClick={finishScan}
                className="w-full rounded-md bg-violet-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-400"
              >
                Finish scan now
              </button>
            )}
            {phase === 'estimating' && (
              <button type="button" disabled className="w-full rounded-md bg-violet-500/60 px-4 py-2.5 text-sm font-medium text-white">
                Analyzing…
              </button>
            )}
            {message && <p className="text-center text-xs text-neutral-300">{message}</p>}
            {children}
          </div>
        </>
      )}
    </div>
  );
}
