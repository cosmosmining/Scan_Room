# MOZU — Testing plan and 4-week roadmap

**Scope:** the iPad scanner (`apps/ios`), the web configurator (`src/`), the scan SDK (`packages/scan-sdk`) and the six-character handoff between them.
**Period:** Monday 5 Oct – Friday 30 Oct 2026.
**Goal by 30 Oct:** a TestFlight build that a person who has never seen MOZU can use to scan a real home. The floor plan must be within the accuracy bar (§3), the sockets right, and the room must open on the web from a code. Every claim in this plan is backed either by a test that runs in CI or by a measured field result.

---

## 1. What is being tested

| # | Part | What can go wrong | Where it lives |
|---|------|-------------------|----------------|
| A | **Wall outline** — RoomPlan surfaces → floor plan | clutter pulls a wall inward (鞋子); L/U rooms drawn wrong; corners hidden | `Scan/WallLoop.swift` ⇄ `systems/scan/wallLoop.ts` |
| B | **Columns** — pulled out of the walls as round/box structure | spike in the plan; rounded corner taken for a column; column missed | same files, `analyseWalls` |
| C | **Glass** — panes RoomPlan did not recognise, found by seeing *through* the wall | missed glass (有玻璃偵測不到); mirror reported as glass | `Scan/GlassFinder.swift` ⇄ `glassFinder.ts` |
| D | **Sockets** — image detector + depth gate + multi-view tracking | LEDs taken for sockets (LED 燈會跑來跑去); real sockets missed; markers drift | `SocketDetector`, `DepthGate`, `FixtureCapture` ⇄ `fixtureDetector.ts`, `plateGeometry.ts` |
| E | **Openings & furniture editing** on the iPad | can't add the glass that was missed; can't delete scanned furniture | `Views/FloorplanResultView.swift` |
| F | **Handoff** — scan → code → web | code expires or opens an empty room; data lost in transit | `Export/Handoff.swift`, `/api/scan-handoff` |
| G | **Web editor** — plan, 3D, finishes, render | wrong orientation; edits lost; stale selection | `components/room`, `three/` |
| H | **Performance** | detection too slow to see anything (was 3208 ms/frame in Debug) | device only |

## 2. Risks, ranked — and what covers each

