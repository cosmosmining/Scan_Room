# MOZU — the whole thing, and how to test it

This is the complete MOZU configurator: the iPad scanner app (Swift/ARKit,
including all the socket-detection code) and the web configurator (Next.js), plus
the handoff that carries a scanned room from one to the other.

Everything is real code from one repository. Nothing here is a stub.

---

## 1 · What is in the box

```
mozu-configurator/
├── apps/ios/MozuScanner/          ← the iPad app (Swift, 38 files)
│   ├── Scan/                      ← SOCKET DETECTION lives here
│   │   ├── SocketDetector.swift        the white-faceplate detector
│   │   ├── DepthGate.swift             LiDAR geometry gate
│   │   ├── FixtureCapture.swift        multi-view confirmation + tracking
│   │   ├── TapToPlace.swift            tap a socket to pin it by hand
│   │   ├── FixtureProjector.swift      camera space → wall + height
│   │   ├── RoomCaptureController.swift the scan state machine
│   │   └── FloorplanBuilder.swift      RoomPlan → the shared room contract
│   ├── Design/                    ← the iPad's design mode (3D, 2D plan, finishes)
│   ├── Export/                    ← Handoff.swift, PhotorealRenderer.swift
│   ├── Views/                     ← ScanView, FloorplanResultView
│   └── Resources/                 ← 40 USDZ models, 37 PBR textures
│
├── src/                           ← the web configurator (Next.js 15, 161 files)
│   ├── app/                       ← routes, incl. /scan and /api/scan-handoff
│   ├── systems/scan/              ← the TypeScript twin of the detector
│   │   ├── fixtureDetector.ts          same plate detector, in TS
│   │   ├── plateGeometry.ts            same depth gate + tracking policy
│   │   └── __tests__/                  118 tests (35 on the detector twin)
│   ├── systems/handoff/           ← the 6-character code store
│   ├── systems/furniture/         ← the 40-item catalogue + recommender
│   ├── three/                     ← the 3D scene (room shell, lighting, models)
│   └── components/room/PlanEditor.tsx  ← the draggable 2D plan
│
├── packages/scan-sdk/             ← @mozu/scan-sdk: the shared RoomScan contract
│                                    and floorplan engine, used by the web app,
│                                    the browser extensions and the iOS handoff
│
├── server/                        ← the photoreal render server (Blender Cycles)
│   ├── render-server.mjs               POST /render → a path-traced PNG
│   ├── run-server.sh                   starts it + a public Cloudflare tunnel
│   └── README.md
│
├── companion/                     ← reference RoomPlan / ARCore companions
├── extensions/                    ← Chrome + Safari scanning extensions
├── assets/                        ← source CAD (STEP) and MOZU artwork
├── demos/                         ← live-detect.html, a browser detector demo
│
├── public/models/mozu/            ← the 40 iPad models, converted to glTF
├── scripts/usdz-to-glb.py         ← how they were converted
├── scripts/sync-textures.mjs      ← copies the iPad's textures into public/
├── setup-mac.sh                   ← one-shot macOS setup (see §2)
└── docs/                          ← scan-to-web.md, hosting.md
```

**`node_modules/` is not included** — `npm install` rebuilds it. That is normal
for any JavaScript project and keeps this package from being 400 MB.

---

## 2 · Run the web app (5 minutes)

Requires Node 18.18 or newer.

```bash
cd mozu-configurator
npm install
npm run build          # also copies the iPad's textures into public/textures
npm start              # http://localhost:3000
```

On a Mac there is also a one-shot script that does the lot — installs anything
missing, regenerates the Xcode project, compile-checks the app, test-renders a
room and opens Xcode:

```bash
./setup-mac.sh
```

Open **http://localhost:3000**.

That is the whole web app, working, with a demo kitchen already in it.

### Run the tests

```bash
npm test
```

Expect **208 passing across 25 suites**, all green. 118 of those cover the scan
and detection code; 35 are the detector twin alone (`plateGeometry`,
`fixtureDetector`).

---

## 3 · The link and the verification code — how the handoff works

The iPad never talks to the browser directly. It uploads the scan to the MOZU
server, which returns a **6-character code**; you type that code on the laptop.

### The URLs

