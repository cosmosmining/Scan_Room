import type { PriceBreakdown, Room } from '@/lib/types';
import type { ProjectConfiguration } from '@/systems/config';

export const EXPORT_SCHEMA_VERSION = 1 as const;

/** Customer details captured by the "Book Designer" form. */
export interface BookingRequest {
  name: string;
  email: string;
  phone?: string;
  preferredDate?: string; // ISO date
  message?: string;
  submittedAt: string;
}

/**
 * Full handoff payload — design + quote + optional booking. This is the export
 * schema persisted to Supabase, sent to a designer, or downloaded as JSON.
 */
export interface QuoteExport {
  schemaVersion: typeof EXPORT_SCHEMA_VERSION;
  app: 'MOZU';
  configurationId: string;
  createdAt: string;
  room: Room;
  configuration: ProjectConfiguration;
  pricing: PriceBreakdown;
  booking?: BookingRequest;
}

/** Module tree node stripped of ids/transforms — content-addressed. */
export interface CanonicalNode {
  definitionId: string;
  width?: number;
  wallId?: string;
  materials: ProjectConfiguration['materialOverrides'];
  options: string[];
  children: CanonicalNode[];
}

/** Compact, recomputable payload for share links (no derived data). */
export interface SharePayload {
  v: typeof EXPORT_SCHEMA_VERSION;
  styleId: string;
  materialOverrides: ProjectConfiguration['materialOverrides'];
  selectedAddOnIds: string[];
  room: Room;
  tree: CanonicalNode[];
}
