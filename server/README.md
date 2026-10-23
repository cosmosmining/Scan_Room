# MOZU Photoreal Render Server

Path-traces a MOZU design (the user's scanned room + placed furniture) with
**Blender Cycles** and returns a film-quality PNG to the iPad app. The iPad stays
real-time (RealityKit); this server does the slow, photoreal "hero shot" on demand.

```
iPad app  ──POST /render (design JSON)──►  render-server.mjs
                                              │ spawns
                                              ▼
                                 blender_render_design.py  (Blender Cycles)
                                              │ PNG
iPad app  ◄─────────────  image/png  ─────────┘
```

## Requirements

- **Node 18+** (server is pure Node built-ins — no `npm install`).
- **Blender** with Cycles, one of:
  - the **`bpy`** Python module (`pip install bpy`) — then `MOZU_PYTHON=python3`, or
  - a **Blender executable** — then set `MOZU_BLENDER=/path/to/blender`.
- The repo checked out (the server reads the USDZ models + textures from it).
- A GPU box renders far faster, but **CPU works** (Cycles falls back to CPU).

## Run

**Recommended — works on ANY network (no same-Wi-Fi needed):**

```bash
brew install cloudflared      # one time
server/run-server.sh
```
This starts the render server *and* a public Cloudflare tunnel, then prints a
`https://<name>.trycloudflare.com` URL. Paste **that** into the app's **Photoreal →
Render server address**. The iPad can then reach your laptop over Wi-Fi *or
cellular* — no router setup, no account.

**Plain (same-Wi-Fi only):**

```bash
node server/render-server.mjs          # → :8787
# then in the app use  http://<your-mac-LAN-ip>:8787   (ipconfig getifaddr en0)
```

### Environment variables

| var | default | meaning |
|---|---|---|
| `PORT` | `8787` | HTTP port |
| `MOZU_PYTHON` | `python3` | Python that has the `bpy` module |
| `MOZU_BLENDER` | — | Blender executable (overrides `MOZU_PYTHON`, uses `--background`) |
| `MOZU_SCRIPT` | `scripts/ios/blender_render_design.py` | render worker |
| `MOZU_MODELS` | `apps/ios/MozuScanner/Resources/Models` | USDZ furniture |
| `MOZU_TEX` | `apps/ios/MozuScanner/Resources/Textures` | surface textures |
| `MOZU_TIMEOUT` | `600000` | render timeout (ms) |

## Endpoints

- `GET /health` → `{"ok":true,"engine":"bpy"}`
- `POST /render` → body is `mozu.render/1` JSON (see
  `scripts/ios/blender_render_design.py` header); responds `image/png`, or `500`
  with the Blender log on failure.

## Test without the app

```bash
# render the bundled sample request to a PNG
curl -sS -X POST http://localhost:8787/render \
  -H 'content-type: application/json' \
  --data @server/sample-request.json -o /tmp/mozu.png && open /tmp/mozu.png
```

---

# MOZU Live — real-time walkthrough (near-photoreal, streamed)

`/render` above is a *single hero shot*. **Live mode** is the other half: the Mac
renders a **near-photoreal EEVEE** frame for every camera pose and streams the
pixels back, so you can **walk the rendered room in real time on the iPad** (or in
a browser on the Mac). The heavy GPU work stays on the Mac; only JPEG frames go
over the wire.

> EEVEE, not Cycles: real-time path tracing doesn't exist on any hardware. EEVEE
> gives screen-space reflections, soft shadows and ambient occlusion at
> interactive rates — very close to the Cycles look, live.

```
iPad / browser ──[len][JSON pose]──►  blender_stream_server.py  (Blender EEVEE, TCP :8080)
               ◄────[len][JPEG]─────  renders one frame per pose, stays resident
```

## Run

```bash
server/run-live.sh
```
This starts the resident Blender EEVEE engine on TCP `:8080` and a browser bridge
on `:8788`, then prints:

- **Browser (Mac):** `http://localhost:8788/live` — walk with `W/A/S/D` + drag to
  look. Use this first to judge quality before going to the iPad.
- **iPad Live mode:** `<your-mac-ip>:8080` — tap **Live** in the design view,
  enter that address, **Go Live**.

Both clients speak the same length-prefixed protocol: `[4-byte BE length][UTF-8
JSON]` up, `[4-byte BE length][JPEG]` down. The client sends `{"t":"scene",
"design":…}` once to build the room, then a `{"t":"pose","pos":[x,y,z],
"target":[x,y,z],"fov":…,"w":…,"h":…}` per frame. Sending `pos`+`target` (server
does the look-at) keeps the client free of Blender's Z-up axis conventions.

### Environment variables

| var | default | meaning |
|---|---|---|
| `MOZU_BLENDER` | `/Applications/Blender.app/…/Blender` | Blender executable |
| `MOZU_STREAM_PORT` | `8080` | Blender TCP engine port (the iPad connects here) |
| `PORT` | `8788` | browser-bridge HTTP port |

Coordinates are iOS design metres (floor plane X/Z, Y up); the engine converts to
Blender's Z-up space. Same LAN required for the iPad (it's a raw TCP socket, so a
Cloudflare tunnel won't help here — use the browser viewport for remote demos).
