import type { Currency } from './types';

export const APP_NAME = 'MOZU';
export const APP_TAGLINE = 'Modular Living System Configurator';

export const DEFAULT_CURRENCY: Currency = 'USD';

/** Ordered configurator steps. Drives the step navigation bar. */
export type StepId = 'room' | 'layout' | 'modules' | 'style' | 'review';

export interface StepDef {
  id: StepId;
  label: string;
  description: string;
}

export const STEPS: StepDef[] = [
  { id: 'room', label: 'Room', description: 'Define your space' },
  { id: 'layout', label: 'Layout', description: 'Choose an arrangement' },
  { id: 'modules', label: 'Modules', description: 'Add cabinets & units' },
  { id: 'style', label: 'Style', description: 'Pick finishes' },
  { id: 'review', label: 'Review', description: 'Pricing & handoff' },
];
