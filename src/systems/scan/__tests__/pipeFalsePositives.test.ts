import { describe, expect, it } from 'vitest';
import { detectPipes, type DetectorImage } from '@/systems/scan';

/**
 * What the pipe detector does with the OTHER long straight things on a wall.
 *
 * Two kinds of assertion live here, deliberately labelled:
 *  - REQUIREMENT — a rejection the detector must keep making.
 *  - CHARACTERISATION — a known false positive, pinned so it stays visible and
 *    any improvement trips this test rather than passing unnoticed.
 *
 * The detector alone is only half the product: `fixtureProjection.measurePipe`
 * sizes every candidate in millimetres via the LiDAR distance and drops
 * anything outside 8–130 mm. That gate is what removes most of the pinned
 * cases in practice — but not all of them, which is exactly why they are
 * recorded here rather than quietly ignored.
 */
function wall(w: number, h: number, bg = 205): DetectorImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = bg; data[i * 4 + 1] = bg; data[i * 4 + 2] = bg; data[i * 4 + 3] = 255;
  }
  return { data, width: w, height: h };
}

const setPx = (img: DetectorImage, x: number, y: number, r: number, g: number, b: number) => {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const i = (y * img.width + x) * 4;
  img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b;
};

const fillRect = (img: DetectorImage, x0: number, y0: number, x1: number, y1: number, v: number) => {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) setPx(img, x, y, v, v, v - 2);
};

describe('pipe detector — things that are not pipes', () => {
  it('REQUIREMENT: ignores a cable (no measurable bore)', () => {
    const img = wall(240, 320);
    for (let y = 20; y < 300; y++) for (let d = 0; d < 2; d++) setPx(img, 120 + d, y, 60, 60, 60);
    expect(detectPipes(img)).toHaveLength(0);
  });

  it('REQUIREMENT: ignores a soft shadow with no hard edge', () => {
    const img = wall(300, 320);
    for (let y = 0; y < 320; y++) {
      for (let x = 0; x < 300; x++) {
        const t = Math.exp(-((x - 150) ** 2) / (2 * 28 * 28));
        const v = 205 - 45 * t;
        setPx(img, x, y, v, v, v);
      }
    }
    expect(detectPipes(img)).toHaveLength(0);
  });

  it('REQUIREMENT: ignores a bright window reveal (a patch, not a run)', () => {
    const img = wall(360, 320);
    fillRect(img, 120, 60, 250, 240, 250);
    expect(detectPipes(img)).toHaveLength(0);
  });

  it('REQUIREMENT: still finds a real pipe among these (control)', () => {
    const img = wall(240, 320);
    for (let y = 20; y < 300; y++) {
      for (let d = -6; d < 6; d++) {
        const k = 1 - Math.abs(d) / 6;
        const sh = 0.7 + 0.45 * k;
        setPx(img, Math.round(120 + d), y, 90 * sh, 90 * sh, 95 * sh);
      }
    }
    const dets = detectPipes(img);
    expect(dets.length).toBeGreaterThanOrEqual(1);
    expect(Math.abs(dets[0].widthPx - 12)).toBeLessThan(5);
  });

  // ── Known false positives ────────────────────────────────────────────────
  // These are real limitations, not desired behaviour. Tuning them out against
  // synthetic images would be fitting to the fixture rather than to reality, so
  // they are pinned here until they can be tuned on real photographs.

  it('CHARACTERISATION: a skirting board still reads as a horizontal run', () => {
    const img = wall(400, 300);
    fillRect(img, 0, 265, 400, 283, 170);
    const dets = detectPipes(img);
    // Currently detected. Real skirting is ~120-150mm, so the 130mm millimetre
    // gate in measurePipe rejects the taller ones — but a short skirting can
    // still size into the waste band.
    expect(dets.length).toBeGreaterThan(0);
    expect(dets[0].vertical).toBe(false);
  });

  it('CHARACTERISATION: an architrave is seen as its two edges', () => {
    const img = wall(300, 320);
    fillRect(img, 100, 0, 126, 320, 175);
    const dets = detectPipes(img);
    // The 26px casing itself is correctly not returned as one run; its two
    // boundary strips are. Each is thin, so most size below the pipe range.
    expect(dets.length).toBeGreaterThan(0);
    for (const d of dets) expect(d.widthPx).toBeLessThan(20);
  });

  it('CHARACTERISATION: a hard tonal step reads as a thin run', () => {
    const img = wall(300, 320);
    fillRect(img, 0, 0, 110, 320, 150);
    expect(detectPipes(img).length).toBeGreaterThan(0);
  });
});
