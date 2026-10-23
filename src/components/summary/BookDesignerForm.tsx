'use client';

import { useState, type FormEvent, type InputHTMLAttributes } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { selectConfiguration } from '@/state/selectors';
import { useConfiguratorStore } from '@/state/useConfiguratorStore';
import { buildExport, type BookingRequest } from '@/systems/handoff';

interface FormState {
  name: string;
  email: string;
  phone: string;
  preferredDate: string;
  message: string;
}

const EMPTY: FormState = { name: '', email: '', phone: '', preferredDate: '', message: '' };

/** Designer handoff. Submitting bundles the configuration + quote into a
 *  QuoteExport (the export schema); a Supabase POST wires in where noted. */
export function BookDesignerForm() {
  const config = useConfiguratorStore(useShallow(selectConfiguration));
  const room = useConfiguratorStore((s) => s.room);
  const pricing = useConfiguratorStore((s) => s.pricing);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [reference, setReference] = useState<string | null>(null);

  const set =
    (key: keyof FormState) =>
    (e: { target: { value: string } }) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const booking: BookingRequest = { ...form, submittedAt: new Date().toISOString() };
    const exp = buildExport({ config, room, pricing, booking });
    // Handoff seam: await supabase.from('bookings').insert(exp)
    console.info('[MOZU] Booking request', exp);
    setReference(exp.configurationId);
  };

  if (reference) {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
        Thanks{form.name ? `, ${form.name}` : ''}! A designer will be in touch. Your
        reference is <code className="font-mono">{reference}</code>.
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Name" required value={form.name} onChange={set('name')} />
      <Field label="Email" type="email" required value={form.email} onChange={set('email')} />
      <Field label="Phone" type="tel" value={form.phone} onChange={set('phone')} />
      <Field label="Preferred date" type="date" value={form.preferredDate} onChange={set('preferredDate')} />
      <label className="block">
        <span className="mb-1 block text-xs text-neutral-400">Message</span>
        <textarea
          rows={3}
          value={form.message}
          onChange={set('message')}
          className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-cyan-400/50"
        />
      </label>
      <button
        type="submit"
        className="w-full rounded-md bg-cyan-500 px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-cyan-400"
      >
        Book a designer
      </button>
    </form>
  );
}

function Field({ label, ...props }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-neutral-400">{label}</span>
      <input
        {...props}
        className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-cyan-400/50"
      />
    </label>
  );
}
