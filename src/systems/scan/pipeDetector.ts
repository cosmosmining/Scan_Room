/**
 * Exposed-pipe detector — the other half of "the scan finds the services".
 *
 * In a real room the pipework that matters to a kitchen layout is on the wall
 * surface, not buried: supply drops, waste branches, soil stacks, gas services,
 * radiator tails. All of them share one signature a camera can see — a LONG RUN
 * OF NEAR-CONSTANT WIDTH. That is what this detector keys on, because it is the
 * property that separates a pipe from the things that also make long marks on a
 * wall: shadows (soft, uneven width), cables (far too thin), door frames and
 * skirting (far too wide, and rejected once sized in millimetres).
 *
 * Pure TypeScript, no dependencies, same `DetectorImage` contract as the socket
 * detector, so it runs on a browser canvas and in Node tests alike. It reports
 * the pipe's APPARENT BORE IN PIXELS; `fixtureProjection` turns that into a real
 * diameter using the LiDAR distance to the wall, and the diameter is what names
 * the service (water / gas / waste).
 */
import type { DetectorImage, DetectorOptions } from './fixtureDetector';

export interface PipeDetection {
  /** Bounding box centre and size, normalised 0..1. */
  cx: number;
  cy: number;
  w: number;
  h: number;
  /** Confidence 0..1. */
  score: number;
  /** Apparent bore (the run's short axis) in pixels of the ORIGINAL image. */
  widthPx: number;
  /** Axis angle in radians (0 = horizontal run, ±π/2 = vertical run). */
  angle: number;
  /** True when the run is closer to vertical than horizontal. */
  vertical: boolean;
  /** Mean yellowness 0..1 inside the run — the gas-pipework colour cue. */
  yellowness: number;
  /** Length / width of the run. */
  elongation: number;
}

export interface PipeDetector {
  detect(image: DetectorImage, opts?: DetectorOptions): PipeDetection[];
}

interface Px {
  x: number;
  y: number;
}

/**
 * Narrowest run (in analysis pixels) that still counts as pipework. Below this
 * the cross-section cannot be measured, so it is an edge or a cable, not a pipe.
 */
const MIN_BORE_PX = 3;

/** Grayscale + RGB sums, downscaled so the analysis is resolution-independent. */
function prepare(img: DetectorImage, maxDim: number) {
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const g = new Float32Array(w * h);
  const r = new Float32Array(w * h);
  const gr = new Float32Array(w * h);
  const b = new Float32Array(w * h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    const sy = Math.min(img.height - 1, Math.floor(y / scale));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.floor(x / scale));
      const i = (sy * img.width + sx) * 4;
      const R = d[i], G = d[i + 1], B = d[i + 2];
      const k = y * w + x;
      r[k] = R; gr[k] = G; b[k] = B;
      g[k] = 0.299 * R + 0.587 * G + 0.114 * B;
    }
  }
  return { g, r, gr, b, w, h, scale };
}

function integral(g: Float32Array, w: number, h: number): Float64Array {
  const s = new Float64Array((w + 1) * (h + 1));
  for (let y = 1; y <= h; y++) {
    let row = 0;
    for (let x = 1; x <= w; x++) {
      row += g[(y - 1) * w + (x - 1)];
      s[y * (w + 1) + x] = s[(y - 1) * (w + 1) + x] + row;
    }
  }
  return s;
}

function boxSum(s: Float64Array, w: number, x: number, y: number, r: number, h: number): number {
  const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r);
  const x1 = Math.min(w, x + r + 1), y1 = Math.min(h, y + r + 1);
  const W = w + 1;
  return s[y1 * W + x1] - s[y0 * W + x1] - s[y1 * W + x0] + s[y0 * W + x0];
}

function boxCount(w: number, h: number, x: number, y: number, r: number): number {
  const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r);
  const x1 = Math.min(w, x + r + 1), y1 = Math.min(h, y + r + 1);
  return (x1 - x0) * (y1 - y0);
}

function boxMean(s: Float64Array, w: number, h: number, x: number, y: number, r: number): number {
  const n = boxCount(w, h, x, y, r);
  return n > 0 ? boxSum(s, w, x, y, r, h) / n : 0;
}

/**
 * Estimate the wall behind the clutter.
 *
 * A plain local mean is not usable as a background here: next to a strong
 * feature the window is dragged toward it, so the wall pixels flanking a pipe
 * also read as "different from local mean" and the pipe's mask blooms outward by
 * roughly the window radius — a 12px pipe measures 35px, and the width is the
 * whole point of this detector. So estimate the background from the pixels that
 * a first rough pass did NOT flag, which leaves the true wall level either side
 * of the pipe intact.
 */
