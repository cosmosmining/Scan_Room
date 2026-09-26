/**
 * Camera-frame socket detector — the vision half of "scan the sockets on the wall".
 *
 * It finds the one feature that reliably distinguishes a mains socket from the
 * flat wall around it: a tight cluster of small DARK slots (the pin holes) sitting
 * on a lighter faceplate. The pipeline is classical CV so it runs anywhere a camera
 * frame is available — in the browser on a `<canvas>` `ImageData`, or in Node on a
 * hand-built buffer for tests — with no model download and no network.
 *
 * It is deliberately a CANDIDATE detector: it proposes boxes with a confidence, and
 * the capture UI has the user confirm them (so a false positive never silently
 * places a socket). A trained CoreML / YOLO / cloud model implements the same
 * {@link SocketDetector} contract for higher precision — see `detectWallFixtures`.
 */

/** RGBA pixel buffer, shaped like the browser's `ImageData`. */
export interface DetectorImage {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

/** A detected socket, box in normalised image coords (0..1, origin top-left). */
export interface SocketDetection {
  cx: number; // box centre x, 0..1
  cy: number; // box centre y, 0..1
  w: number; // box width, 0..1
  h: number; // box height, 0..1
  score: number; // confidence 0..1
  holes: number; // dark slots that formed the cluster
  /**
   * Shorter side of the plate box in ANALYSIS pixels. Carried because it is the
   * honest measure of whether the dark features could have been resolved at
   * all, which is what makes `holes` usable for telling a power outlet from a
   * coax plate — and useless beyond a couple of metres.
   */
  platePx: number;
}

export interface DetectorOptions {
  /** Longest edge the frame is scaled to before analysis (speed vs. detail). */
  maxDim?: number;
  /** Minimum confidence to return. */
  minScore?: number;
}

export interface SocketDetector {
  detect(image: DetectorImage, opts?: DetectorOptions): SocketDetection[];
}

interface Blob {
  minx: number;
  miny: number;
  maxx: number;
  maxy: number;
  area: number;
  cx: number;
  cy: number;
}

/**
 * What the detector actually looks for — learned the hard way on device.
 *
 * The first version keyed on "a cluster of dark pin slots" and drowned in the
 * real world: cable shadows, scuffs and dark trim make slot-sized dark specks
 * everywhere (157 phantom sockets in 50 frames on one wall), while the real
 * outlet sat unboxed. The reliable signature is the one a person uses: a socket
 * is a WHITE LITTLE BLOCK on the wall — a bright, solid, plate-sized rectangle —
 * with a few small dark features inside it (pin slots, a ground hole, a rocker
 * seam). So the plate is the detection and the dark features are only the
 * confirmation that the bright rectangle is electrical, not a sticker.
 */

/**
 * Mask threshold — deliberately inclusive; the per-candidate tiers below make
 * the real decision. A plate only slightly brighter than the wall still forms
 * a component here and then has to earn its keep with features.
 */
const BRIGHT_DELTA = 8;
/** At this contrast a plate needs only one confirming feature. */
const STRONG_CONTRAST = 12;
/** Below STRONG_CONTRAST, this many features are required instead. */
const WEAK_MIN_FEATURES = 2;
/**
 * Blank SEALED covers — junction lids, blanking plates, sealed outlets — are
 * white blocks with no dark features at all, and they matter exactly like
 * sockets. They are accepted without features, but under stricter rules,
 * because a featureless bright rectangle is also what paper looks like: the
 * contrast must be unmistakable, the shape properly plate-like, and the size
 * within a real cover's range (paper and posters are bigger).
 */
/**
 * Luminance at which a pixel is CLIPPED — the sensor has run out of range and
 * the true brightness is unknowable.
 */
export const SATURATED_LEVEL = 250;
/**
 * Reject a candidate this much of which is clipped.
 *
 * This is what tells a LIGHT from a faceplate, and nothing else does. A
 * luminaire — an LED strip, a cove light, a downlight — is a SOURCE: it blows
 * the sensor out, so its pixels pile up at the top of the range. A white
 * plastic faceplate is a REFLECTOR under the same auto-exposure: it is the
 * brightest thing on the wall, but it is not clipped, because the exposure is
 * set by the scene and the plate is part of the scene.
 *
 * Without this, LED cove lighting walks straight into the blank-cover tier
 * below: solid, high-contrast and featureless, which is the exact shape of a
 * sealed blanking plate. A tester's hallway produced 33 candidates in one frame
 * and confirmed zero sockets — the detector spent its whole budget on the
 * lighting, and the boxes slid along the strips from frame to frame, which is
 * what "the LED lights run around" looks like from the outside.
 *
 * A quarter is deliberately generous. A real plate can carry a specular hotspot
 * from a window or a lamp; it does not carry one across a quarter of its face,
 * and a plate that did would have no visible slots left to confirm it anyway.
 */
export const MAX_SATURATED_FRACTION = 0.25;
/**
 * Most candidates worth measuring against depth in one frame. Depth measurement
 * fits a plane per candidate, so its cost is linear in candidate count, and a
 * frame yielding dozens is a frame looking at something that is not a wall of
 * sockets. Consumed by the capture loop, not by this file.
 */
export const MAX_MEASURED_CANDIDATES = 12;

const BLANK_MIN_CONTRAST = 16;
const BLANK_MIN_SOLIDITY = 0.78;
const BLANK_MAX_SIDE_FRAC = 0.28;
const BLANK_MIN_ASPECT = 0.5;
const BLANK_MAX_ASPECT = 2.0;
/** Local-mean window radius, as a fraction of the short image side. Must stay
 * comfortably larger than a plate so the plate cannot dominate its own
 * reference and cancel the contrast. */
const WALL_WINDOW = 0.3;
/**
 * Structuring-element radius for the opening that separates plates from the
 * things attached to them, as a fraction of the SMALLEST acceptable plate.
 *
 * Tied to the plate size rather than to the image, because the question it
 * answers is physical: "is this narrower than any faceplate could be?" At 0.28
 * the element is roughly a quarter of the smallest plate we would accept, so a
 * plate survives the erosion with room to spare while a cord — which is an
 * order of magnitude thinner — cannot.
 */
const OPEN_RADIUS_FRAC = 0.28;
/**
 * Non-max suppression overlap. Deliberately NOT lowered: adjacent plates
 * overlap by nothing, so this threshold never suppressed one of them, and
 * lowering it would only start losing sockets that currently survive.
 */
const NMS_IOU = 0.3;
/** Plate size limits relative to the short image side. */
const MIN_PLATE_SIDE_FRAC = 0.02;
const MAX_PLATE_SIDE_FRAC = 0.42;
/** Bounding-box aspect (w/h) limits: single-gang portrait ~0.6 through
 * double-gang landscape ~1.7, with margin for perspective. */
const MIN_ASPECT = 0.28;
const MAX_ASPECT = 3;
/** A faceplate fills its bounding box; a cable curve or an outline does not. */
const MIN_SOLIDITY = 0.55;
/** Interior features must be clearly darker than the plate. */
const DARK_FEATURE_DELTA = 28;
/** Feature blobs of at least this many pixels count (screws, slots, seams). */
const MIN_FEATURE_AREA = 2;
/** More dark blobs than this is printed matter or a vent, not a socket. */
const MAX_FEATURES = 24;
/** Dark interior beyond this fraction is a picture frame, not a faceplate. */
const MAX_DARK_FRACTION = 0.42;

/**
 * Luminance downscaled to `maxDim` on its longest edge.
 *
 * When the image shrinks, each output pixel takes the DARKEST luma in the block
 * it covers. The plate itself is uniform, so a minimum barely moves it, while
 * the small dark features the confirmation step needs (pin slots, a rocker
 * seam) survive decimation that point sampling or averaging would erase. Kept
 * in lockstep with the Swift capture path.
 */
function toGrayscale(img: DetectorImage, maxDim: number): { g: Float32Array; w: number; h: number } {
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const g = new Float32Array(w * h);
  const d = img.data;
  const luma = (i: number): number => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

  if (scale >= 1) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        g[y * w + x] = luma((y * img.width + x) * 4);
      }
    }
    return { g, w, h };
  }

  const stepX = img.width / w;
  const stepY = img.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.min(img.height - 1, Math.floor(y * stepY));
    const y1 = Math.min(img.height, Math.max(y0 + 1, Math.floor((y + 1) * stepY)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.min(img.width - 1, Math.floor(x * stepX));
      const x1 = Math.min(img.width, Math.max(x0 + 1, Math.floor((x + 1) * stepX)));
      let darkest = 255;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const v = luma((sy * img.width + sx) * 4);
          if (v < darkest) darkest = v;
        }
      }
      g[y * w + x] = darkest;
    }
  }
  return { g, w, h };
}

