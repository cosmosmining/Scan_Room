#!/usr/bin/env bash
#
# MOZU LIVE — start the real-time EEVEE pixel-streaming engine on the Mac.
#
#   server/run-live.sh
#
# Starts a persistent Blender EEVEE TCP server (the engine the iPad streams from) and
# a browser bridge so you can walk the near-photoreal room on the Mac right now.
#   • Browser (Mac):  http://localhost:8788/live   — W/A/S/D + drag to look
#   • iPad LIVE mode: connect to  <mac-ip>:8080
#
# Needs: Blender (MOZU_BLENDER), node. Same LAN for the iPad.

set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

BLENDER="${MOZU_BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
STREAM_PORT="${MOZU_STREAM_PORT:-8080}"
HTTP_PORT="${PORT:-8788}"
SCENE="${1:-server/sample-request.json}"

lsof -ti tcp:"$STREAM_PORT" 2>/dev/null | xargs kill -9 2>/dev/null || true
lsof -ti tcp:"$HTTP_PORT"   2>/dev/null | xargs kill -9 2>/dev/null || true

echo "Starting Blender EEVEE stream engine on TCP :$STREAM_PORT (first build takes a moment)…"
"$BLENDER" --background --python scripts/ios/blender_stream_server.py -- \
  "$STREAM_PORT" "$SCENE" \
  apps/ios/MozuScanner/Resources/Models apps/ios/MozuScanner/Resources/Textures &
ENGINE=$!
trap 'kill $ENGINE 2>/dev/null || true; kill ${BRIDGE:-0} 2>/dev/null || true; exit 0' INT TERM

# Wait for the engine's TCP port to open.
for _ in $(seq 1 90); do
  if nc -z 127.0.0.1 "$STREAM_PORT" 2>/dev/null; then break; fi
  sleep 1
done

echo "Starting browser bridge…"
MOZU_STREAM_PORT="$STREAM_PORT" PORT="$HTTP_PORT" node server/live-render-server.mjs &
BRIDGE=$!

IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
echo
echo "════════════════════════════════════════════════════════"
echo "  MOZU LIVE running:"
echo "    Browser (Mac):   http://localhost:$HTTP_PORT/live"
echo "    iPad LIVE mode:  ${IP:-<your-mac-ip>}:$STREAM_PORT"
echo "  Ctrl+C to stop."
echo "════════════════════════════════════════════════════════"
wait $ENGINE
