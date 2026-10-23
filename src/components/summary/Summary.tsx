'use client';

import Link from 'next/link';
import { useEffect, type ReactNode } from 'react';
import { formatMoney } from '@/lib/format';
import { useConfiguratorStore } from '@/state/useConfiguratorStore';
import { AddOnPicker } from './AddOnPicker';
import { BookDesignerForm } from './BookDesignerForm';
import { PriceBreakdownView } from './PriceBreakdownView';
import { ShareBar } from './ShareBar';

/** The UI summary page: itemized quote, add-ons, share link, designer handoff. */
export function Summary() {
  const pricing = useConfiguratorStore((s) => s.pricing);
  const recompute = useConfiguratorStore((s) => s.recomputePricing);
  const moduleCount = useConfiguratorStore((s) => s.instances.length);

  // Ensure the quote reflects the current configuration on entry.
  useEffect(() => recompute(), [recompute]);

  return (
    <div className="min-h-dvh bg-neutral-950 text-neutral-100">
      <header className="flex items-center justify-between border-b border-white/10 px-6 py-4">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-semibold tracking-tight">MOZU</span>
          <span className="text-xs text-neutral-400">Quote summary</span>
        </div>
        <Link href="/" className="text-sm text-neutral-400 hover:text-white">
          ← Back to configurator
        </Link>
      </header>

      <div className="mx-auto grid max-w-5xl gap-6 p-6 lg:grid-cols-[1.4fr_1fr]">
        <section className="space-y-6">
          <Card>
            <div className="mb-3 flex items-baseline justify-between">
              <CardTitle>Itemized breakdown</CardTitle>
              <span className="text-xs text-neutral-500">{moduleCount} modules</span>
            </div>
            <PriceBreakdownView breakdown={pricing} />
          </Card>
          <Card>
            <CardTitle>Add-ons</CardTitle>
            <div className="mt-3">
              <AddOnPicker />
            </div>
          </Card>
        </section>

        <aside className="space-y-6">
          <Card>
            <div className="text-xs text-neutral-500">Estimated total</div>
            <div className="mt-1 text-3xl font-semibold tabular-nums">
              {formatMoney(pricing.total, pricing.currency)}
            </div>
            <div className="mt-1 text-xs text-neutral-500">incl. installation, tax &amp; delivery</div>
          </Card>
          <Card>
            <CardTitle>Share</CardTitle>
            <div className="mt-3">
              <ShareBar />
            </div>
          </Card>
          <Card>
            <CardTitle>Book a designer</CardTitle>
            <div className="mt-3">
              <BookDesignerForm />
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Card({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-neutral-900/40 p-5">{children}</div>
  );
}

function CardTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
      {children}
    </h2>
  );
}
