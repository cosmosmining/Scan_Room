'use client';

import { useEffect, useState } from 'react';
import { ConfiguratorShell } from '@/components/shell/ConfiguratorShell';
import { useConfiguratorStore } from '@/state/useConfiguratorStore';
import { decodeShare } from '@/systems/handoff';

type Status = 'loading' | 'ok' | 'error';

/** Decodes a share code, hydrates the store, then shows the configurator. */
export function ShareLoader({ code }: { code: string }) {
  const loadShare = useConfiguratorStore((s) => s.loadShare);
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    const payload = decodeShare(code);
    if (!payload) {
      setStatus('error');
      return;
    }
    loadShare(payload);
    setStatus('ok');
  }, [code, loadShare]);

  if (status === 'ok') return <ConfiguratorShell />;

  return (
    <div className="flex h-dvh items-center justify-center bg-neutral-950 text-neutral-400">
      {status === 'error' ? 'This share link is invalid or corrupted.' : 'Loading shared design…'}
    </div>
  );
}