/** Summed-area table for O(1) rectangle means. */
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

function boxMean(s: Float64Array, w: number, h: number, x: number, y: number, r: number): number {
  const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r);
  const x1 = Math.min(w, x + r + 1), y1 = Math.min(h, y + r + 1);
  const W = w + 1;
  const sum = s[y1 * W + x1] - s[y0 * W + x1] - s[y1 * W + x0] + s[y0 * W + x0];
  const n = (x1 - x0) * (y1 - y0);
  return n > 0 ? sum / n : 0;
}

/**
 * Morphological opening with a square element of radius `r`: erode, then
 * dilate. Removes any structure thinner than the element and leaves everything
 * wider essentially unchanged.
 *
 * Done SEPARABLY — a horizontal pass then a vertical one — which is exact for a
 * square element and turns the cost from "two summed-area tables and two
 * windowed lookups per pixel" into four running-sum sweeps with no extra
 * allocation. This runs on every analysed frame while ARKit is trying to hold a
 * frame rate, so the constant factor is not a detail.
 *
 * The border replicates: a pixel at the edge is judged only on its IN-BOUNDS
 * neighbours. That keeps a plate at the frame edge intact so it still trips the
 * border rule that skips it, rather than being eaten into a different shape.
 */
function open(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  return sweep(sweep(mask, w, h, r, true), w, h, r, false);
}

