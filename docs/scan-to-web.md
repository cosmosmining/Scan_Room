# iPad scan → website design: the reference workflow

How a room measured with RoomPlan/ARKit on an iPad becomes a room the customer
designs in on mozu.com, and what validates the design against what is actually
on those walls.

Everything below is implemented and exercised by tests; the last section says
plainly which parts are demo-grade and what has to change before production.

---

## 1. The shape of it

```
  iPad (MozuScanner)                    mozu web
  ─────────────────                     ────────
  RoomPlan + ARKit
    walls, doors, windows, objects
    sockets (LiDAR-gated, multi-view)
        │
        ▼
    RoomScan  ──── POST /api/scan-handoff ────►  store, return code "5XT4G5"
    (mozu.roomscan/1)                                       │
        │                                                   ▼
        │                                    person types code at /scan
        │                                                   │
        └──── deep link / file share ───────────────────────┤
                                                            ▼
                                                   scanToGeometry()
                                                            │
                                                            ▼
                                                    RoomGeometry
                                              walls · openings · fixtures
                                                            │
                                                            ▼
                                              ConfiguratorShell — design
                                                            │
                                                            ▼
                                            detectFixtureConflicts()
                                       "this cabinet seals a socket"
```

One contract runs the whole length of it: **`mozu.roomscan/1`**, defined in
`packages/scan-sdk` and mirrored byte-for-byte by `RoomScan` in the Swift app.
Millimetres throughout, floor plane X/Z, Y up.

---

## 2. Capture — what the iPad produces

`apps/ios/MozuScanner`

| Piece | Source | Notes |
|---|---|---|
| Floor polygon | RoomPlan wall surfaces, chained into a loop | cm-level |
| Ceiling height | tallest captured wall | |
| Doors / windows / openings | RoomPlan | `offset` is the **leading edge**, not the centre |
| Objects | RoomPlan | category, centre, size, rotation |
| **Sockets & pipework** | MOZU's own detector | see below |

Sockets are not RoomPlan's — RoomPlan does not find them. They come from a
classical-CV detector running on the same ARKit frames RoomPlan is already
producing (no second camera, no model download, no network), then confirmed
geometrically:

1. **Image stage** proposes bright plate-shaped candidates. Tuned for *recall* —
   a socket missed here cannot be recovered later.
2. **Depth stage** (`DepthGate.swift`) measures each candidate against the LiDAR
   depth map and asks what brightness cannot answer: is it 45–260 mm across, is
   it *in the plane of* the surface around it, is that surface flat and vertical,
   and where exactly is it in world coordinates.
3. **Multi-view confirmation** holds it as a hypothesis until it re-measures to
   the same world point from cameras ≥140 mm apart. A highlight or shadow is not
   a point in the room, so it can never accumulate agreement.
4. **The person overrules all of it** — tap any socket during the scan to pin it,
   drag it on the plan afterwards, set its height.

Positions are measured in world metres *at the moment of seeing*, so the finished
floor polygon only converts coordinates. The geometry is mirrored in
`src/systems/scan/plateGeometry.ts` and tested against a synthetic room whose
ground truth is known: recovered position within 15 mm, wall normal within 3°.

---

## 3. Transfer — three ways, one destination

The real workflow is *scan on an iPad, design on a laptop*, and that gap is why
transfer needs more than a link.

### a. Handoff code (the main path)

```
POST /api/scan-handoff        { …RoomScan… }
  → 201 { code: "5XT4G5", url: "https://app.mozu.com/scan/5XT4G5", expiresAt, fixtures: 3 }

GET  /api/scan-handoff?code=5xt-4g5
  → 200 { scan: … }
```

The app shows the code large enough to read across a room. The customer types it
at `/scan`, or opens the URL directly.

Six characters from a deliberately reduced alphabet — no `O`/`0`, no `I`/`1`/`L`,
no `U`. Codes get read down a phone line, so the characters that get confused are
simply not in it, and `normaliseCode` folds the near-misses onto what the person
meant (`b7k4m2`, `B7K4-M2`, `07K4M2` all resolve). Codes expire after 24 h.