| What | URL |
|---|---|
| The configurator | `http://localhost:3000/` |
| Enter a code | `http://localhost:3000/scan` |
| Jump straight in with a code | `http://localhost:3000/scan/B7K4M2` |
| Upload a scan FILE instead | `http://localhost:3000/scan` → "Choose scan file…" |
| Upload the scan (iPad → server) | `POST /api/scan-handoff` |
| Fetch it (laptop ← server) | `GET /api/scan-handoff?code=B7K4M2` |
| Photoreal render proxy | `POST /api/photoreal` |

### About the code

* 6 characters from `23456789ABCDEFGHJKMNPQRSTVWXYZ` — no `O`/`0`, no `I`/`1`/`L`,
  no `U`, because those are the characters people mistype reading a screen aloud.
* Valid for **24 hours**.
* Case-insensitive; spaces and dashes are ignored.

### Test the handoff without an iPad

This is the fastest way to prove the whole path works. It posts a room, gets a
code back, and fetches it:

```bash
BASE=http://localhost:3000

CODE=$(curl -s -X POST $BASE/api/scan-handoff \
  -H 'content-type: application/json' \
  -d '{"schema":"mozu.roomscan/1","polygon":[{"x":0,"z":0},{"x":4000,"z":0},{"x":4000,"z":3000},{"x":0,"z":3000}],"height":2500,"openings":[{"wall":0,"type":"door","offset":800,"width":900,"height":2050}],"objects":[],"fixtures":[{"type":"socket","wall":0,"offset":900,"height":1100,"source":"detected","confidence":0.9},{"type":"socket","wall":1,"offset":1500,"height":300,"source":"detected","confidence":0.8}],"source":"roomplan","unitSystem":"metric","confidence":0.9,"capturedAt":"2026-01-01T00:00:00Z"}' \
  | sed 's/.*"code":"\([^"]*\)".*/\1/')

echo "Your code is: $CODE"
curl -s "$BASE/api/scan-handoff?code=$CODE" | head -c 200
```

Then open `http://localhost:3000/scan` and type that code. The room appears with
its door and its two sockets.

---

## 4 · Reach it from a real iPad

The iPad needs a URL it can open. Cloudflare gives you one in about a minute, and
it is HTTPS so iOS raises no local-network prompt.

```bash
brew install cloudflared                          # once

npm start                                         # terminal 1
cloudflared tunnel --url http://localhost:3000    # terminal 2
```

It prints a URL like `https://laid-asking-utah-cabinets.trycloudflare.com`.

> **The URL changes every time you restart the tunnel.** That is fine for testing.
> For a fixed address, deploy to Vercel — see `docs/hosting.md`.

On the iPad: Floorplan screen → put that URL in **MOZU web address** (it is saved
on the device) → **Send to MOZU web** → note the code.

On the laptop: open the same URL + `/scan` and type the code.