/**
 * One separable morphology pass over the whole image.
 * `erodePass` true keeps a pixel only if EVERY in-window neighbour is set;
 * false keeps it if ANY is.
 */
function sweep(mask: Uint8Array, w: number, h: number, r: number, erodePass: boolean): Uint8Array {
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let lo = 0;
    let hi = Math.min(w - 1, r);
    let sum = 0;
    for (let x = lo; x <= hi; x++) sum += mask[row + x];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = (erodePass ? sum === hi - lo + 1 : sum > 0) ? 1 : 0;
      const nextLo = Math.max(0, x + 1 - r);
      const nextHi = Math.min(w - 1, x + 1 + r);
      if (nextLo > lo) { sum -= mask[row + lo]; lo = nextLo; }
      if (nextHi > hi) { hi = nextHi; sum += mask[row + hi]; }
    }
  }

  const out = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    let lo = 0;
    let hi = Math.min(h - 1, r);
    let sum = 0;
    for (let y = lo; y <= hi; y++) sum += tmp[y * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = (erodePass ? sum === hi - lo + 1 : sum > 0) ? 1 : 0;
      const nextLo = Math.max(0, y + 1 - r);
      const nextHi = Math.min(h - 1, y + 1 + r);
      if (nextLo > lo) { sum -= tmp[lo * w + x]; lo = nextLo; }
      if (nextHi > hi) { hi = nextHi; sum += tmp[hi * w + x]; }
    }
  }
  return out;
}

/** Fraction of a bounding box that is set in the mask. */
/** Fraction of a box whose pixels are clipped at the top of the range. */
export function saturatedFraction(
  g: ArrayLike<number>,
  w: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  let clipped = 0;
  let total = 0;
  for (let y = y0; y <= y1; y++) {
    const row = y * w;
    for (let x = x0; x <= x1; x++) {
      total += 1;
      if (g[row + x] >= SATURATED_LEVEL) clipped += 1;
    }
  }
  return total > 0 ? clipped / total : 0;
}

