'use client';

import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { selectConfiguration } from '@/state/selectors';
import { useConfiguratorStore } from '@/state/useConfiguratorStore';
import {
  buildExport,
  buildSharePayload,
  configurationId,
  exportToJson,
  shareUrl,
} from '@/systems/handoff';

/** Configuration ID + shareable link (copy) + quote JSON export (download). */
export function ShareBar() {
  const config = useConfiguratorStore(useShallow(selectConfiguration));
  const room = useConfiguratorStore((s) => s.room);
  const pricing = useConfiguratorStore((s) => s.pricing);
  const [copied, setCopied] = useState(false);

  const id = useMemo(() => configurationId(config), [config]);
  const link = useMemo(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return shareUrl(origin, buildSharePayload(config, room));
  }, [config, room]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const download = () => {
    const json = exportToJson(buildExport({ config, room, pricing }));
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `mozu-${id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-neutral-500">Configuration ID</span>
        <code className="rounded bg-white/5 px-2 py-1 text-neutral-300">{id}</code>
      </div>
      <div className="flex gap-2">
        <input
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-neutral-400"
        />
        <button
          type="button"
          onClick={copy}
          className="shrink-0 rounded-md bg-white px-3 py-1.5 text-xs font-medium text-neutral-900 hover:bg-neutral-200"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <button type="button" onClick={download} className="text-xs text-cyan-300 hover:underline">
        Download quote JSON
      </button>
    </div>
  );
}
