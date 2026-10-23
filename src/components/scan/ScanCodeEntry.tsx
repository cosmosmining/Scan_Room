'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { parseScan } from '@mozu/scan-sdk';
import { ConfiguratorShell } from '@/components/shell/ConfiguratorShell';
import { CODE_LENGTH, normaliseCode } from '@/systems/handoff/scanHandoff';
import { scanToGeometry } from '@/systems/scan/scanToGeometry';
import { useConfiguratorStore } from '@/state/useConfiguratorStore';

/**
 * "You scanned on the iPad, you're designing on a laptop." This is the bridge.
 *
 * Two ways in, because two different people arrive here:
 *
 *   * A CODE, for the surveyor who has the iPad in one hand. Six characters,
 *     read off the app and typed here.
 *   * A FILE, for anyone who was emailed the scan JSON, or who is offline, or
 *     whose code expired. It costs almost nothing to support and removes the
 *     single point of failure of "the server must be reachable from both".
 *
 * Both land in exactly the same place through exactly the same conversion, so
 * neither is a second-class path.
 */
export function ScanCodeEntry({
  onLoaded,
}: {
  /** Called once a scan has been applied; defaults to a full page navigation. */
  onLoaded?: () => void;
} = {}) {
  const applyRoomGeometry = useConfiguratorStore((s) => s.applyRoomGeometry);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  /**
   * Show the configurator in place rather than navigating to it.
   *
   * The first version applied the room and then set `window.location`, which
   * threw the room straight back away: the store is in memory, so a full page
   * load starts from nothing and the person lands back on this screen with an
   * empty box. Caught by the demo recording, which is exactly the sort of thing
   * a unit test does not see.
   */
  const done = useCallback(() => {
    if (onLoaded) onLoaded();
    else setLoaded(true);
  }, [onLoaded]);

  const load = useCallback(
    async (raw: string) => {
      const normalised = normaliseCode(raw);
      if (!normalised) {
        setError(`A handoff code is ${CODE_LENGTH} characters — check the app and try again.`);
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/scan-handoff?code=${encodeURIComponent(normalised)}`);
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          setError(body?.error ?? 'That code did not match a scan.');
          return;
        }
        const { scan } = (await res.json()) as { scan: unknown };
        const parsed = parseScan(JSON.stringify(scan));
        if (!parsed) {
          setError('The server returned a scan this version cannot read.');
          return;
        }
        applyRoomGeometry(scanToGeometry(parsed));
        done();
      } catch {
        setError('Could not reach the server. You can load the scan file instead.');
      } finally {
        setBusy(false);
      }
    },
    [applyRoomGeometry, done],
  );

  const loadFile = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      try {
        const parsed = parseScan(await file.text());
        if (!parsed) {
          setError('That file is not a MOZU room scan.');
          return;
        }
        applyRoomGeometry(scanToGeometry(parsed));
        done();
      } catch {
        setError('That file could not be read as JSON.');
      } finally {
        setBusy(false);
      }
    },
    [applyRoomGeometry, done],
  );

  // A code in the address bar (/scan?code=…) should just work, so a link sent
  // by email or message needs no typing at all.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('code');
    if (fromUrl) void load(fromUrl);
  }, [load]);

  if (loaded) return <ConfiguratorShell />;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-neutral-950 px-6 py-12 text-neutral-100">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-semibold tracking-tight">Open your scanned room</h1>
        <p className="mt-2 text-sm leading-relaxed text-neutral-400">
          Scan a room in the MOZU iPad app, tap <strong>Send to MOZU web</strong>, and type the
          code it shows you here.
        </p>

        <form
          className="mt-8"
          onSubmit={(e) => {
            e.preventDefault();
            void load(code);
          }}
        >
          <label htmlFor="handoff-code" className="text-xs uppercase tracking-wider text-neutral-500">
            Handoff code
          </label>
          <input
            id="handoff-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="B7K4M2"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            disabled={busy}
            className="mt-2 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 font-mono text-2xl tracking-[0.35em] uppercase outline-none placeholder:text-neutral-700 focus:border-neutral-500"
          />
          <button
            type="submit"
            disabled={busy || !code.trim()}
            className="mt-4 w-full rounded-lg bg-white px-4 py-3 font-medium text-neutral-950 disabled:opacity-40"
          >
            {busy ? 'Opening…' : 'Open room'}
          </button>
        </form>

        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-red-950/60 px-4 py-3 text-sm text-red-200">
            {error}
          </p>
        )}

        <div className="mt-10 border-t border-neutral-800 pt-6">
          <p className="text-sm text-neutral-400">
            No code? Load the scan file the app shared instead.
          </p>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void loadFile(file);
            }}
          />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={busy}
            className="mt-3 w-full rounded-lg border border-neutral-700 px-4 py-3 text-sm disabled:opacity-40"
          >
            Choose scan file…
          </button>
        </div>
      </div>
    </div>
  );
}