function maskFill(
  mask: Uint8Array, w: number, x0: number, y0: number, x1: number, y1: number,
): number {
  let set = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (mask[y * w + x]) set++;
    }
  }
  const n = (x1 - x0 + 1) * (y1 - y0 + 1);
  return n > 0 ? set / n : 0;
}

/** 8-connected components of a boolean mask. */
function components(mask: Uint8Array, w: number, h: number): Blob[] {
  const label = new Int32Array(w * h).fill(0);
  const blobs: Blob[] = [];
  const stack: number[] = [];
  let next = 0;
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || label[i]) continue;
    next++;
    stack.length = 0;
    stack.push(i);
    label[i] = next;
    let minx = w, miny = h, maxx = 0, maxy = 0, area = 0, sx = 0, sy = 0;
    while (stack.length) {
      const p = stack.pop()!;
      const px = p % w, py = (p / w) | 0;
      area++; sx += px; sy += py;
      if (px < minx) minx = px; if (px > maxx) maxx = px;
      if (py < miny) miny = py; if (py > maxy) maxy = py;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = px + dx, ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (mask[q] && !label[q]) { label[q] = next; stack.push(q); }
        }
      }
    }
    blobs.push({ minx, miny, maxx, maxy, area, cx: sx / area, cy: sy / area });
  }
  return blobs;
}

const iou = (a: SocketDetection, b: SocketDetection): number => {
  const ax0 = a.cx - a.w / 2, ay0 = a.cy - a.h / 2, ax1 = a.cx + a.w / 2, ay1 = a.cy + a.h / 2;
  const bx0 = b.cx - b.w / 2, by0 = b.cy - b.h / 2, bx1 = b.cx + b.w / 2, by1 = b.cy + b.h / 2;
  const ix = Math.max(0, Math.min(ax1, bx1) - Math.max(ax0, bx0));
  const iy = Math.max(0, Math.min(ay1, by1) - Math.max(ay0, by0));
  const inter = ix * iy;
  const uni = a.w * a.h + b.w * b.h - inter;
  return uni > 0 ? inter / uni : 0;
};

/** Mean over a pixel rectangle [x0,x1) x [y0,y1) via the summed-area table. */
function rectMean(
  s: Float64Array,
  w: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const W = w + 1;
  const sum = s[y1 * W + x1] - s[y0 * W + x1] - s[y1 * W + x0] + s[y0 * W + x0];
  const n = (x1 - x0) * (y1 - y0);
  return n > 0 ? sum / n : 0;
}

/** Count dark feature blobs (>= MIN_FEATURE_AREA px) inside a plate's box. */
function darkFeatures(
  g: Float32Array,
  w: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  threshold: number,
): { blobs: number; darkFraction: number } {
  const bw = x1 - x0, bh = y1 - y0;
  if (bw <= 0 || bh <= 0) return { blobs: 0, darkFraction: 0 };
  const mask = new Uint8Array(bw * bh);
  let dark = 0;
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      if (g[(y0 + y) * w + (x0 + x)] < threshold) {
        mask[y * bw + x] = 1;
        dark++;
      }
    }
  }
  let blobs = 0;
  const seen = new Uint8Array(bw * bh);
  const stack: number[] = [];
  for (let i = 0; i < bw * bh; i++) {
    if (!mask[i] || seen[i]) continue;
    let area = 0;
    stack.length = 0;
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const q = stack.pop()!;
      area++;
      const qx = q % bw, qy = (q / bw) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = qx + dx, ny = qy + dy;
          if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
          const r = ny * bw + nx;
          if (mask[r] && !seen[r]) { seen[r] = 1; stack.push(r); }
        }
      }
    }
    if (area >= MIN_FEATURE_AREA) blobs++;
  }
  return { blobs, darkFraction: dark / (bw * bh) };
}