function backgroundExcludingOutliers(
  channels: Float32Array[],
  g: Float32Array,
  w: number,
  h: number,
  rad: number,
  delta: number,
): Float32Array[] {
  const flat = integral(g, w, h);
  const rough = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (Math.abs(g[i] - boxMean(flat, w, h, x, y, rad)) > delta) rough[i] = 1;
    }
  }

  const keptMask = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) if (!rough[i]) keptMask[i] = 1;
  const sCount = integral(keptMask, w, h);

  // Right beside a strong feature EVERY pixel in the window can be flagged, so
  // a plain local-mean fallback would drag the background back toward the pipe
  // and re-create the halo it is there to prevent. Widen the search until
  // enough clean wall is in view, and only then settle for the global average.
  const MIN_CLEAN = 24;
  const radii = [rad, rad * 2, rad * 4];

  return channels.map((ch) => {
    const kept = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) if (!rough[i]) kept[i] = ch[i];
    const sKept = integral(kept, w, h);

    const totalClean = sCount[(h + 1) * (w + 1) - 1];
    const globalClean = totalClean > 0
      ? sKept[(h + 1) * (w + 1) - 1] / totalClean
      : boxMean(integral(ch, w, h), w, h, (w / 2) | 0, (h / 2) | 0, Math.max(w, h));

    const bg = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        let value = globalClean;
        for (const r of radii) {
          const n = boxSum(sCount, w, x, y, r, h);
          if (n >= MIN_CLEAN) {
            value = boxSum(sKept, w, x, y, r, h) / n;
            break;
          }
        }
        bg[i] = value;
      }
    }
    return bg;
  });
}

/** 8-connected components, keeping each component's pixels for shape analysis. */
function components(mask: Uint8Array, w: number, h: number, minArea: number): Px[][] {
  const seen = new Uint8Array(w * h);
  const out: Px[][] = [];
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || seen[i]) continue;
    stack.length = 0;
    stack.push(i);
    seen[i] = 1;
    const pixels: Px[] = [];
    while (stack.length) {
      const p = stack.pop()!;
      const px = p % w, py = (p / w) | 0;
      pixels.push({ x: px, y: py });
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = px + dx, ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (mask[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
        }
      }
    }
    if (pixels.length >= minArea) out.push(pixels);
  }
  return out;
}

/** Principal axis of a pixel cloud (largest-eigenvalue eigenvector of covariance). */
function principalAxis(pixels: Px[]): { ux: number; uy: number; cx: number; cy: number } {
  let cx = 0, cy = 0;
  for (const p of pixels) { cx += p.x; cy += p.y; }
  cx /= pixels.length; cy /= pixels.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pixels) {
    const dx = p.x - cx, dy = p.y - cy;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  sxx /= pixels.length; syy /= pixels.length; sxy /= pixels.length;
  // Eigenvector for the larger eigenvalue of [[sxx,sxy],[sxy,syy]].
  const tr = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const disc = Math.max(0, (tr * tr) / 4 - det);
  const lambda = tr / 2 + Math.sqrt(disc);
  let ux = sxy, uy = lambda - sxx;
  if (Math.hypot(ux, uy) < 1e-9) { ux = 1; uy = 0; }
  const len = Math.hypot(ux, uy);
  return { ux: ux / len, uy: uy / len, cx, cy };
}

/**
 * Detect exposed pipes in one frame.
 *
 * Pipeline: local-contrast mask (a pipe reads either darker OR brighter than the
 * wall, so the test is on |difference|) → connected components → principal axis →
 * length/width from the axis-aligned extents → per-station width sampling to
 * demand CONSTANT width → score → non-max suppression.
 */
