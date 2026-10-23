'use client';

import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { addOnList } from '@/systems/catalog';
import { useConfiguratorStore } from '@/state/useConfiguratorStore';

const rateLabel = (
  pricing: { kind: string; amount: number },
  currency: Parameters<typeof formatMoney>[1],
): string => {
  const money = formatMoney(pricing.amount, currency);
  if (pricing.kind === 'per-module') return `${money}/unit`;
  if (pricing.kind === 'per-meter') return `${money}/m`;
  return money;
};

export function AddOnPicker() {
  const catalog = useConfiguratorStore((s) => s.catalog);
  const selected = useConfiguratorStore((s) => s.selectedAddOnIds);
  const toggleAddOn = useConfiguratorStore((s) => s.toggleAddOn);
  const currency = useConfiguratorStore((s) => s.pricing.currency);

  return (
    <div className="space-y-2">
      {addOnList(catalog).map((addOn) => {
        const on = selected.includes(addOn.id);
        return (
          <button
            key={addOn.id}
            type="button"
            onClick={() => toggleAddOn(addOn.id)}
            className={cn(
              'flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left',
              on ? 'border-cyan-400/50 bg-cyan-500/10' : 'border-white/10 hover:bg-white/5',
            )}
          >
            <span className="min-w-0">
              <span className="block truncate text-sm text-neutral-200">{addOn.name}</span>
              <span className="block truncate text-xs text-neutral-500">
                {addOn.description} · {rateLabel(addOn.pricing, currency)}
              </span>
            </span>
            <span
              className={cn(
                'h-4 w-4 shrink-0 rounded border',
                on ? 'border-cyan-400 bg-cyan-400' : 'border-white/20',
              )}
            />
          </button>
        );
      })}
    </div>
  );
}
