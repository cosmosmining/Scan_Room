#!/usr/bin/env bash
#
# Start the MOZU render server AND a public Cloudflare tunnel, so the iPad can reach
# it from ANY network — same Wi-Fi, a different Wi-Fi, or cellular. No account, no
# router setup. Prints the public https URL to paste into the app's Photoreal sheet.
#
#   server/run-server.sh
#
# Requires: node, Blender, and (for the from-anywhere URL) cloudflared
#   brew install cloudflared
# Without cloudflared it falls back to printing your LAN address.

set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # repo root

BLENDER="${MOZU_BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
PORT="${PORT:-8787}"

bold() { printf "\033[1m%s\033[0m\n" "$*"; }

# Free the port (kill any leftover server) so we never hit EADDRINUSE.
lsof -ti tcp:"$PORT" 2>/dev/null | xargs kill -9 2>/dev/null || true

# Start the render server.
MOZU_BLENDER="$BLENDER" PORT="$PORT" node server/render-server.mjs &
SRV=$!
TUN=0
cleanup() { kill "$SRV" 2>/dev/null || true; [ "$TUN" -ne 0 ] && kill "$TUN" 2>/dev/null || true; }
trap 'cleanup; exit 0' INT TERM

# Wait for it to be healthy.
for _ in $(seq 1 20); do
  curl -sf "http://localhost:$PORT/health" >/dev/null 2>&1 && break
  sleep 1
done

if command -v cloudflared >/dev/null 2>&1; then
  echo "Opening a public tunnel (no account needed)…"
  : > /tmp/mozu-tunnel.log
  cloudflared tunnel --url "http://localhost:$PORT" >/tmp/mozu-tunnel.log 2>&1 &
  TUN=$!
  URL=""
  for _ in $(seq 1 40); do
    URL="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/mozu-tunnel.log | head -1)"
    [ -n "$URL" ] && break
    sleep 1
  done
  echo
  if [ -n "$URL" ]; then
    bold "════════════════════════════════════════════════════════"
    bold "  Paste this into the app's Photoreal → server address:"
    bold "      $URL"
    bold "  Works on ANY network (cellular too). Ctrl+C to stop."
    bold "════════════════════════════════════════════════════════"
  else
    echo "Tunnel didn't report a URL yet — check /tmp/mozu-tunnel.log"
  fi
else
  IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
  echo "cloudflared not installed — using your local network only."
  echo "In the app's Photoreal sheet use:  http://${IP:-<your-mac-ip>}:$PORT"
  echo "For a works-anywhere URL:  brew install cloudflared  then re-run this script."
fi

wait "$SRV"