| Risk | Likelihood | Impact | Covered by |
|------|-----------|--------|-----------|
| SwiftUI view code has compile errors (it has never been built by Xcode in this repo's CI) | medium | blocks everything | CI `ios-build` job (Week 1, day 1) |
| Real rooms break the wall analysis in ways the generated rooms don't | medium | wrong plans, lost trust | field corpus + raw-surface replay (Week 1–2) |
| Mirrors suggested as glass | high (by physics) | one tap to remove | GLS-04 manual; counted in metrics |
| Socket recall in real lighting below target | medium | sockets missing from the quote | field metrics SKT-*, Week 2 tuning |
| Device performance on older iPads (M1) | medium | detection sees too few frames | PERF-* on each device |
| iPad and web drift apart (two implementations) | low now | plans differ by platform | CI `swift-parity` job |

## 3. The acceptance bar

These are the numbers a scan is held to. They are enforced in code by `scripts/scan-accuracy.mjs`, so every manual test produces a PASS/FAIL table rather than an opinion.

| Measure | Limit | How it's measured |
|---------|-------|------------------|
| Each wall length | ±30 mm or ±1.5 %, whichever is larger | laser meter, corner to corner, floor level |
| Floor area | ±2 % | from the measured walls |
| Ceiling height | ±30 mm | laser meter, 3 points, median |
| Wall count | exact | |
| Column count | exact | |
| Column size | ±40 mm | tape across (diameter or wider face) |
| Doors / windows | exact count, after the tester reviews glass suggestions | |
| Socket recall (found ÷ real) | ≥ 90 % per room, ≥ 95 % overall | socket inventory |
| Socket precision (real ÷ reported) | ≥ 95 % — at most 1 false socket in 2 rooms | |
| Glass recall | ≥ 80 % of unrecognised panes suggested | rooms R6, R7 |
| Detection time | ≤ 150 ms/frame p50, ≤ 300 ms p95 (shown on screen) | every scan |
| Crashes | 0 in the last 20 scans before release | |
| Handoff | 100 % of codes open the same room on the web | HND-* |

---

## 4. Automated testing (in code)

### 4.1 The layers

| Layer | What it proves | Files | Command | Runs |
|------|---------------|-------|---------|------|
| **Unit** | each piece does what it says: detector tiers, LED rejection, tracking, glass finder, wall analysis cases, rotation sense, store behaviour | `src/**/__tests__/*.test.ts` (281 tests) | `npm test` | every push |
| **Ground-truth fuzz** | the wall analysis gets *real-shaped* rooms right: 1,000 generated rooms with known answers (rect, L, U, angled), scanned badly — broken, hidden, inset walls, clutter, pillars | `wallLoop.fuzz.test.ts`, `helpers/roomGen.ts` | `npm test` / `npm run test:fuzz` (15,000) | push: 1,000 · nightly: 3 × 15,000 |
| **Swift ⇄ TS parity** | the iPad's Swift gives the *same* answer as the tested TypeScript, to the micron: 2,000 rooms, 100 glass cases, the detector's test images | `swiftParity.test.ts`, `apps/ios/ParityHarness`, `scripts/swift-parity.sh` | `npm run test:parity` | every push |
| **Golden scans** | real scans import on the web exactly as before; any change shows as a reviewable diff | `fixtures/scans/*.scan.json`, `goldenScans.test.ts` | `npm test` · `npm run test:golden:update` | every push |
| **Accuracy** | a scan is within §3 of the tape-measured room | `scripts/scan-accuracy.mjs` | `npm run scan:accuracy -- scan.json truth.json` | every field scan; in CI for scans marked `ciEnforce` |
| **End-to-end** | the handoff and the editor work in a real browser against a production build | `e2e/handoff.spec.ts` (8 tests) | `npm run build && npm run test:e2e` | every push |
| **iPad build** | the whole app compiles with Xcode, SwiftUI included | `.github/workflows/ci.yml` → `ios-build` | Xcode, or CI | every push |
| **Typecheck** | app and SDK | | `npm run typecheck` | every push |

### 4.2 What each layer is *not* allowed to be used for

- Unit and fuzz tests don't prove anything about real LiDAR. Only field scans do (§5). They prove the geometry is right *given* what RoomPlan reports.
- Parity proves the Swift equals the TypeScript. It doesn't prove the TypeScript is right; the unit and fuzz layers do that.
- E2E runs in Chromium. Safari and iPad Safari are checked by hand (WEB-08).

### 4.3 Rules for every change

1. **A field bug gets a failing test before it gets a fix.** Wall, column and glass bugs become a golden scan or a raw-surface replay (Week 1 task D1). Detector bugs become a test image. UI bugs become an e2e step.
2. A PR is mergeable when CI is green: web, swift-parity and ios-build.
3. Changing a `.expected.json` needs one sentence in the PR saying why the room *should* now import differently.
4. Constants that exist on both sides (Swift and TS) change together. Parity fails if they don't.

### 4.4 Gaps, scheduled in the roadmap

| Gap | Week |
|-----|------|
| Wall bugs from the field can't be replayed: the shared scan holds the *result*, not RoomPlan's raw surfaces | W1 (D1) |
| No XCTest target on the iPad side (pure-Swift tests run only via parity) | W2 (D5) |
| On-device performance only read off the screen, not logged | W2 (D6) |
| E2E only in Chromium | W3 (D9) |
| No visual regression on the plan or 3D | W3 (D10) |

---

## 5. Manual testing (in the field)

### 5.1 The rooms

Find each kind of room at least once. "Required" means release is blocked without a passing result.

| ID | Room | Exercises | Required |
|----|------|-----------|----------|
| R1 | plain rectangle, few furnishings | baseline | ✔ |
| R2 | L-shaped | reflex corner, inward side | ✔ |
| R3 | U / notched (chimney breast, alcove) | notch kept, not bridged | ✔ |
| R4 | free-standing **round column** | column extraction, circle on plan | ✔ |
| R5 | square or wall-engaged column | box column; wall stays straight | ✔ |
| R6 | **sliding glass door** | glass suggestion (door) | ✔ |
| R7 | floor-to-ceiling / large window | glass suggestion (window) | ✔ |
| R8 | **large mirror** or mirrored wardrobe | negative control: expect a suggestion; removing it must be one tap | ✔ |
| R9 | **LED cove strip / downlights** near sockets | LED rejection, socket recall in dark-adjusted frames | ✔ |
| R10 | **shoes / boxes along a wall**, shoe rack | clutter; wall stays straight | ✔ |
| R11 | strong sunlight on a socket wall | sunlit plates still detected | |
| R12 | attic / sloped ceiling, knee wall | low wall kept | |
| R13 | rounded corner or curved wall | no fake column | |
| R14 | open-plan > 8 m | long walls, drift | |
| R15 | whole flat, 3+ rooms in one session | multi-room, shared origin | ✔ |

**Devices:** at least two LiDAR iPads, ideally one M1 and one M4 iPad Pro, on the iOS versions testers really use (17.x and the current release).
**Browsers:** Chrome and Safari on macOS, Safari on iPad, and Edge (WEB-08).

### 5.2 Measuring the truth (do this first, before scanning)

Tools: a laser distance meter (±2 mm), a 5 m tape, a phone camera, and `docs/testing/truth-template.json`.

1. Give the room an ID: city-number-room, e.g. `TPE-03-kitchen`.
2. Sketch the room. Number the corners clockwise from the door.
3. Measure **every wall**, corner to corner at floor level, *behind* furniture. Write them in order round the room into `walls`.
4. Measure the ceiling height at 3 points and take the median.
5. Measure each column across. Record it as round or box.
6. Count doors and windows. Note which are glass. Note any mirrors.
7. Make a **socket inventory**: for each socket, the wall it's on, its distance from the corner and its height. Photograph each one. Count them into `sockets`.
8. Photograph each wall straight on, plus one wide shot from each corner.

### 5.3 Scanning (the same way every time)

1. Fresh app launch. Note the build number.
2. Start in a corner and walk **clockwise**, 1–1.5 m from the walls, the iPad at chest height. Pass each wall twice.
3. Walk past each socket **sideways** for about 20 cm. Confirmation needs three looks from at least 14 cm apart.
4. Note the **ms/frame** shown on screen at the start, the middle and the end.
5. Finish. Then review the result:
   - glass suggestions: Keep or Remove each one;
   - furniture: Remove all;
   - add any missed window/door with **Windows**;
   - add any missed socket with **Sockets**.

   Write down *every* correction you had to make. That is the measure of friction.
6. **Share scan** → save the `.json` as `<room-id>-<tester>-<n>.scan.json`.
7. **Send to MOZU web** → open the code on a laptop → check WEB-01.
8. **Repeat:** each room is scanned **3 times**, by 2 different testers where possible. Repeatability is a result in itself.
9. Score it: `npm run scan:accuracy -- <scan.json> <truth.json>`. Paste the table into the field log.

### 5.4 Test cases

Write *Pass*, *Fail* (open an issue with the field-bug template) or *Blocked* in the field log.

**Floor plan & clutter**

| ID | Steps | Expected |
|----|-------|----------|
| SCAN-01 | Scan R1 per §5.3 | all §3 wall checks PASS |
| SCAN-02 | Scan R2 and R3 | wall count exact; reflex corner and notch present |
| SCAN-03 | Same room, 3 scans | wall lengths agree within ±20 mm across scans |
| CLUT-01 | R10: line shoes/boxes along 1.5 m of a wall, scan | that wall straight and within ±30 mm of truth |
| CLUT-02 | R10: shoe rack 40–90 cm tall against a wall | not drawn as a wall |
| CLUT-03 | R12: knee wall | kept as part of the outline |

**Columns**

| ID | Steps | Expected |
|----|-------|----------|
| COL-01 | R4 | one round column, drawn as a circle, size ±40 mm, no spike in walls |
| COL-02 | R5 | box column; adjoining wall straight |
| COL-03 | R13 | rounded corner stays part of the walls; no column reported |
| COL-04 | Furniture → Remove all | columns remain |
| COL-05 | On the web: try to drag the column | it does not move; "part of the structure" shown |

**Glass & openings**

| ID | Steps | Expected |
|----|-------|----------|
| GLS-01 | R6: look at the glass door for ~3 s during the walk | dashed suggestion on that wall; "possible glass pane" banner |
| GLS-02 | R7 | window suggestion; sill within ±100 mm |
| GLS-03 | Keep it / Remove on a suggestion | dashed → normal / gone; persists after Send to web |
| GLS-04 | R8 (mirror) | a suggestion is acceptable; Remove is one tap |
| OPN-01 | Windows → tap a bare wall → set width, height, sill | added at the tap; values held to the wall and ceiling |
| OPN-02 | Drag an opening past the wall's end | stops at the corner |
| OPN-03 | Window sill on a recognised window | within ±50 mm of measured (this was wrong by ~1.3 m before the fix) |

**Sockets**

| ID | Steps | Expected |
|----|-------|----------|
| SKT-01 | R1 socket walk | recall ≥ 90 %, no false sockets |
| SKT-02 | R9: LED strips and downlights in frame for 30 s | **no** markers on the lights |
| SKT-03 | R9: socket directly under an LED strip | still confirmed |
| SKT-04 | Pan across a confirmed socket | marker stays on it, no jumping; number unchanged |
| SKT-05 | Pin a socket by hand, keep scanning past it | pin does not move |
| SKT-06 | R11 sunlit socket | detected |
| SKT-07 | Double socket (two outlets side by side) | two markers, not one |
| SKT-08 | Socket heights on the plan | within ±50 mm of measured |

**Furniture, handoff, web, performance**

| ID | Steps | Expected |
|----|-------|----------|
| FUR-01 | Furniture → tap → Remove; Remove all | removed; Done always works; editor closes when empty |
| HND-01 | Send to web → type the code on a laptop | same room, openings, columns, sockets |
| HND-02 | Enter a wrong code | clear "not found", not an empty room |
| HND-03 | Use a code after 24 h | clear "expired" message |
| HND-04 | Send with the iPad offline, then online | clear error, then success on retry |
| WEB-01 | After HND-01: compare the plan with the iPad's | identical walls, openings, columns; furniture in the same orientation |
| WEB-02 | 2D: drag furniture, turn it with the handle | 3D shows the same position and facing |
| WEB-03 | Select a window, then a sofa, press Delete | the sofa is deleted, not the window |
| WEB-04 | Type 1500 into an opening's Width | 1500 |
| WEB-05 | Change only Height → Apply | room shape, furniture and columns kept |
| WEB-06 | Change colour on a cabinet and on the walls | applied in 3D and in the render |
| WEB-07 | Render | no grey boxes for the old furniture; columns present |
| WEB-08 | WEB-01..05 in Safari (mac), iPad Safari, Edge | same results |
| PERF-01 | Read ms/frame during every scan | §3 limits, on each device |
| PERF-02 | 10-minute scan of R15 | no crash, no thermal shutdown, markers still smooth |

### 5.5 Exploratory sessions (30 min each, once per week)

The scripted cases check what we already thought of. These sessions look for what we didn't:

- **"Break the floor plan"** — odd rooms, stairs, half-open doors, scanning too fast, starting mid-room.
- **"Lighting torture"** — dusk, all lamps on, a TV playing, flickering LEDs, a phone torch.
- **"Handoff abuse"** — two iPads sending at once, a room re-sent after editing, a code shared to a phone.

Log what you tried and what surprised you, not only failures.

### 5.6 Field log

A shared sheet with one row per scan:

`date · room ID · tester · device · iOS · build · scan # · ms/frame (start/mid/end) · walls PASS/FAIL · area error % · columns · glass suggested / real / kept · sockets real / found / false · corrections made · scan time (min) · crash? · issue links`

---

## 6. Defects

| Severity | Meaning | Response |
|----------|---------|----------|
| **P0** | crash, data loss, scan cannot be completed, code opens the wrong room | fix the same or next day; release blocked |
| **P1** | result outside §3 in a required room; feature unusable | fix within the week; release blocked |
| **P2** | wrong but correctable in one or two taps (e.g. a mirror suggested as glass) | schedule; doesn't block |
| **P3** | cosmetic, wording | backlog |

**Flow:** report with the field-bug template, attaching the scan JSON and truth → reproduce from the attached scan → add a failing test (§4.3) → fix → CI green → verify on the device with the same room → close.
**Triage:** 15 minutes every day in field weeks, at a fixed time. Nothing waits more than a day for its severity.

## 7. Metrics, reported every Friday

- rooms tested / rooms required (§5.1)
- wall error: p50 and p95 (mm); share of scans passing all wall checks
- socket recall and precision; false sockets per room
- glass: suggested / real / kept
- corrections per scan (the friction number)
- ms/frame p50 / p95 per device
- crashes; open P0 / P1 / P2
- CI: green rate, and nightly fuzz failures (should be 0–45 a night out of 45,000)

---

## 8. Roadmap — four weeks

### Week 1 · 5–9 Oct — *Make every result trustworthy*

| # | Task | Owner | Done when |
|---|------|-------|-----------|
| D1 | **Raw-surface export.** "Share scan" also writes RoomPlan's wall surfaces, so a field wall bug can be replayed through `analyseWalls` as a test | Dev | a field wall bug reproduces as a failing test |
| D2 | Turn on CI; get **ios-build** green (the first real Xcode build of the SwiftUI) | Dev | all 3 CI jobs green on `main` |
| D3 | Version number on screen (Settings / About) | Dev | testers can report the build |
| Q1 | Buy or borrow the measuring kit; set up the field log; train testers on §5.2–5.3 | QA | dry run in the office passes |
| Q2 | **Field round 1:** R1, R2, R4, R6, R9, R10 — 3 scans each | QA | 18 scans scored and logged |
| Q3 | First exploratory session | QA | notes filed |

**Exit:** CI green on all jobs. Six required rooms measured and scored. Every failure filed with its scan file.

### Week 2 · 12–16 Oct — *Accuracy*

| # | Task | Owner | Done when |
|---|------|-------|-----------|
| D4 | Fix week-1 P0/P1s, each with a test first (§4.3) | Dev | P0 = 0 |
| D5 | **XCTest target** for the pure Swift files (`WallLoop`, `GlassFinder`, `SocketDetector`) | Dev | runs in `ios-build` |
| D6 | **On-device performance log**: ms/frame and frames analysed, saved with each scan | Dev | appears in the scan JSON and the field log |
| D7 | Every field scan with truth added to `fixtures/scans` (golden), passing ones set to `ciEnforce` | Dev | ≥ 10 real rooms in CI |
| D8 | Socket detector tuning on the field images (recall / precision), with test images | Dev | §3 socket limits met on rounds 1–2 |
| Q4 | **Field round 2:** R3, R5, R7, R8, R11, R12, R13 | QA | all required rooms seen at least once |
| Q5 | Re-test week-1 failures on device | QA | verified or reopened |

**Exit:** all required rooms measured. Wall checks pass on ≥ 90 % of scans. Socket recall ≥ 90 %. P0 = 0.

### Week 3 · 19–23 Oct — *Robustness and the web*

| # | Task | Owner | Done when |
|---|------|-------|-----------|
| D9 | E2E in **WebKit** as well as Chromium | Dev | both green in CI |
| D10 | Visual regression: screenshots of the plan and 3D for each golden scan | Dev | a deliberate change shows as a diff |
| D11 | Handoff hardening: expiry message, retry when offline, large houses (HND-02..04) | Dev | HND-* pass |
| D12 | Fix week-2 P1s; second pass on the glass-vs-mirror UX if GLS-04 is noisy | Dev | P1 ≤ 2, none in required rooms |
| Q6 | **R14 and R15**: open plan and a whole flat; 10-minute stress scan (PERF-02) | QA | logged |
| Q7 | Web pass WEB-01..08 in all four browsers | QA | logged |
| Q8 | Exploratory: lighting torture + handoff abuse | QA | notes filed |

**Exit:** everything in §5.4 has been run at least once. P1 ≤ 2 and none in required rooms. Both e2e browsers green.

### Week 4 · 26–30 Oct — *Release candidate*

| # | Task | Owner | Done when |
|---|------|-------|-----------|
| D13 | Code freeze Tuesday; P0/P1 fixes only after that | Dev | |
| D14 | TestFlight build of the RC | Dev | installed on all test iPads |
| Q9 | **Full regression:** all §5.4 cases on the RC, both devices | QA | results in the log |
| Q10 | **Beta:** 3–5 people outside the team scan their own homes with no help, using only START-HERE. Collect scans, corrections and time taken | QA/PM | ≥ 10 outside scans |
| Q11 | Final metrics (§7) against §3 | QA | report |
| PM | **Go / no-go** Friday | PM | decision recorded |

**Release criteria (go):**
- 0 open P0.
- 0 open P1 in a required room.
- §3 met on ≥ 90 % of RC scans in the required rooms.
- No crash in the last 20 scans.
- All CI jobs green.
- Outside testers finished their scans without help.

---

## 9. Where things stand today (1 Oct)

- **Automated:** unit, fuzz, golden, accuracy and e2e all pass locally. Parity passes against a Swift 6.0.3 build. The CI workflow is written but **has not run yet**. Its `ios-build` job will be the first time Xcode compiles the SwiftUI view code.
- **Measured so far:** across 15,000 generated rooms, the wall analysis is wrong on about 0.05 % (U-shaped rooms where a short wall is seen only as a sliver).
- **Not yet known:** everything that depends on real LiDAR and real rooms. That is what weeks 1–2 are for. No §3 number has been measured on a device yet.

## 10. Quick reference

```bash
npm run typecheck                 # app + SDK
npm test                          # unit, fuzz (1,000 rooms), golden scans, accuracy
npm run test:fuzz                 # 15,000 rooms
npm run test:parity               # needs a Swift toolchain
npm run build && npm run test:e2e # browser end-to-end
npm run test:golden:update        # after adding a scan to fixtures/scans
npm run scan:accuracy -- fixtures/scans/x.scan.json fixtures/scans/x.truth.json
```

Adding a field scan to the regression set: copy `<room>.scan.json` and `<room>.truth.json` into `fixtures/scans/`, run `npm run test:golden:update`, read the new `.expected.json`, commit all three.
