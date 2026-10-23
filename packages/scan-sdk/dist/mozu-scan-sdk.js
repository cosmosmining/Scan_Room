// src/types.ts
var ROOMSCAN_SCHEMA = "mozu.roomscan/1";

// src/geometry.ts
var sub = (a, b) => ({ x: a.x - b.x, z: a.z - b.z });
var add = (a, b) => ({ x: a.x + b.x, z: a.z + b.z });
var scale = (a, s) => ({ x: a.x * s, z: a.z * s });
var dot = (a, b) => a.x * b.x + a.z * b.z;
var length = (a) => Math.hypot(a.x, a.z);
var distance = (a, b) => length(sub(a, b));
var midpoint = (a, b) => scale(add(a, b), 0.5);
function normalize(a) {
  const l = length(a);
  return l > 1e-9 ? { x: a.x / l, z: a.z / l } : { x: 0, z: 0 };
}
var perpCW = (a) => ({ x: a.z, z: -a.x });
var perpCCW = (a) => ({ x: -a.z, z: a.x });
function signedArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    area += p.x * q.z - q.x * p.z;
  }
  return area / 2;
}
var polygonArea = (points) => Math.abs(signedArea(points));
function perimeter(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    sum += distance(points[i], points[(i + 1) % points.length]);
  }
  return sum;
}
function centroid(points) {
  let cx = 0;
  let cz = 0;
  for (const p of points) {
    cx += p.x;
    cz += p.z;
  }
  const n = points.length || 1;
  return { x: cx / n, z: cz / n };
}
function bounds(points) {
  const xs = points.map((p) => p.x);
  const zs = points.map((p) => p.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  return { minX, minZ, maxX, maxZ, width: maxX - minX, depth: maxZ - minZ };
}
function simplifyPolygon(points, epsilon = 30, straightness = 6e3) {
  const merged = [];
  for (const p of points) {
    const last = merged[merged.length - 1];
    if (!last || distance(last, p) > epsilon) merged.push(p);
  }
  if (merged.length > 1 && distance(merged[0], merged[merged.length - 1]) <= epsilon) {
    merged.pop();
  }
  if (merged.length < 4) return merged;
  const out = [];
  const n = merged.length;
  for (let i = 0; i < n; i++) {
    const prev = merged[(i - 1 + n) % n];
    const cur = merged[i];
    const next = merged[(i + 1) % n];
    const a = sub(cur, prev);
    const b = sub(next, cur);
    const cross = Math.abs(a.x * b.z - a.z * b.x);
    if (cross > straightness) out.push(cur);
  }
  return out.length >= 3 ? out : merged;
}
function ensureCCW(points) {
  return signedArea(points) < 0 ? [...points].reverse() : points;
}

// src/format.ts
var MM_PER_INCH = 25.4;
var MM2_PER_SQFT = 92903.04;
var MM2_PER_SQM = 1e6;
function formatLength(mm, unit) {
  if (unit === "imperial") {
    const totalInches = mm / MM_PER_INCH;
    let feet = Math.floor(totalInches / 12);
    let inches = Math.round(totalInches - feet * 12);
    if (inches === 12) {
      feet += 1;
      inches = 0;
    }
    return `${feet}\u2032 ${inches}\u2033`;
  }
  return mm >= 1e3 ? `${(mm / 1e3).toFixed(2)} m` : `${Math.round(mm)} mm`;
}
function formatLengthShort(mm, unit) {
  if (unit === "imperial") return formatLength(mm, unit);
  return mm >= 1e3 ? `${(mm / 1e3).toFixed(2)}` : `${Math.round(mm)}`;
}
function formatArea(mm2, unit) {
  if (unit === "imperial") {
    return `${(mm2 / MM2_PER_SQFT).toFixed(0)} ft\xB2`;
  }
  return `${(mm2 / MM2_PER_SQM).toFixed(1)} m\xB2`;
}

// src/floorplan.ts
function buildFloorplan(input) {
  const unitSystem = input.unitSystem;
  const height = input.height;
  const openings = input.openings ?? [];
  const objects = input.objects ?? [];
  const source = input.source ?? "manual";
  const confidence = input.confidence ?? 1;
  const wantSimplify = "simplify" in input ? input.simplify !== false : true;
  let points = input.polygon.map((p) => ({ x: p.x, z: p.z }));
  if (wantSimplify) points = simplifyPolygon(points);
  points = ensureCCW(points);
  const ccw = signedArea(points) > 0;
  const walls = points.map((start, i) => {
    const end = points[(i + 1) % points.length];
    const dir = normalize(sub(end, start));
    const outward = ccw ? perpCW(dir) : { x: -perpCW(dir).x, z: -perpCW(dir).z };
    return {
      index: i,
      start,
      end,
      length: distance(start, end),
      angle: Math.atan2(end.z - start.z, end.x - start.x),
      outward
    };
  });
  const b = bounds(points);
  return {
    points,
    walls,
    openings,
    objects,
    areaMm2: polygonArea(points),
    perimeterMm: perimeter(points),
    height,
    bounds: b,
    unitSystem,
    source,
    confidence
  };
}
var floorplanCenter = (fp) => centroid(fp.points);
function polygonScan(polygon, height, unitSystem, source = "manual", confidence = 0.7) {
  return {
    schema: "mozu.roomscan/1",
    polygon: polygon.map((p) => ({ x: p.x, z: p.z })),
    height,
    openings: [],
    objects: [],
    source,
    unitSystem,
    confidence,
    capturedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function rectangleScan(width, depth, height, unitSystem, source = "manual") {
  return {
    schema: "mozu.roomscan/1",
    polygon: [
      { x: 0, z: 0 },
      { x: width, z: 0 },
      { x: width, z: depth },
      { x: 0, z: depth }
    ],
    height,
    openings: [],
    objects: [],
    source,
    unitSystem,
    confidence: source === "manual" ? 1 : 0.9,
    capturedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}

// src/massing.ts
var DEFAULT_WALL_THICKNESS = 100;
var OBJECT_HEIGHTS = {
  refrigerator: 1800,
  fridge: 1800,
  wardrobe: 2e3,
  closet: 2e3,
  storage: 1800,
  cabinet: 900,
  counter: 900,
  table: 750,
  sofa: 850,
  bed: 600
};
var objectHeight = (o) => o.height ?? OBJECT_HEIGHTS[o.category.toLowerCase()] ?? 800;
function buildMassing(scan, opts = {}) {
  const thickness = opts.wallThickness ?? DEFAULT_WALL_THICKNESS;
  const boxes = [];
  const poly = scan.polygon;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length2 = Math.hypot(dx, dz);
    if (length2 < 1) continue;
    boxes.push({
      kind: "wall",
      center: { x: (a.x + b.x) / 2, y: scan.height / 2, z: (a.z + b.z) / 2 },
      size: { x: length2, y: scan.height, z: thickness },
      rotationY: Math.atan2(-dz, dx)
    });
  }
  const bounds2 = bounds(poly);
  if (opts.includeFloor !== false) {
    boxes.push({
      kind: "floor",
      center: {
        x: (bounds2.minX + bounds2.maxX) / 2,
        y: -30,
        z: (bounds2.minZ + bounds2.maxZ) / 2
      },
      size: { x: bounds2.maxX - bounds2.minX, y: 60, z: bounds2.maxZ - bounds2.minZ },
      rotationY: 0
    });
  }
  let maxY = scan.height;
  for (const obj of scan.objects) {
    const h = objectHeight(obj);
    maxY = Math.max(maxY, h);
    boxes.push({
      kind: "object",
      center: { x: obj.center.x, y: h / 2, z: obj.center.z },
      size: { x: obj.width, y: h, z: obj.depth },
      rotationY: obj.rotation,
      label: obj.category
    });
  }
  return {
    boxes,
    bounds: {
      min: { x: bounds2.minX, y: 0, z: bounds2.minZ },
      max: { x: bounds2.maxX, y: maxY, z: bounds2.maxZ }
    }
  };
}

// src/svg.ts
var LIGHT = {
  paper: "#ffffff",
  floor: "#f4f2ee",
  wall: "#1f2937",
  dimension: "#6b7280",
  label: "#111827",
  labelText: "#ffffff",
  area: "#374151",
  object: "#e6e1d8",
  accent: "#2563eb"
};
var DARK = {
  paper: "#0a0a0a",
  floor: "#161618",
  wall: "#e5e7eb",
  dimension: "#9ca3af",
  label: "#f9fafb",
  labelText: "#0a0a0a",
  area: "#d1d5db",
  object: "#2a2a2e",
  accent: "#22d3ee"
};
var THEMES = { light: LIGHT, dark: DARK };
var esc = (s) => s.replace(
  /[<>&"']/g,
  (c) => c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c === '"' ? "&quot;" : "&#39;"
);
var fmt = (n) => Math.abs(n) < 1e-6 ? "0" : Number(n.toFixed(2)).toString();
var pt = (p) => `${fmt(p.x)},${fmt(p.z)}`;
function floorplanToSvg(fp, opts = {}) {
  const theme = resolveTheme(opts.theme);
  const showDims = opts.dimensions !== false;
  const showArea = opts.showArea !== false;
  const showObjects = opts.showObjects !== false;
  const span = Math.max(fp.bounds.width, fp.bounds.depth) || 1e3;
  const pad = opts.padding ?? Math.max(span * 0.18, 700);
  const font = clamp(span / 20, 130, 360);
  const wallW = clamp(span / 45, 60, 140);
  const thin = Math.max(wallW * 0.16, 10);
  const dimOff = font * 1.5;
  const vb = {
    x: fp.bounds.minX - pad,
    y: fp.bounds.minZ - pad,
    w: fp.bounds.width + pad * 2,
    h: fp.bounds.depth + pad * 2
  };
  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(vb.x)} ${fmt(vb.y)} ${fmt(vb.w)} ${fmt(vb.h)}"` + (opts.width ? ` width="${opts.width}"` : "") + (opts.height ? ` height="${opts.height}"` : "") + ` font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif">`
  );
  parts.push(`<rect x="${fmt(vb.x)}" y="${fmt(vb.y)}" width="${fmt(vb.w)}" height="${fmt(vb.h)}" fill="${theme.paper}"/>`);
  const poly = fp.points.map(pt).join(" ");
  parts.push(`<polygon points="${poly}" fill="${theme.floor}"/>`);
  parts.push(
    `<polygon points="${poly}" fill="none" stroke="${theme.wall}" stroke-width="${fmt(wallW)}" stroke-linejoin="miter"/>`
  );
  if (showObjects) {
    for (const o of fp.objects) {
      const deg = o.rotation * 180 / Math.PI;
      parts.push(
        `<g transform="translate(${fmt(o.center.x)} ${fmt(o.center.z)}) rotate(${fmt(deg)})"><rect x="${fmt(-o.width / 2)}" y="${fmt(-o.depth / 2)}" width="${fmt(o.width)}" height="${fmt(o.depth)}" rx="${fmt(thin * 1.5)}" fill="${theme.object}" stroke="${theme.dimension}" stroke-width="${fmt(thin)}"/></g>`
      );
      parts.push(
        `<text x="${fmt(o.center.x)}" y="${fmt(o.center.z)}" font-size="${fmt(font * 0.55)}" fill="${theme.area}" text-anchor="middle" dominant-baseline="central">${esc(o.category)}</text>`
      );
    }
  }
  for (const op of fp.openings) {
    const wall = fp.walls[op.wall];
    if (wall) parts.push(opening(op, wall.start, wall.end, theme, wallW, thin));
  }
  if (showDims) {
    for (const wall of fp.walls) {
      if (wall.length < 1) continue;
      parts.push(
        dimension(wall.start, wall.end, wall.outward, wall.length, fp.unitSystem, theme, {
          off: dimOff,
          font,
          thin
        })
      );
    }
  }
  if (showArea) {
    const c = floorplanCenter(fp);
    parts.push(
      `<text x="${fmt(c.x)}" y="${fmt(c.z)}" font-size="${fmt(font * 1.05)}" font-weight="600" fill="${theme.area}" text-anchor="middle" dominant-baseline="central">${esc(formatArea(fp.areaMm2, fp.unitSystem))}</text>`
    );
    parts.push(
      `<text x="${fmt(c.x)}" y="${fmt(c.z + font * 1.25)}" font-size="${fmt(font * 0.62)}" fill="${theme.dimension}" text-anchor="middle" dominant-baseline="central">ceiling ${esc(formatLength(fp.height, fp.unitSystem))}</text>`
    );
  }
  parts.push("</svg>");
  return parts.join("");
}
function dimension(start, end, outward, len, unit, theme, s) {
  const n = normalize(outward);
  const a = add(start, scale(n, s.off));
  const b = add(end, scale(n, s.off));
  const ext = s.off * 0.85;
  const mid = midpoint(a, b);
  const label = formatLength(len, unit);
  const halfW = label.length * s.font * 0.31 + s.font * 0.3;
  const halfH = s.font * 0.7;
  const startExt = add(start, scale(n, ext));
  const endExt = add(end, scale(n, ext));
  return `<g stroke="${theme.dimension}" stroke-width="${fmt(s.thin)}" fill="none" stroke-linecap="round"><line x1="${fmt(start.x)}" y1="${fmt(start.z)}" x2="${fmt(startExt.x)}" y2="${fmt(startExt.z)}"/><line x1="${fmt(end.x)}" y1="${fmt(end.z)}" x2="${fmt(endExt.x)}" y2="${fmt(endExt.z)}"/><line x1="${fmt(a.x)}" y1="${fmt(a.z)}" x2="${fmt(b.x)}" y2="${fmt(b.z)}"/></g><rect x="${fmt(mid.x - halfW)}" y="${fmt(mid.z - halfH)}" width="${fmt(halfW * 2)}" height="${fmt(halfH * 2)}" rx="${fmt(halfH * 0.5)}" fill="${theme.label}"/><text x="${fmt(mid.x)}" y="${fmt(mid.z)}" font-size="${fmt(s.font * 0.8)}" font-weight="600" fill="${theme.labelText}" text-anchor="middle" dominant-baseline="central">${esc(label)}</text>`;
}
function opening(op, wallStart, wallEnd, theme, wallW, thin) {
  const dir = normalize(sub(wallEnd, wallStart));
  const total = distance(wallStart, wallEnd);
  const o = Math.min(op.offset, Math.max(0, total - op.width));
  const p0 = add(wallStart, scale(dir, o));
  const p1 = add(wallStart, scale(dir, o + op.width));
  const cut = `<line x1="${fmt(p0.x)}" y1="${fmt(p0.z)}" x2="${fmt(p1.x)}" y2="${fmt(p1.z)}" stroke="${theme.floor}" stroke-width="${fmt(wallW * 1.25)}"/>`;
  if (op.type === "window") {
    return cut + `<line x1="${fmt(p0.x)}" y1="${fmt(p0.z)}" x2="${fmt(p1.x)}" y2="${fmt(p1.z)}" stroke="${theme.wall}" stroke-width="${fmt(thin * 1.4)}"/>`;
  }
  const inward = { x: -dir.z, z: dir.x };
  const hinge = p0;
  const leafEnd = add(hinge, scale(inward, op.width));
  const arc = `<path d="M ${fmt(p1.x)} ${fmt(p1.z)} A ${fmt(op.width)} ${fmt(op.width)} 0 0 1 ${fmt(leafEnd.x)} ${fmt(leafEnd.z)}" fill="none" stroke="${theme.dimension}" stroke-width="${fmt(thin)}" stroke-dasharray="${fmt(thin * 3)} ${fmt(thin * 2)}"/>`;
  const leaf = `<line x1="${fmt(hinge.x)}" y1="${fmt(hinge.z)}" x2="${fmt(leafEnd.x)}" y2="${fmt(leafEnd.z)}" stroke="${theme.wall}" stroke-width="${fmt(thin * 1.4)}"/>`;
  return cut + arc + leaf;
}
function resolveTheme(t) {
  if (!t) return LIGHT;
  return typeof t === "string" ? THEMES[t] : t;
}
function clamp(v, lo, hi) {
  return Math.min(Math.max(v, lo), hi);
}

// src/serialize.ts
var toBase64Url = (s) => {
  const b64 = typeof btoa === "function" ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s, "utf8").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
var fromBase64Url = (s) => {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const text = typeof atob === "function" ? decodeURIComponent(escape(atob(b64))) : Buffer.from(b64, "base64").toString("utf8");
  return text;
};
function serializeScan(scan) {
  return JSON.stringify(scan);
}
function parseScan(input) {
  try {
    const raw = input.trim().startsWith("{") ? input : fromBase64Url(input);
    const data = JSON.parse(raw);
    if (!Array.isArray(data.polygon) || data.polygon.length < 3) return null;
    const polygon = data.polygon.map((p) => ({ x: Number(p.x), z: Number(p.z) })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.z));
    if (polygon.length < 3) return null;
    return {
      schema: ROOMSCAN_SCHEMA,
      polygon,
      height: Number(data.height) || 2700,
      openings: Array.isArray(data.openings) ? data.openings : [],
      objects: Array.isArray(data.objects) ? data.objects : [],
      source: data.source ?? "manual",
      unitSystem: data.unitSystem ?? "metric",
      confidence: typeof data.confidence === "number" ? data.confidence : 0.8,
      capturedAt: typeof data.capturedAt === "string" ? data.capturedAt : (/* @__PURE__ */ new Date()).toISOString()
    };
  } catch {
    return null;
  }
}
var polyParam = (polygon) => polygon.map((p) => `${Math.round(p.x)},${Math.round(p.z)}`).join(";");
function handoffUrl(webBase, scan) {
  const base = webBase.replace(/\/+$/, "");
  const params = new URLSearchParams();
  params.set("poly", polyParam(scan.polygon));
  params.set("h", String(Math.round(scan.height)));
  params.set("src", scan.source);
  if (scan.openings.length || scan.objects.length) {
    params.set("scan", toBase64Url(serializeScan(scan)));
  }
  return `${base}/scan?${params.toString()}`;
}
function scanFromParams(search) {
  const p = typeof search === "string" ? new URLSearchParams(search) : search;
  const rich = p.get("scan");
  if (rich) {
    const parsed = parseScan(rich);
    if (parsed) return parsed;
  }
  const height = Number(p.get("h")) || 2700;
  const unitSystem = "metric";
  const source = p.get("src") ?? "manual";
  const poly = p.get("poly");
  if (poly) {
    const polygon = poly.split(";").map((s) => {
      const [x, z] = s.split(",").map(Number);
      return { x, z };
    }).filter((v) => Number.isFinite(v.x) && Number.isFinite(v.z));
    if (polygon.length >= 3) {
      return {
        schema: ROOMSCAN_SCHEMA,
        polygon,
        height,
        openings: [],
        objects: [],
        source,
        unitSystem,
        confidence: 0.9,
        capturedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
    }
  }
  const w = Number(p.get("w"));
  const d = Number(p.get("d"));
  if (w > 0 && d > 0) {
    return {
      schema: ROOMSCAN_SCHEMA,
      polygon: [
        { x: 0, z: 0 },
        { x: w, z: 0 },
        { x: w, z: d },
        { x: 0, z: d }
      ],
      height,
      openings: [],
      objects: [],
      source,
      unitSystem,
      confidence: 0.85,
      capturedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  return null;
}

// src/webxr.ts
var DEFAULT_HEIGHT_MM = 2700;
var getXR = () => typeof navigator !== "undefined" ? navigator.xr : void 0;
async function isWebXrSupported() {
  try {
    return await getXR()?.isSessionSupported?.("immersive-ar") ?? false;
  } catch {
    return false;
  }
}
async function scanRoomWithWebXR(opts = {}) {
  const xr = getXR();
  if (!xr?.requestSession) throw new Error("WebXR is not available on this device/browser.");
  const overlay = document.createElement("div");
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    pointerEvents: "none",
    fontFamily: "system-ui, sans-serif",
    color: "white"
  });
  overlay.innerHTML = `
    <div style="padding:16px;pointer-events:none">
      <div style="background:rgba(0,0,0,.55);padding:8px 12px;border-radius:8px;font-size:13px;max-width:80%">
        Aim the dot at a floor corner and tap <b>Add corner</b>. Walk the room, add every corner, then <b>Done</b>.
      </div>
    </div>
    <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none">
      <div id="ar-reticle" style="width:22px;height:22px;border:3px solid #22d3ee;border-radius:50%;opacity:.5"></div>
    </div>
    <div style="padding:16px;display:flex;gap:8px;align-items:center;pointer-events:auto">
      <button id="ar-add" style="flex:1;padding:12px;border:0;border-radius:8px;background:#22d3ee;color:#06121a;font-weight:600;font-size:15px">Add corner (<span id="ar-count">0</span>)</button>
      <button id="ar-done" style="padding:12px 16px;border:0;border-radius:8px;background:white;color:#111;font-weight:600">Done</button>
      <button id="ar-cancel" style="padding:12px 14px;border:0;border-radius:8px;background:rgba(255,255,255,.2);color:white">\u2715</button>
    </div>`;
  document.body.appendChild(overlay);
  const $ = (id) => overlay.querySelector(id);
  const reticle = $("#ar-reticle");
  const countEl = $("#ar-count");
  const addBtn = $("#ar-add");
  const doneBtn = $("#ar-done");
  const cancelBtn = $("#ar-cancel");
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl", { xrCompatible: true });
  if (!gl) {
    overlay.remove();
    throw new Error("WebGL unavailable.");
  }
  let session;
  try {
    session = await xr.requestSession("immersive-ar", {
      requiredFeatures: ["hit-test"],
      optionalFeatures: ["dom-overlay", "local-floor"],
      domOverlay: { root: overlay }
    });
  } catch (e) {
    overlay.remove();
    throw e instanceof Error ? e : new Error("Could not start AR session.");
  }
  await gl.makeXRCompatible?.();
  const XRWebGLLayerCtor = window.XRWebGLLayer;
  session.updateRenderState({ baseLayer: new XRWebGLLayerCtor(session, gl) });
  const refSpace = await session.requestReferenceSpace("local").catch(() => session.requestReferenceSpace("viewer"));
  const viewerSpace = await session.requestReferenceSpace("viewer");
  const hitTestSource = await session.requestHitTestSource({ space: viewerSpace });
  const corners = [];
  let lastHit = null;
  return await new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try {
        hitTestSource.cancel?.();
      } catch {
      }
      overlay.remove();
      try {
        session.end();
      } catch {
      }
      resolve(result);
    };
    addBtn.onclick = () => {
      if (!lastHit) return;
      corners.push({ x: lastHit.x, z: lastHit.z });
      countEl.textContent = String(corners.length);
    };
    doneBtn.onclick = () => finish(
      corners.length >= 3 ? {
        schema: ROOMSCAN_SCHEMA,
        polygon: corners,
        height: opts.height ?? DEFAULT_HEIGHT_MM,
        openings: [],
        objects: [],
        source: "webxr",
        unitSystem: opts.unitSystem ?? "metric",
        confidence: 0.85,
        capturedAt: (/* @__PURE__ */ new Date()).toISOString()
      } : null
    );
    cancelBtn.onclick = () => finish(null);
    session.addEventListener("end", () => finish(null));
    const onFrame = (_t, frame) => {
      if (settled) return;
      const layer = session.renderState.baseLayer;
      gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const hits = frame.getHitTestResults(hitTestSource);
      if (hits.length > 0) {
        const pose = hits[0].getPose(refSpace);
        if (pose) {
          lastHit = { x: pose.transform.position.x * 1e3, z: pose.transform.position.z * 1e3 };
          reticle.style.opacity = "1";
        }
      } else {
        reticle.style.opacity = ".4";
      }
      session.requestAnimationFrame(onFrame);
    };
    session.requestAnimationFrame(onFrame);
  });
}

// src/camera.ts
function captureRotationFrames(video, opts = {}) {
  const total = opts.frames ?? 6;
  const intervalMs = opts.intervalMs ?? 1200;
  const maxWidth = opts.maxWidth ?? 1024;
  const frames = [];
  const grab = () => {
    const vw = video.videoWidth || 1280;
    const vh = video.videoHeight || 720;
    const s = Math.min(1, maxWidth / vw);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(vw * s);
    canvas.height = Math.round(vh * s);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.6).split(",")[1] ?? null;
  };
  return new Promise((resolve) => {
    const tick = () => {
      const f = grab();
      if (f) {
        frames.push(f);
        opts.onProgress?.(frames.length, total);
      }
      if (frames.length >= total) resolve(frames);
      else window.setTimeout(tick, intervalMs);
    };
    window.setTimeout(tick, 400);
  });
}
var CONFIDENCE = { low: 0.4, medium: 0.6, high: 0.75 };
async function estimateRoomFromImages(images, opts = {}) {
  if (images.length === 0) throw new Error("No frames captured.");
  const res = await fetch(opts.endpoint ?? "/api/estimate-room", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ images })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Estimate failed (${res.status}).`);
  const scan = rectangleScan(
    data.widthMm,
    data.depthMm,
    data.heightMm,
    opts.unitSystem ?? "metric",
    "camera"
  );
  scan.confidence = CONFIDENCE[data.confidence ?? "low"] ?? 0.4;
  return scan;
}

// src/scanner.ts
var MozuScanner = class {
  constructor(opts = {}) {
    this.opts = opts;
  }
  /** Best capture path available on this device, best-first. */
  async capability() {
    if (await isWebXrSupported()) return "webxr";
    if (typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function")
      return "camera";
    return "manual";
  }
  /** Metric AR corner-tap scan (Android). Resolves null if cancelled. */
  scanWithAR() {
    return scanRoomWithWebXR({ unitSystem: this.opts.unitSystem });
  }
  /** Capture a rotation sweep and estimate W×D×H with the vision endpoint. */
  async scanWithCamera(video, onProgress) {
    const images = await captureRotationFrames(video, { onProgress });
    return estimateRoomFromImages(images, {
      endpoint: this.opts.estimateEndpoint,
      unitSystem: this.opts.unitSystem
    });
  }
  /** Manual rectangle (the universal fallback / seed for editing). */
  manual(width, depth, height) {
    return rectangleScan(width, depth, height, this.opts.unitSystem ?? "metric", "manual");
  }
  /** Scan → dimensioned floorplan. */
  floorplan(scan) {
    return buildFloorplan(scan);
  }
  /** Scan → box massing model (walls + floor + detected objects). */
  massing(scan) {
    return buildMassing(scan);
  }
  /** Scan (or floorplan) → standalone SVG plan. */
  toSvg(input, svgOpts) {
    const fp = "walls" in input ? input : buildFloorplan(input);
    return floorplanToSvg(fp, svgOpts);
  }
  /** Deep link that opens the MOZU configurator on this measured room. */
  handoff(scan) {
    if (!this.opts.webBase) throw new Error("webBase not configured.");
    return handoffUrl(this.opts.webBase, scan);
  }
};
export {
  MozuScanner,
  ROOMSCAN_SCHEMA,
  THEMES,
  add,
  bounds,
  buildFloorplan,
  buildMassing,
  captureRotationFrames,
  centroid,
  distance,
  dot,
  ensureCCW,
  estimateRoomFromImages,
  floorplanCenter,
  floorplanToSvg,
  formatArea,
  formatLength,
  formatLengthShort,
  handoffUrl,
  isWebXrSupported,
  length,
  midpoint,
  normalize,
  parseScan,
  perimeter,
  perpCCW,
  perpCW,
  polygonArea,
  polygonScan,
  rectangleScan,
  scale,
  scanFromParams,
  scanRoomWithWebXR,
  serializeScan,
  signedArea,
  simplifyPolygon,
  sub
};
