/**
 * Full-page scan → floorplan workspace. Every mode produces a `RoomScan`; the
 * SDK turns it into a dimensioned floorplan, which can be downloaded as SVG or
 * opened directly in the MOZU configurator. Same engine the web app and the iOS
 * app use, so the plan is identical everywhere.
 */
import {
  MozuScanner,
  buildFloorplan,
  floorplanToSvg,
  formatArea,
  formatLength,
  polygonScan,
  rectangleScan,
} from './vendor/mozu-scan-sdk.js';

const ext = globalThis.browser ?? globalThis.chrome;
const $ = (id) => document.getElementById(id);
const num = (id) => Number($(id).value) || 0;

let webBase = 'https://app.mozu.example';
let scanner = new MozuScanner({ webBase });
let currentScan = null;

async function init() {
  const { mozuBase } = await ext.storage.sync.get({ mozuBase: webBase });
  webBase = (mozuBase || webBase).replace(/\/+$/, '');
  scanner = new MozuScanner({ webBase, estimateEndpoint: `${webBase}/api/estimate-room` });

  const cap = await scanner.capability();
  $('cap').textContent =
    cap === 'webxr'
      ? 'AR scan available on this device'
      : cap === 'camera'
        ? 'Camera available — trace, camera-estimate, or manual'
        : 'Trace or enter dimensions';
  if (cap === 'webxr') $('tab-ar').hidden = false;

  wireTabs();
  wireTrace();
  wireCamera();
  wireManual();
  wireAr();
  wireResultActions();
}

// ── Tabs ─────────────────────────────────────────────────────────────────────
function wireTabs() {
  for (const btn of document.querySelectorAll('.tabs button')) {
    btn.addEventListener('click', () => {
      for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-selected', 'false');
      btn.setAttribute('aria-selected', 'true');
      for (const m of document.querySelectorAll('.mode')) m.classList.remove('active');
      $(`mode-${btn.dataset.mode}`).classList.add('active');
    });
  }
}

// ── Result rendering ─────────────────────────────────────────────────────────
function showFloorplan(scan) {
  if (!scan) return;
  currentScan = scan;
  const fp = buildFloorplan(scan);
  $('preview').innerHTML = floorplanToSvg(fp, { theme: 'light' });
  const stats = $('stats');
  stats.hidden = false;
  stats.innerHTML = [
    ['Area', formatArea(fp.areaMm2, fp.unitSystem)],
    ['Perimeter', formatLength(fp.perimeterMm, fp.unitSystem)],
    ['Ceiling', formatLength(fp.height, fp.unitSystem)],
    ['Walls', String(fp.walls.length)],
  ]
    .map(([s, v]) => `<div class="stat"><b>${v}</b><span>${s}</span></div>`)
    .join('');
  $('download').disabled = false;
  $('open-mozu').disabled = false;
}

function wireResultActions() {
  $('download').addEventListener('click', () => {
    if (!currentScan) return;
    const svg = floorplanToSvg(buildFloorplan(currentScan), { theme: 'light' });
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mozu-floorplan.svg';
    a.click();
    URL.revokeObjectURL(url);
  });
  $('open-mozu').addEventListener('click', () => {
    if (!currentScan) return;
    ext.tabs.create({ url: scanner.handoff(currentScan) });
  });
}

