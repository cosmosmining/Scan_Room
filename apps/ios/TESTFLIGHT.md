# TestFlight

Upload the iPad app to TestFlight from your Mac with one command, then install
it on any iPad from the TestFlight app. No cable, and no 7-day expiry.

## Once

1. **Join the Apple Developer Program** (paid, $99 a year) at
   [developer.apple.com/programs](https://developer.apple.com/programs/).
   A free Apple ID cannot upload to TestFlight.
2. In **Xcode → Settings → Accounts**, sign in with that Apple ID.
3. Find your **Team ID**: [developer.apple.com/account](https://developer.apple.com/account)
   → Membership details → Team ID. It is 10 letters and numbers.
4. **Create the app** in [App Store Connect](https://appstoreconnect.apple.com):
   Apps → **+** → New App.
   - Platform: iOS
   - Name: MOZU Scanner, or any name that is not already taken
   - Bundle ID: `com.mozu.scanner`
   - SKU: `mozu-scanner`

   If `com.mozu.scanner` is not in the Bundle ID list, run the upload command
   below once. It registers the ID, then stops at the upload step. Create the
   app, then run the command again.

## Upload (every time)

Replace `ABCDE12345` with your Team ID:

```bash
cd ~/Scan_Room && git fetch origin claude/laughing-johnson-r4gqkm && \
git checkout -B claude/laughing-johnson-r4gqkm origin/claude/laughing-johnson-r4gqkm && \
TEAM_ID=ABCDE12345 scripts/testflight.sh
```

It takes a few minutes. Every upload gets a new build number (the date and
time), so you can run it as often as you like.

## Install on the iPad

1. App Store Connect → your app → **TestFlight** → Internal Testing → **+**,
   and add yourself. You only need to do this once.
2. A build shows "Processing" for 5 to 30 minutes after the upload.
3. On the iPad, install **TestFlight** from the App Store and sign in with the
   same Apple ID. Then open the invite and tap **Install**. New builds appear
   there too.

## If something goes wrong

| What you see | Fix |
| --- | --- |
| "No Accounts" or "No signing certificate" | Xcode → Settings → Accounts: sign in with the Apple ID that has the paid membership. |
| "No suitable application records were found" | Create the app in App Store Connect with the same Bundle ID (step 4). |
| "An App ID with Identifier 'com.mozu.scanner' is not available" | Someone else owns that ID. Put `BUNDLE_ID=com.YOURNAME.mozuscanner` before `scripts/testflight.sh`, and create the app with that ID. |
| "Missing Compliance" on the build | Already answered in the app. If App Store Connect asks anyway, choose "None of the algorithms mentioned above". |
| Anything else | The full logs are in `apps/ios/build/testflight/`. |
