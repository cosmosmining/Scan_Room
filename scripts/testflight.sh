#!/usr/bin/env bash
# Build the iPad app and upload it to TestFlight, in one go, on a Mac.
#
#   TEAM_ID=ABCDE12345 scripts/testflight.sh
#
# One-time setup — apps/ios/TESTFLIGHT.md:
#   * a paid Apple Developer Program membership, signed in to Xcode
#     (Xcode → Settings → Accounts);
#   * the app created in App Store Connect with bundle ID com.mozu.scanner
#     (or set BUNDLE_ID to the one you created it with).
#
# Instead of the Xcode sign-in, an App Store Connect API key can be used:
#   ASC_KEY_ID, ASC_ISSUER_ID, and ASC_KEY_PATH (the .p8 file).
#
# Every upload needs a new build number; it is the date and time, so two
# uploads never clash. Set BUILD_NUMBER to choose one.
#
# Written for the bash macOS ships (3.2).
set -euo pipefail

: "${TEAM_ID:?Set TEAM_ID to your Apple Developer Team ID — developer.apple.com/account → Membership details}"
BUNDLE_ID="${BUNDLE_ID:-com.mozu.scanner}"
BUILD="${BUILD_NUMBER:-$(date +%Y%m%d%H%M)}"

cd "$(dirname "$0")/../apps/ios"
command -v xcodegen >/dev/null 2>&1 || brew install xcodegen
xcodegen generate

OUT="build/testflight"
rm -rf "$OUT"
mkdir -p "$OUT"

AUTH=()
if [ -n "${ASC_KEY_ID:-}" ] && [ -n "${ASC_ISSUER_ID:-}" ] && [ -n "${ASC_KEY_PATH:-}" ]; then
  AUTH=(-authenticationKeyPath "$ASC_KEY_PATH" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
fi

# Xcode 15.3 renamed the App Store export method.
XCODE_VERSION="$(xcodebuild -version | awk 'NR==1 { print $2 }')"
IFS=. read -r XMAJOR XMINOR _ <<< "$XCODE_VERSION.0.0"
METHOD=app-store-connect
if [ "$XMAJOR" -lt 15 ] || { [ "$XMAJOR" -eq 15 ] && [ "${XMINOR:-0}" -lt 3 ]; }; then METHOD=app-store; fi

# Run a step quietly into a log; on failure show its end.
step() {
  local name="$1" log="$2"
  shift 2
  echo "▸ $name…"
  set +e
  "$@" > "$log" 2>&1
  local status=$?
  set -e
  if [ "$status" -ne 0 ]; then
    grep -E 'error:|Error Domain|No (profiles|Account)|failed' "$log" | tail -20 || true
    echo "✗ $name failed — the full log is apps/ios/$log"
    exit "$status"
  fi
}

step "Archiving MOZU Scanner $BUILD ($BUNDLE_ID, team $TEAM_ID, Xcode $XCODE_VERSION)" "$OUT/archive.log" \
  xcodebuild \
    -project MozuScanner.xcodeproj \
    -scheme MozuScanner \
    -configuration Release \
    -destination 'generic/platform=iOS' \
    -archivePath "$OUT/MozuScanner.xcarchive" \
    -allowProvisioningUpdates ${AUTH[@]+"${AUTH[@]}"} \
    DEVELOPMENT_TEAM="$TEAM_ID" \
    PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE_ID" \
    CURRENT_PROJECT_VERSION="$BUILD" \
    CODE_SIGN_STYLE=Automatic \
    archive

cat > "$OUT/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>method</key>
	<string>$METHOD</string>
	<key>destination</key>
	<string>upload</string>
	<key>teamID</key>
	<string>$TEAM_ID</string>
	<key>signingStyle</key>
	<string>automatic</string>
	<key>uploadSymbols</key>
	<true/>
	<key>manageAppVersionAndBuildNumber</key>
	<false/>
</dict>
</plist>
PLIST

step "Signing for the App Store and uploading to App Store Connect" "$OUT/upload.log" \
  xcodebuild \
    -exportArchive \
    -archivePath "$OUT/MozuScanner.xcarchive" \
    -exportOptionsPlist "$OUT/ExportOptions.plist" \
    -exportPath "$OUT/export" \
    -allowProvisioningUpdates ${AUTH[@]+"${AUTH[@]}"}

echo "✓ Uploaded MOZU Scanner build $BUILD."
echo "  In 5–30 minutes it appears in App Store Connect → Apps → MOZU Scanner → TestFlight."
echo "  Add yourself under Internal Testing once; then install it from the TestFlight app on the iPad."