// ── Trace (tap corners) ──────────────────────────────────────────────────────
function wireTrace() {
  const svg = $('trace-canvas');
  const NS = 'http://www.w3.org/2000/svg';
  let pts = [];

  const redraw = () => {
    svg.innerHTML = '';
    if (pts.length > 1) {
      const poly = document.createElementNS(NS, 'polyline');
      poly.setAttribute('points', pts.map((p) => `${p.x},${p.z}`).join(' '));
      poly.setAttribute('fill', 'rgba(34,211,238,0.12)');
      poly.setAttribute('stroke', '#22d3ee');
      poly.setAttribute('stroke-width', '3');
      svg.appendChild(poly);
    }
    if (pts.length > 2) {
      const close = document.createElementNS(NS, 'line');
      const a = pts[pts.length - 1];
      const b = pts[0];
      close.setAttribute('x1', a.x);
      close.setAttribute('y1', a.z);
      close.setAttribute('x2', b.x);
      close.setAttribute('y2', b.z);
      close.setAttribute('stroke', '#22d3ee');
      close.setAttribute('stroke-dasharray', '7 7');
      close.setAttribute('stroke-width', '2');
      svg.appendChild(close);
    }
    for (const p of pts) {
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', p.x);
      c.setAttribute('cy', p.z);
      c.setAttribute('r', '7');
      c.setAttribute('fill', '#22d3ee');
      svg.appendChild(c);
    }
  };

  svg.addEventListener('pointerdown', (e) => {
    const r = svg.getBoundingClientRect();
    pts.push({ x: e.clientX - r.left, z: e.clientY - r.top });
    redraw();
  });
  $('trace-undo').addEventListener('click', () => {
    pts.pop();
    redraw();
  });
  $('trace-clear').addEventListener('click', () => {
    pts = [];
    redraw();
  });
  $('trace-build').addEventListener('click', () => {
    if (pts.length < 3) return;
    const xs = pts.map((p) => p.x);
    const zs = pts.map((p) => p.z);
    const spanX = Math.max(...xs) - Math.min(...xs) || 1;
    const scale = num('trace-w') / spanX;
    const minX = Math.min(...xs);
    const minZ = Math.min(...zs);
    const vertices = pts.map((p) => ({
      x: Math.round((p.x - minX) * scale),
      z: Math.round((p.z - minZ) * scale),
    }));
    showFloorplan(polygonScan(vertices, num('trace-h'), 'metric', 'manual', 0.6));
  });
}

// ── Camera (turn-around estimate) ────────────────────────────────────────────
function wireCamera() {
  const video = $('cam');
  let stream = null;

  $('cam-start').addEventListener('click', async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();
      $('cam-scan').disabled = false;
      $('cam-status').textContent = 'Camera ready — tap Scan and slowly turn a full circle.';
    } catch (err) {
      $('cam-status').textContent = `Camera error: ${err.message}. Camera needs HTTPS/permission.`;
    }
  });

  $('cam-scan').addEventListener('click', async () => {
    // The AI estimate posts to the configured MOZU host — request access first.
    try {
      await ext.permissions.request({ origins: [`${new URL(webBase).origin}/*`] });
    } catch {
      /* user may decline; fetch will then surface the error */
    }
    $('cam-scan').disabled = true;
    $('cam-status').textContent = 'Scanning…';
    try {
      const scan = await scanner.scanWithCamera(video, (n, total) => {
        $('cam-status').textContent = `Captured ${n}/${total} views — keep turning…`;
      });
      $('cam-status').textContent = 'Estimated — review the plan, then open in MOZU.';
      showFloorplan(scan);
    } catch (err) {
      $('cam-status').textContent = `Estimate failed: ${err.message}`;
    } finally {
      $('cam-scan').disabled = false;
    }
  });
}

// ── Manual ───────────────────────────────────────────────────────────────────
function wireManual() {
  $('man-build').addEventListener('click', () =>
    showFloorplan(rectangleScan(num('man-w'), num('man-d'), num('man-h'), 'metric', 'manual')),
  );
}

// ── AR (WebXR) ───────────────────────────────────────────────────────────────
function wireAr() {
  $('ar-scan').addEventListener('click', async () => {
    $('ar-status').textContent = 'Starting AR…';
    try {
      const scan = await scanner.scanWithAR();
      if (!scan) {
        $('ar-status').textContent = 'Cancelled.';
        return;
      }
      $('ar-status').textContent = `Measured ${scan.polygon.length} corners.`;
      showFloorplan(scan);
    } catch (err) {
      $('ar-status').textContent = `AR failed: ${err.message}`;
    }
  });
}

init();
