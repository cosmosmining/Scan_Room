import type { ReactNode } from 'react';
import { formatMoney } from '@/lib/format';
import type { PriceBreakdown } from '@/lib/types';

/** Itemized cost breakdown: modules, add-ons, installation, tax/delivery, total. */
export function PriceBreakdownView({ breakdown }: { breakdown: PriceBreakdown }) {
  const { currency } = breakdown;
  const money = (v: number) => formatMoney(v, currency);
  const preTax =
    breakdown.itemsSubtotal + breakdown.addOnsSubtotal + breakdown.installation;

  return (
    <div className="text-sm">
      {/* Modules */}
      <Section title="Modules">
        {breakdown.lineItems.length === 0 ? (
          <p className="px-1 py-2 text-neutral-500">No modules yet.</p>
        ) : (
          breakdown.lineItems.map((li) => (
            <Row key={li.moduleInstanceId} label={li.label} value={money(li.subtotal)} />
          ))
        )}
        <Row label="Subtotal" value={money(breakdown.itemsSubtotal)} strong />
      </Section>

      {/* Add-ons */}
      {breakdown.addOns.length > 0 && (
        <Section title="Add-ons">
          {breakdown.addOns.map((a) => (
            <Row key={a.addOnId} label={a.label} hint={a.detail} value={money(a.amount)} />
          ))}
          <Row label="Subtotal" value={money(breakdown.addOnsSubtotal)} strong />
        </Section>
      )}

      {/* Totals */}
      <Section title="Estimate">
        <Row label="Installation" value={money(breakdown.installation)} />
        {breakdown.modifiers.map((m) => {
          const amount =
            m.kind === 'tax'
              ? Math.round(preTax * (m.rate ?? 0))
              : (m.amount ?? 0);
          return <Row key={m.id} label={m.label} value={money(amount)} />;
        })}
        <Row label="Total" value={money(breakdown.total)} total />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-t border-white/10 py-3 first:border-t-0">
      <h4 className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        {title}
      </h4>
      {children}
    </div>
  );
}

function Row({
  label,
  value,
  hint,
  strong,
  total,
}: {
  label: string;
  value: string;
  hint?: string;
  strong?: boolean;
  total?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-3 px-1 py-1 ${
        total ? 'mt-1 border-t border-white/10 pt-2 text-base font-semibold text-white' : ''
      } ${strong && !total ? 'font-medium text-neutral-200' : 'text-neutral-300'}`}
    >
      <span className="truncate">
        {label}
        {hint && <span className="ml-2 text-xs text-neutral-500">{hint}</span>}
      </span>
      <span className="shrink-0 tabular-nums">{value}</span>
    </div>
  );
}
