#!/usr/bin/env bash
#
# MOZU one-shot setup for macOS.
#
#   cd ~/mozu-configurator
#   git pull
#   ./setup-mac.sh
#
# It will: update the repo, install any missing tools (node, xcodegen, Blender),
# regenerate the Xcode project, compile-check the app, test-render the sample room,
# open the project in Xcode, and offer to start the render server.
#
# Safe to run multiple times. You still press ⌘R in Xcode yourself (device signing
# can't be scripted).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

bold() { printf "\n\033[1m%s\033[0m\n" "$*"; }
info() { printf "\033[36m▸ %s\033[0m\n" "$*"; }
ok()   { printf "\033[32m✓ %s\033[0m\n" "$*"; }
warn() { printf "\033[33m! %s\033[0m\n" "$*"; }
die()  { printf "\033[31m✗ %s\033[0m\n" "$*"; exit 1; }

# Free a TCP port by stopping whatever is listening on it (e.g. a render server
# left over from a previous run or our own one-off test) so we never hit EADDRINUSE.
free_port() {
  local p="$1" pids
  pids="$(lsof -ti tcp:"$p" 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    info "Port $p busy — stopping the process holding it…"
    kill $pids 2>/dev/null || true
    sleep 1
    pids="$(lsof -ti tcp:"$p" 2>/dev/null || true)"
    [[ -n "$pids" ]] && kill -9 $pids 2>/dev/null || true
  fi
}

BLENDER="/Applications/Blender.app/Contents/MacOS/Blender"
PROJECT="apps/ios/MozuScanner.xcodeproj"

bold "MOZU setup — $(pwd)"

# ── 0. platform ──
[[ "$(uname)" == "Darwin" ]] || warn "This script targets macOS; continuing anyway."

# ── 1. update repo ──
info "Updating repository…"
git pull --ff-only || warn "git pull skipped/failed — continuing with what's checked out."

# ── 2. Homebrew (prereq) ──
command -v brew >/dev/null 2>&1 || die "Homebrew not found. Install it from https://brew.sh then re-run."
ok "Homebrew present."

# ── 3. node ──
if ! command -v node >/dev/null 2>&1; then info "Installing node…"; brew install node; fi
ok "node $(node --version 2>/dev/null || echo '?')"

# ── 4. xcodegen ──
if ! command -v xcodegen >/dev/null 2>&1; then info "Installing xcodegen…"; brew install xcodegen; fi
ok "xcodegen present."

# ── 4b. cloudflared (public tunnel so the iPad needs no same-Wi-Fi) ──
if ! command -v cloudflared >/dev/null 2>&1; then info "Installing cloudflared…"; brew install cloudflared || warn "cloudflared install failed (LAN fallback)."; fi
command -v cloudflared >/dev/null 2>&1 && ok "cloudflared present." || warn "cloudflared missing — server will fall back to LAN."

# ── 5. generate the Xcode project (picks up new source files) ──
info "Generating the Xcode project…"
( cd apps/ios && xcodegen generate ) && ok "Generated $PROJECT" || die "xcodegen failed."

# ── 6. compile-check the app (iOS Simulator, no signing) ──
info "Compile-checking the app (this can take a minute)…"
if xcodebuild -project "$PROJECT" -scheme MozuScanner \
      -destination 'generic/platform=iOS Simulator' \
      -configuration Debug CODE_SIGNING_ALLOWED=NO build \
      > /tmp/mozu-build.log 2>&1; then
  ok "App compiles cleanly."
else
  warn "App did NOT compile. Last lines (full log: /tmp/mozu-build.log):"
  grep -E 'error:' /tmp/mozu-build.log | tail -n 20 || tail -n 20 /tmp/mozu-build.log
  warn "Send me these errors and I'll fix them. Continuing setup…"
fi

# ── 7. Blender (the photoreal render engine) ──
if [[ ! -x "$BLENDER" ]]; then
  info "Installing Blender (large download, one time)…"
  brew install --cask blender || warn "Blender install failed; the Photoreal button won't work until it's installed."
fi
[[ -x "$BLENDER" ]] && ok "Blender present." || warn "Blender not found at $BLENDER."

# ── 8. test-render the sample room ──
if [[ -x "$BLENDER" ]]; then
  free_port 8787
  info "Starting render server for a one-off test…"
  MOZU_BLENDER="$BLENDER" node server/render-server.mjs >/tmp/mozu-server.log 2>&1 &
  SRV=$!
  for _ in $(seq 1 30); do
    curl -sf http://localhost:8787/health >/dev/null 2>&1 && break
    sleep 1
  done
  info "Test-rendering server/sample-request.json (first render warms up Blender — be patient)…"
  if curl -sf --max-time 900 -X POST http://localhost:8787/render \
        -H 'content-type: application/json' \
        --data @server/sample-request.json -o /tmp/mozu.png; then
    ok "Sample render OK → /tmp/mozu.png"
    open /tmp/mozu.png 2>/dev/null || true
  else
    warn "Sample render failed. Server log:"; tail -n 25 /tmp/mozu-server.log
  fi
  kill "$SRV" 2>/dev/null || true
  wait "$SRV" 2>/dev/null || true
  free_port 8787
fi

# ── 9. open the project ──
info "Opening the Xcode project…"
open "$PROJECT" 2>/dev/null || warn "Could not open $PROJECT."

# ── 10. summary ──
IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
bold "── Next steps ──"
echo "  1) APP:    in Xcode, pick your iPad and press ⌘R."
echo "             (Set your Team under Signing & Capabilities if it asks.)"
echo "  2) SERVERS (one command runs BOTH render engines):"
echo "         server/run-all.sh"
echo "     • Photoreal → paste the public https URL it prints (works on any network)."
echo "     • Live      → tap Live in the app, enter  ${IP:-<your-mac-ip>}:8080"
echo "                   (or walk it in a browser: http://localhost:8788/live)"

# ── 11. offer to start both servers now ──
printf "\nStart BOTH render engines now? They keep running until you press Ctrl+C. [y/N] "
read -r ans || ans="N"
if [[ "${ans:-N}" =~ ^[Yy]$ ]]; then
  free_port 8787; free_port 8080; free_port 8788
  exec env MOZU_BLENDER="$BLENDER" bash server/run-all.sh
fi
ok "Setup complete."