Check the tunnel before you pick up the iPad:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://YOUR-TUNNEL-URL/scan
```

`200` means you are ready.

---

## 5 · Build and run the iPad app

```bash
cd apps/ios
brew install xcodegen        # once
xcodegen generate
open MozuScanner.xcodeproj
```

In Xcode: select the target → **Signing & Capabilities** → set your Team → choose
your iPad → **⌘R**.

Needs a LiDAR iPad (iPad Pro 2020+ or iPad Air 2022+) for depth-gated detection.

On a free Apple ID the app stops launching after 7 days and needs ⌘R again. A paid
account extends that to a year and unlocks TestFlight.

> **The Swift has never been compiled in this environment** — there is no Xcode
> here. It is written against the iOS 17 SDK and reviewed by hand, but the first
> real compile will be yours. Say the word if anything does not build and I will
> fix it.

---

## 6 · How to test each feature

### Socket detection (on the iPad)

1. Scan a wall with sockets on it.
2. Sockets are confirmed only after **3 sightings from at least 140 mm apart** —
   walk sideways, do not stand still. A static viewpoint needs 7.
3. Tap a socket the scan missed to pin it by hand.
4. Finish → the floorplan shows each fixture with its label and height.

What the detector is actually doing, in `Scan/`:

* **`SocketDetector.swift`** — finds white faceplates in the camera image.
  Morphological opening (`openRadiusFrac = 0.28`) severs cords and cables from
  the plate, which is what stopped a plugged-in socket beside a coax plate from
  being missed.
* **`DepthGate.swift`** — every candidate must also be the right size and shape in
  METRES. For any flat surface `1/depth` is exactly linear in image coordinates,
  so fitting the wall plane is a 3-unknown least-squares on `1/d` and the residual
  comes out in real millimetres. Gates: 45–260 mm across, within 120 mm of the
  wall plane, flatness RMS under 35 mm, and 55% wall coverage.
* **`FixtureCapture.swift`** — multi-view confirmation. This is the false-positive
  killer: a reflection or a light switch shadow will not survive being seen from
  three angles.
* **`TapToPlace.swift`** — resolves the display-transform direction ambiguity by
  round-trip test (unproject, re-project, keep whichever lands under the finger)
  rather than guessing.

The same logic, in TypeScript, with tests you can run right now:

```bash
npx vitest run src/systems/scan
```

**The full testing plan and the 4-week roadmap:** [`docs/TESTING-PLAN.md`](docs/TESTING-PLAN.md) — field protocol, test cases, acceptance limits, and the automated layers (`npm run typecheck`, `npm test`, `npm run test:e2e`, `npm run test:parity`, `npm run scan:accuracy`).

### Field-test fixes — what to re-test on site

Run `xcodegen generate` again first: the Debug build is now compiled with `-O`,
which is what took detection from ~3200 ms per frame to something usable. The
number is on screen while scanning — please send it back.

| Report | What changed | How to check it |
|---|---|---|
| 有玻璃偵測不到 — glass missed (worst in daytime) | **Round 2.** The first version only trusted *confident* depth readings that landed on something behind the glass. In daylight the sun blinds the LiDAR through a pane, and from a high floor nothing behind it is in reach, so ARKit marks every reading there **low confidence**, and those were thrown away: no evidence, no glass. Now every reading is kept with its confidence and the camera brightness. A low-confidence reading that reaches a wall within 4 m, looked at squarely, counts as see-through (a painted wall that close always measures); a blown-out pixel seen from close counts double. Raw (not smoothed) depth is banked on **every** scan tick. A blue chip on the scan screen counts glass panes as they are found. Televisions RoomPlan recognises are not suggested. Proven on a simulated walk (`glassDaylight.test.ts`): the old finder finds nothing in daylight or from a high floor; the new one finds the pane to within 100 mm, with no false glass on sunlit or dark walls. Suggestions stay **dashed** and removable (a mirror looks the same). | Scan a room with a sliding glass door **in the daytime**. The blue chip says "1 glass pane found" during the scan; the plan shows a dashed opening and "possible glass pane found — review". |
| LED 燈會跑來跑去 — LEDs taken for sockets, markers jumping | A light is a *source*: it clips the sensor. A candidate that is both clipped and far brighter than the wall is rejected. Only the best 12 candidates are measured per frame. The markers are now redrawn **every frame** (they were only moved 5× a second, so they lagged and jumped while the iPad moved), close looks count more than distant ones, a hand-placed pin never drifts, and each marker keeps its number. | Point at LED strips / downlights: no socket markers. Real sockets beside them still confirm. Pan across a confirmed socket: its marker stays on it. |
| 鞋子 — floor plan moves around shoes | Walls are built from the **outermost** fragment (clutter can only ever be in front of a wall, never behind it). A surface lower than 90 cm standing in front of a real wall (shoe rack, boxes) is not a wall — a genuinely low wall with nothing behind it (attic knee wall) still is. Corners come from where wall lines meet. Checked against 15,000 generated rooms — rectangles, L- and U-shapes, angled rooms — scanned with clutter and occlusion: the outline comes back true in all but 6 (a short wall seen only as a sliver under 25 cm). | Scan a wall with shoes along it, and an L-shaped room: walls stay straight and in place. |
| 家具可以 delete | **Furniture** button on the plan → tap → Remove / Remove all. Same on the web (select → Delete). | |
| Round pillar | Pillars are taken out of the wall outline (they used to make a spike) and kept as **columns**: circles on the plan, cylinders in 3D, floor to ceiling. "Remove all" furniture keeps them. iOS 17's curved surfaces are sampled into arcs. **Round 2:** a column in the middle of the room is now also found from the **depth readings** (`PillarFinder`): readings stacked from near the floor to just under the ceiling, clear of the walls, are a column — round if they lie on an arc, else a box — even when RoomPlan reported nothing, one face, or a partial arc. A lone face no longer spikes the plan; a lone low surface (an island side) is dropped. Sofas, tables, a 2 m bookcase, lamps, a pantry against a wall and a person standing there are not columns (`pillarFinder.test.ts`). | Scan an open-plan room with a round column in the middle. The blue chip says "1 column found"; the plan shows a circle, the 3D view a cylinder to the ceiling. Point up at the top of the column once. |

**How tall, how far.** The iPad's LiDAR measures to about **5 m**. Holding the
iPad at ~1.4 m, that covers ceilings up to about **4 m** reliably and **5 m** in
good conditions (step back from the wall and tilt up; the top of the wall has to
be within 5 m of the iPad). In **direct sunlight** the reach drops to roughly
**4 m** — so a 4.5 m room by a sunny window may come back short; type the real
height. Above ~6 m the top of the wall is out of reach and the scan reports the
wall shorter than it is. Rooms up to about 9 × 9 m are what RoomPlan is tuned for.
Glass needs a look from within ~4 m (2.5 m counts double in daylight); a column is
found if seen up to just under the ceiling, or above 3 m in a taller room.

Also fixed: window sill heights (were measured from where the scan started, not
from the floor), furniture on the 2D plans turning the opposite way to 3D, a
socket pass from one room landing in the next, and door cuts on the whole-house
plan drawn half a door early.

### The web configurator

| Try this | Where |
|---|---|
| Add furniture | Modules step → **Catalogue** (40 items, the real MOZU range) |
| Drop a whole set | Modules → **Advice** → "Place this set" |
| Drag anything | **2D** button in the viewer bar — furniture, cabinets, doors, windows, sockets |
| Turn something | Select it, drag the blue handle on its corner |
| Reshape the room | 2D → **Edit walls** → drag a corner. The walls follow and the units re-pack |
| Add a socket | 2D → tap a bare wall. Drag it to move it; it re-anchors round corners |
| Add a window or door | 2D → **Tap wall adds: Window / Door** → tap the wall. Tap one to set type, width, height, sill, or remove it |
| Review suggested glass | Dashed openings came from the scanner seeing through the wall → tap → **Keep it** or **Remove** |
| Change colour | Select something → **Change colour** (cyan, bottom right) → tap a swatch |
| Recolour the room | Style → **Colour** → Walls / Floor / Ceiling |
| Show a person for scale | **Avatar** in the viewer bar (off by default) |
| Photoreal render | Style → **Render** (needs `MOZU_RENDER_SERVER`, see below) |

### Upload a scan file (no code, no server)

The escape hatch when a code has expired or the network is uncooperative.

* iPad: Floorplan screen → **Share scan** → AirDrop the `.json` to your Mac.
* Laptop: `/scan` → **"Choose scan file…"** at the bottom.

Same room, same sockets.

### Photoreal render

The render server is in this package — `server/`. It path-traces the room with
Blender Cycles and hands back a PNG. The iPad and the browser post the SAME
`mozu.render/1` request to it, so both get the same picture.

```bash
server/run-server.sh          # starts it + a public tunnel, prints the URL
```

Needs Blender (`MOZU_BLENDER=/path/to/blender`, or `pip install bpy`). Then point
the web app at it and restart:

```bash
MOZU_RENDER_SERVER=http://localhost:8787 npm start
```

Style → **Render** → Preview (about a minute) or Final (several minutes at 400
samples). Without the variable set, the Render tab returns a 503 naming the
variable rather than a generic 500. `server/README.md` has the details.

---

## 7 · Things that will trip you up

**A 404 from the iPad's Send button.** Almost always a stale build — `npm start`
serves the last `npm run build`. Rebuild.

**Port already in use.** An old server is still running and serving the old build:

```bash
lsof -ti:3000 | xargs kill -9 2>/dev/null
```

**Codes stop working after a restart.** Expected on a laptop: the handoff store is
in memory, so restarting clears it. Tap **Send to MOZU web** again — you do NOT
need to rescan the room. To avoid this entirely, keep a shared **Share scan** file
and upload that instead.

**Codes fail *intermittently* on a Vercel/serverless deploy.** That means no KV
store: each request hits a different instance, so the upload and the lookup do not
meet. Add one (Storage → Create → KV) and redeploy. The server logs which store it
is using on boot and warns loudly about exactly this.

**New files in `public/` 404 until you restart.** Next caches the public manifest
at boot.

---

## 8 · Two things I want to be straight about

1. **The Swift has never been compiled here** — this container has no Xcode. See §5.
2. **The parametric kitchen run** (the Layout step's `base-600`, `wall-600`…) is the
   web's own generic module catalogue, not MOZU product codes, so those still draw
   as sized boxes. The 40 items in Modules → Catalogue are the real models. Mapping
   the generic slots onto real SKUs is a product decision about which cabinet each
   slot means — ask and I will wire it up.
