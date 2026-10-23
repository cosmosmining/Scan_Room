/**
 * POST a RoomScan, get a short code back.
 *
 * This is the iPad's half of the handoff. The app finishes a scan, sends the
 * same JSON it would have put in a deep link, and shows the code it gets back;
 * the person types that code on the website and lands on their room.
 *
 *   POST /api/scan-handoff   { "scan": <RoomScan> }
 *     → 201 { "code": "B7K4M2", "url": "https://…/scan/B7K4M2", "expiresAt": … }
 *
 *   GET  /api/scan-handoff?code=B7K4M2
 *     → 200 { "scan": <RoomScan> }   |   404 { "error": … }
 *
 * The scan is validated by the SDK's own parser before it is stored, so a
 * malformed payload fails here — at the moment it can still be reported to the
 * person holding the iPad — rather than three screens later in the configurator.
 */

import { NextResponse } from 'next/server';
import { parseScan } from '@mozu/scan-sdk';
import {
  MAX_SCAN_BYTES,
  fetchScan,
  handoffUrl,
  storeScan,
  HANDOFF_TTL_MS,
} from '@/systems/handoff/scanHandoff';
import { resolveHandoffStore } from '@/systems/handoff/store';

export const runtime = 'nodejs';
// The store is per-process, so this route must not be pre-rendered or cached.
export const dynamic = 'force-dynamic';

/**
 * Redis/KV when it is configured, memory otherwise — resolved per request so a
 * platform that injects env vars late still gets the right one, and cached
 * inside the resolver so it is not rebuilt on every call.
 */
const store = () => resolveHandoffStore();

export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > MAX_SCAN_BYTES) {
    return NextResponse.json(
      { error: `Scan too large (${raw.length} bytes, limit ${MAX_SCAN_BYTES}).` },
      { status: 413 },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Body is not JSON.' }, { status: 400 });
  }

  // Accept either { scan: … } or a bare RoomScan, because both are things a
  // client will reasonably send and neither is ambiguous.
  const candidate =
    body && typeof body === 'object' && 'scan' in (body as Record<string, unknown>)
      ? (body as { scan: unknown }).scan
      : body;

  // `parseScan` validates the WIRE FORM, so it is handed text either way — the
  // same function the deep link uses, so there is one definition of "valid".
  const scan = parseScan(typeof candidate === 'string' ? candidate : JSON.stringify(candidate));
  if (!scan) {
    return NextResponse.json(
      { error: 'Not a valid mozu.roomscan/1 payload.' },
      { status: 422 },
    );
  }

  let code: string;
  try {
    code = await storeScan(store(), scan);
  } catch (error) {
    // The iPad is the only place this can be reported usefully — the person
    // holding it can retry, and knows nothing about our Redis.
    return NextResponse.json(
      { error: `Could not file the scan: ${(error as Error).message}` },
      { status: 503 },
    );
  }
  const origin = new URL(req.url).origin;
  return NextResponse.json(
    {
      code,
      url: handoffUrl(origin, code),
      expiresAt: new Date(Date.now() + HANDOFF_TTL_MS).toISOString(),
      rooms: 1,
      fixtures: scan.fixtures?.length ?? 0,
    },
    { status: 201 },
  );
}

export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get('code');
  if (!code) {
    return NextResponse.json({ error: 'Missing ?code=' }, { status: 400 });
  }
  const scan = await fetchScan(store(), code);
  if (!scan) {
    return NextResponse.json(
      { error: 'No scan for that code — it may have expired.' },
      { status: 404 },
    );
  }
  return NextResponse.json({ scan });
}
