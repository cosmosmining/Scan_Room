#!/usr/bin/env bash
# Build the Swift ⇄ TypeScript parity harness from the iPad app's own sources.
#
#   scripts/swift-parity.sh                  # builds .cache/swift-parity/parity
#   SWIFT_PARITY_BIN=.cache/swift-parity/parity npx vitest run swiftParity
#
# Needs a Swift 5.9+ toolchain (macOS with Xcode, or swift.org on Linux). Only
# the platform-free files are compiled — the ones whose logic has a TypeScript
# twin — so no ARKit or RoomPlan is involved and it builds anywhere.
set -euo pipefail
cd "$(dirname "$0")/.."

APP=apps/ios/MozuScanner
OUT=.cache/swift-parity
mkdir -p "$OUT"

SOURCES=(
  "$APP/Models/RoomScan.swift"
  "$APP/Floorplan/Floorplan.swift"
  "$APP/Scan/WallLoop.swift"
  "$APP/Scan/GlassFinder.swift"
  "$APP/Scan/SocketDetector.swift"
  apps/ios/ParityHarness/main.swift
)

EXTRA=()
if [[ "$(uname -s)" != "Darwin" ]]; then
  # Linux has no CoreGraphics module; give Floorplan.swift a stand-in.
  swiftc -parse-as-library -emit-library -static \
    -module-name CoreGraphics \
    -emit-module-path "$OUT/CoreGraphics.swiftmodule" \
    apps/ios/ParityHarness/Shims/CoreGraphics.swift \
    -o "$OUT/libCoreGraphics.a"
  EXTRA=(-I "$OUT" -static-stdlib)
fi

swiftc -swift-version 5 -O "${EXTRA[@]}" "${SOURCES[@]}" -o "$OUT/parity"
echo "built $OUT/parity"
