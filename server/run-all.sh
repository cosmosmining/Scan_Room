#!/usr/bin/env bash
#
# MOZU — run EVERYTHING the Mac side needs, one command.
#
#   server/run-all.sh
#
# Starts both render engines and keeps them running until Ctrl+C:
#   • PHOTOREAL (hero shots)      — Blender Cycles render server on :8787
#       + a public Cloudflare tunnel (works on ANY network) when cloudflared is present
#   • LIVE (real-time walkthrough) — Blender EEVEE stream engine on :8080
#       + a browser viewport on :8788  (same LAN)
#
# In the app:  Photoreal → paste the https tunnel URL ·  Live → enter <mac-ip>:8080
# On the Mac:  open http://localhost:8788/live to walk the room in a browser.
#
# Needs: node, Blender (MOZU_BLENDER). cloudflared is optional (LAN fallback).

set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # repo root

BLENDER="${MOZU_BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
RENDER_PORT="${MOZU_RENDER_PORT:-8787}"
STREAM_PORT="${MOZU_STREAM_PORT:-8080}"
HTTP_PORT="${MOZU_LIVE_HTTP_PORT:-8788}"
SCENE="${1:-server/sample-request.json}"

bold() { printf "\033[1m%s\033[0m\n" "$*"; }

[[ -x "$BLENDER" ]] || bold "! Blender not found at $BLENDER — set MOZU_BLENDER. Continuing anyway."

# Free every port we use so we never hit EADDRINUSE.
for p in "$RENDER_PORT" "$STREAM_PORT" "$HTTP_PORT"; do
  lsof -ti tcp:"$p" 2>/dev/null | xargs kill -9 2>/dev/null || true
done

PIDS=()
cleanup() { for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done; exit 0; }
trap cleanup INT TERM

# ── 1. PHOTOREAL — Cycles render server (spawns Blender per request) ──
echo "Starting Photoreal render server on :$RENDER_PORT…"
MOZU_BLENDER="$BLENDER" PORT="$RENDER_PORT" node server/render-server.mjs >/tmp/mozu-render.log 2>&1 &
PIDS+=($!)

# Optional public tunnel so the iPad reaches the render server from any network.
HAVE_TUN=0
if command -v cloudflared >/dev/null 2>&1; then
  HAVE_TUN=1
  : > /tmp/mozu-tunnel.log
  cloudflared tunnel --url "http://localhost:$RENDER_PORT" >/tmp/mozu-tunnel.log 2>&1 &
  PIDS+=($!)
fi

# ── 2. LIVE — resident EEVEE stream engine + browser bridge ──
echo "Starting Live EEVEE stream engine on :$STREAM_PORT (first build takes a moment)…"
"$BLENDER" --background --python scripts/ios/blender_stream_server.py -- \
  "$STREAM_PORT" "$SCENE" \
  apps/ios/MozuScanner/Resources/Models apps/ios/MozuScanner/Resources/Textures \
  >/tmp/mozu-stream.log 2>&1 &
PIDS+=($!)

# Wait for the stream engine's TCP port to open.
for _ in $(seq 1 90); do nc -z 127.0.0.1 "$STREAM_PORT" 2>/dev/null && break; sleep 1; done

echo "Starting Live browser bridge on :$HTTP_PORT…"
MOZU_STREAM_PORT="$STREAM_PORT" PORT="$HTTP_PORT" node server/live-render-server.mjs >/tmp/mozu-bridge.log 2>&1 &
PIDS+=($!)

# Resolve the tunnel URL if we started one.
TUN_URL=""
if [[ "$HAVE_TUN" -eq 1 ]]; then
  for _ in $(seq 1 40); do
    TUN_URL="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/mozu-tunnel.log | head -1)"
    [ -n "$TUN_URL" ] && break
    sleep 1
  done
fi

IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"

echo
bold "════════════════════════════════════════════════════════════"
bold "  MOZU is running — leave this window open. Ctrl+C to stop."
echo
bold "  PHOTOREAL (hero shots) — app › Photoreal › server address:"
if [ -n "$TUN_URL" ]; then
  bold "      $TUN_URL"
  echo  "      (works on ANY network — same Wi-Fi, other Wi-Fi, or cellular)"
else
  bold "      http://${IP:-<your-mac-ip>}:$RENDER_PORT"
  echo  "      (same Wi-Fi only — for a works-anywhere URL: brew install cloudflared, re-run)"
fi
echo
bold "  LIVE (real-time walkthrough):"
bold "      iPad  › tap Live › enter   ${IP:-<your-mac-ip>}:$STREAM_PORT"
bold "      Mac browser test           http://localhost:$HTTP_PORT/live"
echo  "      (same LAN — Live is a raw TCP socket, so a tunnel doesn't apply)"
bold "════════════════════════════════════════════════════════════"
echo  "  Logs:  /tmp/mozu-render.log · /tmp/mozu-stream.log · /tmp/mozu-bridge.log"
echo

wait
