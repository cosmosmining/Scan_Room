import { describe, expect, it } from 'vitest';
import { detectPipes, type DetectorImage } from '@/systems/scan';

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

/** A vertical pipe of constant width, shaded like a cylinder. */
function vpipe(img: DetectorImage, cx: number, width: number, y0: number, y1: number, tint = [90, 90, 95]) {
  for (let y = y0; y < y1; y++) {
    for (let d = -width / 2; d < width / 2; d++) {
      const x = Math.round(cx + d);
      // Cylindrical falloff: brighter down the centre line.
      const k = 1 - Math.abs(d) / (width / 2);
      const shade = 0.7 + 0.45 * k;
      setPx(img, x, y, tint[0] * shade, tint[1] * shade, tint[2] * shade);
    }
  }
}

/** A horizontal pipe of constant width. */
function hpipe(img: DetectorImage, cy: number, width: number, x0: number, x1: number, tint = [90, 90, 95]) {
  for (let x = x0; x < x1; x++) {
    for (let d = -width / 2; d < width / 2; d++) {
      const y = Math.round(cy + d);
      const k = 1 - Math.abs(d) / (width / 2);
      const shade = 0.7 + 0.45 * k;
      setPx(img, x, y, tint[0] * shade, tint[1] * shade, tint[2] * shade);
    }
  }
}

describe('exposed-pipe detector', () => {
  it('finds a vertical pipe running down a wall', () => {
    const img = wall(240, 320);
    vpipe(img, 120, 12, 20, 300);
    const dets = detectPipes(img);
    expect(dets.length).toBeGreaterThanOrEqual(1);
    const p = dets[0];
    expect(p.vertical).toBe(true);
    expect(p.cx).toBeGreaterThan(0.4);
    expect(p.cx).toBeLessThan(0.6);
    expect(p.elongation).toBeGreaterThan(4);
    expect(p.widthPx).toBeGreaterThan(6);
    expect(p.widthPx).toBeLessThan(20);
  });

  it('finds a horizontal pipe and reports it as not vertical', () => {
    const img = wall(320, 240);
    hpipe(img, 120, 10, 20, 300);
    const dets = detectPipes(img);
    expect(dets.length).toBeGreaterThanOrEqual(1);
    expect(dets[0].vertical).toBe(false);
  });

  it('reports apparent width close to the painted width', () => {
    const img = wall(240, 320);
    vpipe(img, 120, 16, 20, 300);
    const [p] = detectPipes(img);
    expect(p).toBeDefined();
    // Within a couple of pixels of the truth (mask + downscale rounding).
    expect(Math.abs(p.widthPx - 16)).toBeLessThan(5);
  });

  it('finds nothing on a blank wall', () => {
    expect(detectPipes(wall(240, 320))).toHaveLength(0);
  });

  it('ignores a short stub (not a run)', () => {
    const img = wall(240, 320);
    vpipe(img, 120, 12, 150, 172); // only ~22px long
    expect(detectPipes(img)).toHaveLength(0);
  });

  it('ignores a blob that is not elongated (e.g. a socket plate)', () => {
    const img = wall(240, 320);
    for (let y = 140; y < 190; y++) for (let x = 100; x < 150; x++) setPx(img, x, y, 90, 90, 90);
    expect(detectPipes(img)).toHaveLength(0);
  });

  it('ignores a wedge whose width keeps changing (a shadow, not a pipe)', () => {
    const img = wall(240, 320);
    for (let y = 20; y < 300; y++) {
      const halfW = 1 + (y - 20) * 0.06; // fans out from 2px to ~35px
      for (let d = -halfW; d < halfW; d++) setPx(img, Math.round(120 + d), y, 120, 120, 122);
    }
    const dets = detectPipes(img);
    expect(dets).toHaveLength(0);
  });

  it('separates two parallel pipes', () => {
    const img = wall(300, 320);
    vpipe(img, 90, 12, 20, 300);
    vpipe(img, 210, 12, 20, 300);
    expect(detectPipes(img).length).toBeGreaterThanOrEqual(2);
  });

  it('reads yellowness high for yellow (gas) pipework and low for grey', () => {
    const yellow = wall(240, 320);
    vpipe(yellow, 120, 14, 20, 300, [210, 190, 40]);
    const grey = wall(240, 320);
    vpipe(grey, 120, 14, 20, 300, [95, 95, 100]);
    const [y] = detectPipes(yellow);
    const [g] = detectPipes(grey);
    expect(y).toBeDefined();
    expect(g).toBeDefined();
    expect(y.yellowness).toBeGreaterThan(g.yellowness);
    expect(y.yellowness).toBeGreaterThan(0.5);
  });
});
