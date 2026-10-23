/**
 * Proxy a photoreal render to the MOZU render server.
 *
 * The browser cannot POST straight at the render box: it is usually on a LAN or
 * behind a firewall with no CORS headers and no TLS, and a page served over
 * HTTPS may not talk to it at all. The iPad has no such restriction, which is
 * why it calls the server directly and the web needs this.
 *
 * Set MOZU_RENDER_SERVER (e.g. http://192.168.1.20:8787). Without it the route
 * says so plainly rather than failing as a generic 500 — "no render server
 * configured" is a five-second fix; "500" is an afternoon.
 *
 * A final render path-traces for minutes before returning a byte, so this
 * streams the upstream response back untouched and sets no timeout of its own.
 */

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// A hero-shot render can take many minutes; the platform cap matters more than
// this number, but asking for the maximum is the right ask.
export const maxDuration = 800;

export async function POST(req: Request) {
  const server = process.env.MOZU_RENDER_SERVER?.replace(/\/+$/, '');
  if (!server) {
    return NextResponse.json(
      {
        error:
          'No render server configured. Set MOZU_RENDER_SERVER (for example ' +
          'http://192.168.1.20:8787) and restart.',
      },
      { status: 503 },
    );
  }

  const body = await req.text();
  let upstream: Response;
  try {
    upstream = await fetch(`${server}/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Could not reach the render server at ${server}: ${(error as Error).message}` },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    return NextResponse.json(
      { error: detail || `Render server returned ${upstream.status}.` },
      { status: upstream.status },
    );
  }

  // Hand the image straight back — no buffering, no re-encoding.
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'image/png',
      'cache-control': 'no-store',
    },
  });
}
