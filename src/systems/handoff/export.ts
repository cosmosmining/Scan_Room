import type { PriceBreakdown, Room } from '@/lib/types';
import type { ProjectConfiguration } from '@/systems/config';
import { configurationId } from './id';
import {
  EXPORT_SCHEMA_VERSION,
  type BookingRequest,
  type QuoteExport,
} from './types';

/** Assemble the full handoff payload (export schema). */
export function buildExport(args: {
  config: ProjectConfiguration;
  room: Room;
  pricing: PriceBreakdown;
  booking?: BookingRequest;
}): QuoteExport {
  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    app: 'MOZU',
    configurationId: configurationId(args.config),
    createdAt: new Date().toISOString(),
    room: args.room,
    configuration: args.config,
    pricing: args.pricing,
    booking: args.booking,
  };
}

export const exportToJson = (exp: QuoteExport): string =>
  JSON.stringify(exp, null, 2);
