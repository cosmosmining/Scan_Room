# Hosting MOZU so the iPad app works

To make the app do what the demo video shows, it needs a MOZU server it can
reach. Three ways, in order of how quickly you get there.

The app's server address is the **MOZU web address** field at the bottom of the
Floorplan screen. Whatever you set up below, put that URL there — no rebuild
needed, it is saved on the device.

---

## A. Same wifi as your Mac — 2 minutes, nothing to sign up for

Best for a demo in the office. The iPad talks straight to your laptop.

```bash
cd ~/Documents/mozu-configurator
npm install
npm run build
npx next start -p 3000 -H 0.0.0.0      # -H is what makes it reachable from the iPad
```

Find your Mac's address on the network:

```bash
ipconfig getifaddr en0                  # wifi;  try en1 if that prints nothing
```

In the app, set **MOZU web address** to `http://192.168.x.x:3000` (your number).
Then scan → *Send to MOZU web* → open the same URL on the laptop and type the code.

The app already carries the two Info.plist keys iOS needs to talk to a machine on
your own network over plain HTTP (`NSAllowsLocalNetworking` and a local-network
usage string), so iOS will ask permission once and then allow it. App Transport
Security stays fully in force for the public internet.

**Both devices must be on the same wifi**, and a guest network usually blocks
device-to-device traffic. If it does, use B.

---

## B. A public HTTPS URL from your laptop — 5 minutes

Works from anywhere, including cellular, and gives you real HTTPS. The server
still runs on your Mac; Cloudflare just puts a public address in front of it.

```bash
brew install cloudflared                # once

npx next start -p 3000                  # terminal 1
cloudflared tunnel --url http://localhost:3000   # terminal 2
```

Cloudflare prints something like `https://tidy-otter-1234.trycloudflare.com`.
Put **that** in the app's MOZU web address field.

The URL changes each time you start the tunnel, which is fine for a demo and
annoying for anything else — for a stable one, use C.

---

## C. Deploy it properly — Vercel + KV

For a URL that stays put and works when your laptop is shut.

```bash
npm i -g vercel
vercel                                  # first run links the project
vercel --prod
```

**Then add a KV store, and do not skip this step.** Vercel runs serverless, so
each request can hit a different instance. The default in-memory store cannot
work across instances: the upload files a scan on one instance and the lookup
asks a different one, so codes fail **intermittently** — which everyone will
blame on the iPad or the wifi rather than on the missing database.

In the Vercel dashboard: **Storage → Create → KV**, connect it to the project,
redeploy. Vercel injects `KV_REST_API_URL` and `KV_REST_API_TOKEN`; the server
picks them up automatically and logs `scan handoff: Redis/KV store` on boot.

Upstash Redis works identically — set `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN` instead.

If you deploy without KV, the server logs a warning at startup naming exactly
this problem. It does not fail silently.

---

## Check it works before you pick up the iPad

Against whatever URL you set up:

```bash
BASE=https://your-mozu-url

CODE=$(curl -s -X POST $BASE/api/scan-handoff \
  -H 'content-type: application/json' \
  -d '{"schema":"mozu.roomscan/1","polygon":[{"x":0,"z":0},{"x":4000,"z":0},{"x":4000,"z":3000},{"x":0,"z":3000}],"height":2500,"openings":[],"objects":[],"fixtures":[{"type":"socket","wall":0,"offset":900,"height":1100,"source":"detected","confidence":0.9}],"source":"roomplan","unitSystem":"metric","confidence":0.9,"capturedAt":"2026-01-01T00:00:00Z"}' \
  | sed 's/.*"code":"\([^"]*\)".*/\1/')

echo "code: $CODE"
curl -s "$BASE/api/scan-handoff?code=$CODE" | head -c 200
```

If the second command returns the room, the iPad will work. **Run it twice on a
serverless deploy** — an intermittent 404 is the signature of the missing KV
store, and it is much easier to diagnose here than on site.

---

## Installing the app on the iPad

```bash
cd ~/Documents/mozu-configurator/apps/ios
brew install xcodegen                   # once
xcodegen generate
open MozuScanner.xcodeproj
```

In Xcode: select the target → **Signing & Capabilities** → set your Team →
choose your iPad → **⌘R**.

On a **free** Apple ID the app stops launching after **7 days** and needs ⌘R
again to re-sign. A paid developer account ($99/yr) extends that to a year and
lets you distribute over TestFlight, which is what you want once other people
need to run it.

---

## Which store am I actually using?

The server says so on startup:

```
[mozu] scan handoff: in-memory store — correct for a single process. …
[mozu] scan handoff: Redis/KV store — safe on serverless and multi-instance.
[mozu] scan handoff: IN-MEMORY store on a serverless host. Handoff codes will fail intermittently…
```

The third line means the handoff will misbehave in a way that looks like a
network fault. Fix it before demonstrating anything.