### b. Deep link

`/scan?poly=…&h=…&scan=<base64>` — still supported, and correct when the iPad
*is* the browser or a link can be pasted. Not the main path, because a whole
house is tens of kilobytes and every browser, proxy and chat app truncates long
URLs at a different length. A link that works for a galley kitchen and silently
fails for a house is worse than one that never worked.

### c. Scan file

Share the JSON from the app, load it at `/scan`. No server involved, so it works
offline and after a code expires.

All three converge on **`scanToGeometry()`** — one conversion, so a room opened by
code is the same room, wall for wall and socket for socket, as one opened by link.

---

## 4. Render — the room on the website

`scanToGeometry` (`src/systems/scan/scanToGeometry.ts`) maps the scan onto the
configurator's `RoomGeometry`: polygon → walls, openings attached to wall *i*,
fixtures attached to wall *i* with their type, offset, height, provenance and
(for pipework) measured diameter.

The customer lands on step 1 with their real room: dimensioned plan, door swings,
and every socket and pipe labelled. Steps 2–5 are the existing design flow —
layout, modules, style, review — now operating on measured geometry instead of a
typed-in box.

Provenance survives the trip: a socket the detector found and one a person pinned
are distinguishable in the model and on the plan, because a designer deciding
whether to trust a position needs to know whether a human put it there.

---

## 5. Validate — in real time, while designing

`src/systems/layout/fixtures.ts` — `detectFixtureConflicts()`.

It works in the same 1-D along-wall coordinate the layout packer uses, gated by
vertical band so a base unit only clashes with a low fixture and a wall unit only
with a high one:

- **Errors** — a unit *seals* a fixture that must stay reachable.
- **Warnings** — a unit merely crowds one, or an appliance cannot reach a utility
  it needs.

Gas gets its own, larger clearance. Openings are checked separately
(`detectOpeningObstruction`) so a run cannot block a door.

This is why the scan carries fixtures at all. A room whose walls arrive but whose
sockets do not is a room the conflict engine cannot protect — which is what the
handoff test asserts explicitly.

---

## 6. Proof it works

`src/systems/handoff/__tests__/scanHandoff.test.ts` walks the whole chain: the
iPad's JSON → the shared parser → a code → the code typed with a hyphen and in
lower case → `RoomGeometry` with four walls, three fixtures, the waste pipe still
110 mm, the door still on wall 0, and both sockets keeping their provenance.

Live against a built server:

```
1. iPad POSTs scan    -> 201 {"code":"5XT4G5","url":"…/scan/5XT4G5","fixtures":3}
2. laptop types "5xt-4g5" -> 200  walls: 4  fixtures: 3
3. /scan/5XT4G5       -> 200
4. wrong code         -> 404 {"error":"No scan for that code — it may have expired."}
5. malformed scan     -> 422 {"error":"Not a valid mozu.roomscan/1 payload."}
```

The loaded page shows the 4.20 × 3.00 m room, its door with the swing arc, both
sockets labelled on the right-hand wall and `Waste ⌀110` on the lower wall.

---

## 7. What is demo-grade, and what production needs

Stated plainly, because the difference is invisible in a demo:

| Piece | Now | Production |
|---|---|---|
| Handoff store | in-memory Map with TTL, **single process** | Redis / KV / a table. `HandoffStore` is a 3-method interface; nothing above it changes. |
| Auth | none — a code is a bearer token | tie the code to an account, or keep the 24 h TTL and accept that a guessed code is 1 in 7×10⁸ |
| Transport | HTTPS POST | unchanged, but add rate limiting on POST |
| Multi-room | one `RoomScan` per code | the app already captures a whole house in one coordinate space; the wire format needs a room array |
| Real-time | request/response | a socket channel would let the iPad push scan updates into an open browser session live |

The last row is the one worth discussing: "real time" currently means *the room
appears the moment the code is entered*, not *the browser updates while the iPad
is still scanning*. The second is a bigger change and only worth building if
someone actually stands at a laptop watching a colleague scan.
