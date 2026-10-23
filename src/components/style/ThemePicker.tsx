'use client';

import { useMemo, useState } from 'react';
import {
  THEMES,
  generateThemeVariations,
  getTheme,
  matchTheme,
  type AestheticTheme,
} from '@/systems/aesthetic';
import { useConfiguratorStore } from '@/state/useConfiguratorStore';

/**
 * Phase 3 surfaced: Curated Aesthetic Mapping. The user types a directive
 * ("Japandi") or picks a curated theme; the system locks a matching palette and
 * offers a few optimised variations — the app's "Change Color / Apply to all",
 * elevated to one-word brand-curated themes.
 */
export function ThemePicker() {
  const styleId = useConfiguratorStore((s) => s.styleId);
  const materialOverrides = useConfiguratorStore((s) => s.materialOverrides);
  const catalog = useConfiguratorStore((s) => s.catalog);
  const applyTheme = useConfiguratorStore((s) => s.applyTheme);
  const applyThemeVariation = useConfiguratorStore((s) => s.applyThemeVariation);

  const [directive, setDirective] = useState('');
  const [noMatch, setNoMatch] = useState(false);

  const activeTheme = styleId.startsWith('theme-') ? getTheme(styleId.slice(6)) : undefined;

  const submitDirective = () => {
    const theme = matchTheme(directive);
    if (theme) {
      applyTheme(theme);
      setNoMatch(false);
    } else {
      setNoMatch(true);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-300/20 bg-amber-300/5 p-3">
        <p className="text-sm font-medium text-amber-200">Describe your style</p>
        <p className="mt-1 text-xs text-neutral-400">
          Type a directive like “Japandi”, “warm scandinavian” or “dark industrial”.
        </p>
        <div className="mt-2 flex gap-2">
          <input
            value={directive}
            onChange={(e) => {
              setDirective(e.target.value);
              setNoMatch(false);
            }}
            onKeyDown={(e) => e.key === 'Enter' && submitDirective()}
            placeholder="Japandi…"
            className="min-w-0 flex-1 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-amber-300/50"
          />
          <button
            type="button"
            onClick={submitDirective}
            className="rounded-md bg-amber-300 px-3 py-2 text-sm font-medium text-neutral-950 hover:bg-amber-200"
          >
            Apply
          </button>
        </div>
        {noMatch && (
          <p className="mt-1.5 text-xs text-amber-300/80">
            No curated theme matched — try one of the styles below.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {THEMES.map((theme) => (
          <ThemeCard
            key={theme.id}
            theme={theme}
            active={activeTheme?.id === theme.id}
            onClick={() => applyTheme(theme)}
          />
        ))}
      </div>

      {activeTheme && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-neutral-300">
            {activeTheme.name} variations
          </p>
          <div className="space-y-2">
            {generateThemeVariations(activeTheme, 3).map((v) => {
              const front = catalog.materials[v.materials.front];
              const worktop = catalog.materials[v.materials.worktop];
              const isActive =
                (materialOverrides.front ?? activeTheme.defaults.front) === v.materials.front &&
                (materialOverrides.worktop ?? activeTheme.defaults.worktop) === v.materials.worktop;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => applyThemeVariation(v.materials)}
                  className={`flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-xs hover:bg-white/5 ${
                    isActive ? 'border-amber-300/50 bg-amber-300/5' : 'border-white/10'
                  }`}
                >
                  <span className="flex -space-x-1">
                    <Swatch hex={front?.albedo} />
                    <Swatch hex={worktop?.albedo} />
                  </span>
                  <span className="flex-1 text-neutral-200">{v.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ThemeCard({
  theme,
  active,
  onClick,
}: {
  theme: AestheticTheme;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border p-3 text-left transition hover:bg-white/5 ${
        active ? 'border-amber-300/60 bg-amber-300/5' : 'border-white/10 bg-neutral-900/60'
      }`}
    >
      <span
        className="mb-2 block h-8 w-full rounded"
        style={{ background: theme.accent }}
        aria-hidden
      />
      <span className="block text-sm font-medium text-neutral-100">{theme.name}</span>
      <span className="mt-0.5 block text-[11px] text-neutral-500">{theme.mood}</span>
    </button>
  );
}

function Swatch({ hex }: { hex?: string }) {
  return (
    <span
      className="h-5 w-5 rounded-full border border-black/30"
      style={{ background: hex ?? '#888' }}
    />
  );
}
