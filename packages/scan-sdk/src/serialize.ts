/**
 * Wire format for a {@link RoomScan}: a compact, URL-safe payload plus the
 * `/scan` deep link the native apps and extensions use to hand a measured room
 * to the MOZU web app. The `poly`/`h` params stay backward-compatible with the
 * existing web `/scan` route; `scan` carries the richer payload (openings,
 * objects) when present.
 */
import { ROOMSCAN_SCHEMA } from './types';
import type { RoomScan, ScanSource, UnitSystem, Vec2 } from './types';

const toBase64Url = (s: string): string => {
  const b64 =
    typeof btoa === 'function'
      ? btoa(unescape(encodeURIComponent(s)))
      : Buffer.from(s, 'utf8').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (s: string): string => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const text =
    typeof atob === 'function'
      ? decodeURIComponent(escape(atob(b64)))
      : Buffer.from(b64, 'base64').toString('utf8');
  return text;
};

/** Round-trippable JSON of a scan (millimetres preserved). */
export function serializeScan(scan: RoomScan): string {
  return JSON.stringify(scan);
}

/** Parse a serialized scan; returns null if it isn't a valid v1 RoomScan. */
export function parseScan(input: string): RoomScan | null {
  try {
    const raw = input.trim().startsWith('{') ? input : fromBase64Url(input);
    const data = JSON.parse(raw) as Partial<RoomScan>;
    if (!Array.isArray(data.polygon) || data.polygon.length < 3) return null;
    const polygon = data.polygon
      .map((p) => ({ x: Number(p.x), z: Number(p.z) }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.z));
    if (polygon.length < 3) return null;
    return {
      schema: ROOMSCAN_SCHEMA,
      polygon,
      height: Number(data.height) || 2700,
      openings: Array.isArray(data.openings) ? data.openings : [],
      objects: Array.isArray(data.objects) ? data.objects : [],
      fixtures: Array.isArray(data.fixtures) ? data.fixtures : [],
      source: (data.source as ScanSource) ?? 'manual',
      unitSystem: (data.unitSystem as UnitSystem) ?? 'metric',
      confidence: typeof data.confidence === 'number' ? data.confidence : 0.8,
      capturedAt: typeof data.capturedAt === 'string' ? data.capturedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

const polyParam = (polygon: Vec2[]): string =>
  polygon.map((p) => `${Math.round(p.x)},${Math.round(p.z)}`).join(';');

/**
 * Build the MOZU `/scan` deep link for a measured room.
 *   `…/scan?poly=0,0;4000,0;4000,3000;0,3000&h=2700`        (always)
 *   `…&scan=<base64url>`                                     (if openings/objects)
 */
export function handoffUrl(webBase: string, scan: RoomScan): string {
  const base = webBase.replace(/\/+$/, '');
  const params = new URLSearchParams();
  params.set('poly', polyParam(scan.polygon));
  params.set('h', String(Math.round(scan.height)));
  params.set('src', scan.source);
  if (scan.openings.length || scan.objects.length || scan.fixtures?.length) {
    params.set('scan', toBase64Url(serializeScan(scan)));
  }
  return `${base}/scan?${params.toString()}`;
}

/** Read a scan back from `/scan` URL params (the web route's ingest side). */
export function scanFromParams(search: string | URLSearchParams): RoomScan | null {
  const p = typeof search === 'string' ? new URLSearchParams(search) : search;
  const rich = p.get('scan');
  if (rich) {
    const parsed = parseScan(rich);
    if (parsed) return parsed;
  }
  const height = Number(p.get('h')) || 2700;
  const unitSystem: UnitSystem = 'metric';
  const source = (p.get('src') as ScanSource) ?? 'manual';
  const poly = p.get('poly');
  if (poly) {
    const polygon = poly
      .split(';')
      .map((s) => {
        const [x, z] = s.split(',').map(Number);
        return { x, z };
      })
      .filter((v) => Number.isFinite(v.x) && Number.isFinite(v.z));
    if (polygon.length >= 3) {
      return {
        schema: ROOMSCAN_SCHEMA,
        polygon,
        height,
        openings: [],
        objects: [],
        source,
        unitSystem,
        confidence: 0.9,
        capturedAt: new Date().toISOString(),
      };
    }
  }
  const w = Number(p.get('w'));
  const d = Number(p.get('d'));
  if (w > 0 && d > 0) {
    return {
      schema: ROOMSCAN_SCHEMA,
      polygon: [
        { x: 0, z: 0 },
        { x: w, z: 0 },
        { x: w, z: d },
        { x: 0, z: d },
      ],
      height,
      openings: [],
      objects: [],
      source,
      unitSystem,
      confidence: 0.85,
      capturedAt: new Date().toISOString(),
    };
  }
  return null;
}