/**
 * Detect socket faceplates in a single camera frame.
 *
 * Pipeline: grayscale + min-pool downscale → bright mask (pixels notably
 * brighter than the broad local wall) → connected components → keep solid,
 * plate-sized, plate-shaped rectangles away from the frame border → confirm
 * with a few small dark interior features → score → non-max suppress.
 */
export function detectSockets(img: DetectorImage, opts: DetectorOptions = {}): SocketDetection[] {
  const maxDim = opts.maxDim ?? 256;
  const minScore = opts.minScore ?? 0.35;
  const { g, w, h } = toGrayscale(img, maxDim);
  if (w < 16 || h < 16) return [];

  const s = integral(g, w, h);
  const minDim = Math.min(w, h);
  const rWall = Math.max(8, Math.round(minDim * WALL_WINDOW));

  // The faceplate is a light block against the wall.
  const bright = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (g[i] > boxMean(s, w, h, x, y, rWall) + BRIGHT_DELTA) bright[i] = 1;
    }
  }

  const minSide = Math.max(6, Math.round(minDim * MIN_PLATE_SIDE_FRAC));
  const maxSide = Math.round(minDim * MAX_PLATE_SIDE_FRAC);

  // Sever everything thinner than a plate before segmenting.
  //
  // This is the fix for the socket that is IN USE. A white plug in a white
  // outlet, and the cord running away from it, are all "brighter than the
  // wall", so they join the faceplate into one connected component that snakes
  // off across the room. Its bounding box is then far too big to be a plate and
  // the socket is thrown away — while the untouched coax plate beside it is
  // found perfectly. That is exactly the field failure: a marker on the data
  // plate and nothing on the outlet a hand's width away.
  //
  // An opening (erode, then dilate) with a structuring element a fraction of
  // the smallest acceptable plate deletes anything narrower than that and
  // restores everything wider, so the cord vanishes and the plate comes back
  // its own size. Cables, cord shadows' bright edges and highlight streaks on
  // trim all disappear for the same reason, which is a second win.
  const openR = Math.max(1, Math.round(minSide * OPEN_RADIUS_FRAC));
  const segmentation = open(bright, w, h, openR);

  const dets: SocketDetection[] = [];
  for (const p of components(segmentation, w, h)) {
    const bw = p.maxx - p.minx + 1;
    const bh = p.maxy - p.miny + 1;
    if (Math.min(bw, bh) < minSide || Math.max(bw, bh) > maxSide) continue;
    // A plate cut by the frame edge reads as a strip; it will be seen whole in
    // another frame of the walk, so skip rather than misjudge it.
    if (p.minx === 0 || p.miny === 0 || p.maxx === w - 1 || p.maxy === h - 1) continue;
    const aspect = bw / bh;
    if (aspect < MIN_ASPECT || aspect > MAX_ASPECT) continue;
    // Fill measured on the ORIGINAL mask: the opening is for cutting the region
    // out, not for deciding how solid it is. Judging solidity on the opened mask
    // would penalise a plate for having pin slots, which is the wrong sign.
    const solidity = maskFill(bright, w, p.minx, p.miny, p.maxx, p.maxy);
    if (solidity < MIN_SOLIDITY) continue;

    const plateMean = rectMean(s, w, p.minx, p.miny, p.maxx + 1, p.maxy + 1);
    // Contrast against the wall well beyond the plate.
    const cx = Math.round((p.minx + p.maxx) / 2);
    const cy = Math.round((p.miny + p.maxy) / 2);
    const wallMean = boxMean(s, w, h, cx, cy, Math.max(bw, bh) * 2);
    const contrast = plateMean - wallMean;

    // Emissive? Then it is a light, not a plate. Checked here, before the
    // per-candidate feature scan, because on a frame full of LED strip this is
    // what stops the expensive work from happening at all.
    if (saturatedFraction(g, w, p.minx, p.miny, p.maxx, p.maxy) > MAX_SATURATED_FRACTION) continue;

    // Confirmation, in tiers. A faceplate usually carries a few SMALL dark
    // features (slots, a ground hole, a rocker seam); one that is mostly dark
    // inside is a frame or a screen either way.
    const insetX = Math.max(1, Math.round(bw * 0.08));
    const insetY = Math.max(1, Math.round(bh * 0.08));
    const feats = darkFeatures(
      g, w,
      p.minx + insetX, p.miny + insetY,
      p.maxx + 1 - insetX, p.maxy + 1 - insetY,
      plateMean - DARK_FEATURE_DELTA,
    );
    if (feats.blobs > MAX_FEATURES) continue;
    if (feats.darkFraction > MAX_DARK_FRACTION) continue;
    if (feats.blobs === 0) {
      // A blank SEALED cover: no features to lean on, so everything else must
      // be unmistakable. (Known cost, accepted deliberately: a plate-sized
      // featureless white rectangle — a sticky note — can box; one tap on the
      // plan removes it. Missing real sealed covers is the worse failure.)
      if (contrast < BLANK_MIN_CONTRAST) continue;
      if (solidity < BLANK_MIN_SOLIDITY) continue;
      if (aspect < BLANK_MIN_ASPECT || aspect > BLANK_MAX_ASPECT) continue;
      if (Math.max(bw, bh) > minDim * BLANK_MAX_SIDE_FRAC) continue;
    } else if (contrast < STRONG_CONTRAST && feats.blobs < WEAK_MIN_FEATURES) {
      // Weak brightness needs more corroboration than one dot.
      continue;
    }

    const aspectFit = aspect >= 0.45 && aspect <= 2.2 ? 1 : 0.4;
    // Feature term saturates at THREE, not two: a power outlet shows a pair of
    // pin slots plus a ground, a coax barrel or an RJ45 gate shows one. Scoring
    // to three is what makes an outlet outrank a data plate when the two ever
    // compete, without rejecting the data plate — a cabinet must not seal that
    // either, so it is labelled, not discarded.
    const score =
      0.4 * Math.min(1, solidity) +
      0.2 * aspectFit +
      0.2 * Math.min(1, Math.max(0, contrast) / 30) +
      0.2 * Math.min(1, feats.blobs / 3);

    dets.push({
      cx: (p.minx + bw / 2) / w,
      cy: (p.miny + bh / 2) / h,
      w: bw / w,
      h: bh / h,
      score,
      holes: feats.blobs,
      platePx: Math.min(bw, bh),
    });
  }

  // Non-max suppression, strongest first.
  //
  // The threshold stays where it is. Two plates side by side overlap by
  // NOTHING, so no IoU threshold has ever suppressed one of them — lowering it
  // would only make suppression more aggressive and lose sockets that currently
  // survive. What actually merged adjacent plates was the segmentation stage,
  // fixed above by the opening. Every surviving box is kept and tracked
  // independently; nothing here selects a single best per frame.
  dets.sort((a, b) => b.score - a.score);
  const kept: SocketDetection[] = [];
  for (const d of dets) {
    if (d.score < minScore) continue;
    if (kept.some((k) => iou(k, d) > NMS_IOU)) continue;
    kept.push(d);
  }
  return kept;
}

/**
 * What the dark features say a plate is.
 *
 * Slot counting only means something when the slots are RESOLVABLE. A 4mm slot
 * on an 86mm plate is under 5% of the plate's width, so below roughly 42 analysis
 * pixels there is nothing to count and any classification would be invention.
 * In that case the answer is `unknown`, and the caller treats it as power —
 * the conservative choice, because under-reporting a power socket is the
 * failure that puts a cabinet over live wiring.
 */
export type PlateKind = 'power' | 'data' | 'blank' | 'unknown';

/** Analysis-pixel plate size below which pin slots cannot be resolved. */
export const RESOLVABLE_PLATE_PX = 42;

export function classifyPlate(features: number, platePx: number): PlateKind {
  if (platePx < RESOLVABLE_PLATE_PX) return 'unknown';
  if (features >= 3) return 'power';
  if (features >= 1) return 'data';
  return 'blank';
}

/** Default engine: the built-in heuristic detector. */
export const heuristicSocketDetector: SocketDetector = { detect: detectSockets };