export function detectPipes(img: DetectorImage, opts: DetectorOptions = {}): PipeDetection[] {
  // Higher working resolution than the socket detector: a 22mm supply pipe a
  // few metres away is only a handful of pixels, and downscaling too hard
  // erases exactly the small bores we need to size.
  const maxDim = opts.maxDim ?? 640;
  const minScore = opts.minScore ?? 0.4;
  const { g, r, gr, b, w, h, scale } = prepare(img, maxDim);
  if (w < 12 || h < 12) return [];

  // Local window a good deal wider than a pipe, so the pipe stands out from it.
  const rad = Math.max(4, Math.round(Math.min(w, h) * 0.06));
  const delta = 10;
  const [bgR, bgG, bgB] = backgroundExcludingOutliers([r, gr, b], g, w, h, rad, delta);

  // Compare in COLOUR, not just brightness. Yellow gas pipework can sit at
  // almost exactly the wall's luminance while being nothing like its colour —
  // a grayscale test splits such a pipe down the middle and ruins the width
  // measurement. The largest per-channel departure from the local wall colour
  // catches both a dark grey waste stack and a yellow gas run.
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const d = Math.max(
      Math.abs(r[i] - bgR[i]),
      Math.abs(gr[i] - bgG[i]),
      Math.abs(b[i] - bgB[i]),
    );
    if (d > delta) mask[i] = 1;
  }

  const minLen = Math.max(10, Math.round(Math.min(w, h) * 0.18));
  const comps = components(mask, w, h, minLen * 2);
  const dets: PipeDetection[] = [];

  for (const pixels of comps) {
    const { ux, uy, cx, cy } = principalAxis(pixels);
    // Extents along the principal (major) and perpendicular (minor) axes.
    let tMin = Infinity, tMax = -Infinity, nMin = Infinity, nMax = -Infinity;
    for (const p of pixels) {
      const dx = p.x - cx, dy = p.y - cy;
      const t = dx * ux + dy * uy;
      const n = -dx * uy + dy * ux;
      if (t < tMin) tMin = t; if (t > tMax) tMax = t;
      if (n < nMin) nMin = n; if (n > nMax) nMax = n;
    }
    const length = tMax - tMin;
    const width = Math.max(1, nMax - nMin);
    if (length < minLen) continue;
    const elongation = length / width;
    if (elongation < 4) continue; // a pipe is long; a socket plate or blob is not
    if (width > Math.min(w, h) * 0.25) continue; // too fat to be pipework in frame

    // Constant-width test: slice the run into stations along its axis and
    // measure the perpendicular spread in each. A pipe barely varies; a shadow
    // or a smear does. This is the discriminator that carries the detector.
    const STATIONS = 9;
    const lo: number[] = new Array(STATIONS).fill(Infinity);
    const hi: number[] = new Array(STATIONS).fill(-Infinity);
    const count: number[] = new Array(STATIONS).fill(0);
    for (const p of pixels) {
      const dx = p.x - cx, dy = p.y - cy;
      const t = dx * ux + dy * uy;
      const n = -dx * uy + dy * ux;
      let k = Math.floor(((t - tMin) / (length || 1)) * STATIONS);
      if (k < 0) k = 0; if (k >= STATIONS) k = STATIONS - 1;
      if (n < lo[k]) lo[k] = n;
      if (n > hi[k]) hi[k] = n;
      count[k]++;
    }
    const widths: number[] = [];
    let filled = 0;
    for (let k = 0; k < STATIONS; k++) {
      if (count[k] === 0) continue;
      filled++;
      widths.push(Math.max(1, hi[k] - lo[k]));
    }
    // A pipe is continuous: most stations must actually contain pixels.
    if (filled < STATIONS - 2) continue;
    const mean = widths.reduce((a, c) => a + c, 0) / widths.length;
    // A pipe shows a BORE. A hairline — the edge of a shadow, a cable, a grout
    // line, the boundary of a painted band — has no measurable width, and its
    // width statistics are pixel noise. Require a real cross-section.
    if (mean < MIN_BORE_PX) continue;
    const varc = widths.reduce((a, c) => a + (c - mean) ** 2, 0) / widths.length;
    const cv = Math.sqrt(varc) / (mean || 1);
    if (cv > 0.28) continue; // width wanders → not a pipe

    // Solidity: the run should mostly fill its own oriented box.
    const solidity = pixels.length / Math.max(1, length * mean);
    if (solidity < 0.5) continue;

    // Colour cue for gas (yellow pipework / sleeve).
    let sr = 0, sg = 0, sb = 0;
    for (const p of pixels) {
      const k = p.y * w + p.x;
      sr += r[k]; sg += gr[k]; sb += b[k];
    }
    const n = pixels.length;
    const yellowness = Math.max(0, Math.min(1, (Math.min(sr, sg) / n - sb / n) / 90));

    const angle = Math.atan2(uy, ux);
    const vertical = Math.abs(Math.sin(angle)) > Math.SQRT1_2;

    // Bounding box in normalised image coordinates.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pixels) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }

    // Score: straight, even-width, solid, decently long runs win.
    const widthScore = 1 - Math.min(1, cv / 0.28);
    const elongScore = Math.min(1, elongation / 12);
    const score = 0.45 * widthScore + 0.35 * elongScore + 0.2 * Math.min(1, solidity);

    dets.push({
      cx: (minX + maxX) / 2 / w,
      cy: (minY + maxY) / 2 / h,
      w: (maxX - minX + 1) / w,
      h: (maxY - minY + 1) / h,
      score,
      // Report the bore in ORIGINAL-image pixels so sizing is independent of
      // the downscale factor used for analysis.
      widthPx: mean / scale,
      angle,
      vertical,
      yellowness,
      elongation,
    });
  }

  dets.sort((a, b2) => b2.score - a.score);
  const kept: PipeDetection[] = [];
  for (const d of dets) {
    if (d.score < minScore) continue;
    if (kept.some((k) => iou(k, d) > 0.3)) continue;
    kept.push(d);
  }
  return kept;
}

const iou = (a: PipeDetection, b: PipeDetection): number => {
  const ax0 = a.cx - a.w / 2, ay0 = a.cy - a.h / 2, ax1 = a.cx + a.w / 2, ay1 = a.cy + a.h / 2;
  const bx0 = b.cx - b.w / 2, by0 = b.cy - b.h / 2, bx1 = b.cx + b.w / 2, by1 = b.cy + b.h / 2;
  const ix = Math.max(0, Math.min(ax1, bx1) - Math.max(ax0, bx0));
  const iy = Math.max(0, Math.min(ay1, by1) - Math.max(ay0, by0));
  const inter = ix * iy;
  const uni = a.w * a.h + b.w * b.h - inter;
  return uni > 0 ? inter / uni : 0;
};

/** Default engine: the built-in heuristic pipe detector. */
export const heuristicPipeDetector: PipeDetector = { detect: detectPipes };
