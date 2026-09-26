import { describe, expect, it } from 'vitest';
import { detectSockets, saturatedFraction, type DetectorImage } from '@/systems/scan';

/** A flat RGBA image filled with a background gray (the wall). */
function makeImage(w: number, h: number, bg = 180): DetectorImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = bg;
    data[i * 4 + 1] = bg;
    data[i * 4 + 2] = bg;
    data[i * 4 + 3] = 255;
  }
  return { data, width: w, height: h };
}

/** Paint a filled rectangle of one gray value. */
function rect(img: DetectorImage, x: number, y: number, w: number, h: number, val: number): void {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      if (xx < 0 || yy < 0 || xx >= img.width || yy >= img.height) continue;
      const i = (yy * img.width + xx) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = val;
    }
  }
}

/**
 * Paint a socket the way one actually looks: a WHITE plate (the little block on
 * the wall, brighter than it) carrying a few small dark features — two pin
 * slots and a ground hole.
 */
function paintSocket(img: DetectorImage, cx: number, cy: number, scale = 1): void {
  const pw = Math.round(34 * scale), ph = Math.round(44 * scale);
  rect(img, Math.round(cx - pw / 2), Math.round(cy - ph / 2), pw, ph, 235);
  const sw = Math.max(2, Math.round(4 * scale)), sh = Math.max(3, Math.round(10 * scale));
  rect(img, Math.round(cx - 8 * scale - sw / 2), Math.round(cy - 6 * scale), sw, sh, 40);
  rect(img, Math.round(cx + 8 * scale - sw / 2), Math.round(cy - 6 * scale), sw, sh, 40);
  rect(img, Math.round(cx - sw / 2), Math.round(cy + 9 * scale), sw, Math.max(2, Math.round(5 * scale)), 40);
}

describe('socket detector (white plate + dark features)', () => {
  it('detects a socket: bright plate with pin slots', () => {
    const img = makeImage(200, 150);
    paintSocket(img, 100, 72);
    const dets = detectSockets(img);
    expect(dets.length).toBe(1);
    const d = dets[0];
    expect(d.holes).toBeGreaterThanOrEqual(2);
    expect(d.cx).toBeGreaterThan(0.42);
    expect(d.cx).toBeLessThan(0.58);
    expect(d.cy).toBeGreaterThan(0.38);
    expect(d.cy).toBeLessThan(0.6);
    // The box frames the PLATE — the visible white block — not just the slots.
    expect(d.w * img.width).toBeGreaterThan(24);
    expect(d.score).toBeGreaterThan(0.5);
  });

  it('finds nothing on a blank wall', () => {
    expect(detectSockets(makeImage(200, 150))).toHaveLength(0);
  });

  it('detects a blank SEALED cover plate (white block, no slots at all)', () => {
    const img = makeImage(200, 150);
    rect(img, 86, 56, 26, 34, 235); // sealed junction cover: bright, featureless
    const dets = detectSockets(img);
    expect(dets).toHaveLength(1);
    expect(dets[0].holes).toBe(0);
  });

  it('still rejects a poster-sized blank bright rectangle', () => {
    const img = makeImage(240, 180);
    rect(img, 80, 50, 70, 62, 235); // too big to be a cover plate
    expect(detectSockets(img)).toHaveLength(0);
  });

  it('detects a far-away socket whose slots are no longer resolvable', () => {
    // At 4m+ the plate is ~20px in the analysis image and the slots are gone —
    // it must still be found as a small sealed white block.
    const img = makeImage(480, 360);
    rect(img, 230, 167, 20, 26, 235);
    const dets = detectSockets(img);
    expect(dets).toHaveLength(1);
    expect(Math.abs(dets[0].cx * 480 - 240)).toBeLessThan(8);
  });

  it('accepts a low-contrast plate only when features corroborate', () => {
    const img = makeImage(200, 150);
    rect(img, 83, 50, 34, 44, 195); // barely brighter than the 180 wall...
    rect(img, 90, 62, 4, 12, 40);   // ...but with two clear pin slots
    rect(img, 106, 62, 4, 12, 40);
    const dets = detectSockets(img);
    expect(dets).toHaveLength(1);
    expect(dets[0].holes).toBeGreaterThanOrEqual(2);
  });

  it('ignores a dark-interior rectangle (picture frame / screen)', () => {
    const img = makeImage(240, 180);
    rect(img, 90, 60, 60, 50, 235); // bright border...
    rect(img, 96, 66, 48, 38, 40);  // ...mostly dark inside
    expect(detectSockets(img)).toHaveLength(0);
  });

  it('ignores dark specks and slot-like marks with no plate under them', () => {
    // The old detector's failure mode: dark specks cluster like pin slots.
    const img = makeImage(200, 150);
    rect(img, 94, 62, 4, 12, 40);
    rect(img, 106, 62, 4, 12, 40);
    expect(detectSockets(img)).toHaveLength(0);
  });

  it('regression from the field: dim wall, white cable, dark band — no phantoms', () => {
    // Modelled on the on-device screenshot that showed 157 phantoms: a dim
    // wall, a thin bright cable snaking across it, a dark band at the bottom,
    // and two real white blocks (an outlet and a switch-like plate).
    const img = makeImage(480, 300, 110);
    rect(img, 0, 240, 480, 60, 60); // dark lower band
    for (let x = 40; x < 460; x++) { // thin bright cable with a slight wave
      const y = 180 + Math.round(14 * Math.sin(x / 22));
      rect(img, x, y, 1, 3, 210);
    }
    for (let k = 0; k < 40; k++) { // scuffs and shadow specks near the cable
      const x = 50 + ((k * 37) % 400);
      const y = 170 + ((k * 13) % 30);
      rect(img, x, y, 2, 3, 70);
    }
    paintSocket(img, 150, 80);                 // the real outlet
    rect(img, 300, 58, 34, 44, 235);           // a switch: plate...
    rect(img, 314, 68, 5, 24, 90);             // ...with one rocker seam
    const dets = detectSockets(img);
    expect(dets.length).toBe(2);
    const xs = dets.map((d) => d.cx * 480).sort((a, b) => a - b);
    expect(Math.abs(xs[0] - 150)).toBeLessThan(12);
    expect(Math.abs(xs[1] - 317)).toBeLessThan(12);
  });

  it('survives a full-resolution phone photo (min-pooling downscale)', () => {
    const W = 4032, H = 1512;
    const img = makeImage(W, H, 180);
    paintSocket(img, 2016, 750, 3.4); // ~116x150px plate, 14px slots
    const dets = detectSockets(img, { maxDim: 640, minScore: 0.3 });
    expect(dets.length).toBe(1);
    expect(dets[0].cx).toBeGreaterThan(0.45);
    expect(dets[0].cx).toBeLessThan(0.55);
  });

  it('separates two sockets on the same wall', () => {
    const img = makeImage(320, 160);
    paintSocket(img, 70, 80);
    paintSocket(img, 250, 80);
    const dets = detectSockets(img);
    expect(dets.length).toBe(2);
  });

  it('regression from the field: finds the socket IN USE beside a coax plate', () => {
    // The reported failure, reproduced: a marker landed on the untouched coax
    // plate and nothing at all on the power outlet a hand's width away.
    //
    // The cause was not the non-max suppression — two plates side by side
    // overlap by nothing, so no IoU threshold suppresses either. It was that
    // the white plug in the outlet, and the cord running away from it, are all
    // "brighter than the wall", so they joined the faceplate into one component
    // that snaked off across the room. Its bounding box was far too big to be a
    // plate, so the socket was discarded — while the untouched plate beside it
    // sailed through.
    const img = makeImage(480, 360, 150);
    rect(img, 132, 100, 36, 46, 232); // outlet faceplate
    rect(img, 140, 110, 4, 11, 45);
    rect(img, 156, 110, 4, 11, 45);
    rect(img, 148, 130, 4, 5, 45);
    rect(img, 136, 126, 28, 26, 238); // ...with a white plug in it
    for (let x = 150; x < 400; x++) {
      const y = 152 + Math.round(28 * Math.sin((x - 150) / 60)); // ...and a cord
      rect(img, x, y, 1, 4, 225);
    }
    rect(img, 200, 100, 32, 44, 232); // the coax plate next to it
    rect(img, 213, 118, 5, 5, 45);

    const dets = detectSockets(img, { minScore: 0.3 });
    expect(dets).toHaveLength(2);
    const xs = dets.map((d) => d.cx * 480).sort((a, b) => a - b);
    expect(Math.abs(xs[0] - 150)).toBeLessThan(14); // the outlet, in use
    expect(Math.abs(xs[1] - 216)).toBeLessThan(14); // the coax plate

    // And the two are distinguishable: an outlet carries several dark features,
    // a coax plate carries one. That is what the fixture classifier keys on.
    const byX = [...dets].sort((a, b) => a.cx - b.cx);
    expect(byX[0].holes).toBeGreaterThan(byX[1].holes);
  });

  it('deletes a bright cable outright instead of chasing it', () => {
    // A cord alone, with no plate anywhere: the opening removes it entirely,
    // so it cannot form a component to be judged in the first place.
    const img = makeImage(320, 240, 150);
    for (let x = 20; x < 300; x++) {
      rect(img, x, 120 + Math.round(20 * Math.sin(x / 40)), 1, 4, 230);
    }
    expect(detectSockets(img, { minScore: 0.3 })).toHaveLength(0);
  });

  it('keeps two plates 40mm apart as two separate detections', () => {
    // The other half of "adjacent plates": they must not merge into one marker.
    const img = makeImage(360, 260, 160);
    paintSocket(img, 150, 120);
    paintSocket(img, 200, 120);
    const dets = detectSockets(img, { minScore: 0.3 });
    expect(dets).toHaveLength(2);
  });

  it('skips a plate cut by the frame edge rather than misjudging it', () => {
    const img = makeImage(200, 150);
    rect(img, 0, 50, 20, 46, 235); // half a plate at the border
    rect(img, 6, 62, 4, 12, 40);
    expect(detectSockets(img)).toHaveLength(0);
  });
});

/**
 * An LED luminaire, painted the way a camera actually records one: CLIPPED.
 * A light source runs the sensor out of range, so its pixels pile up at the top
 * of the 8-bit scale instead of sitting somewhere on it. That is the difference
 * between a source and a reflector, and it is the only reliable one — in shape,
 * solidity and contrast an LED panel and a sealed blanking plate are the same
 * object.
 */
function paintLed(img: DetectorImage, x: number, y: number, w: number, h: number): void {
  rect(img, x, y, w, h, 255);
}

describe('LED lighting is not a socket', () => {
  it('rejects a clipped LED panel that is otherwise plate-shaped', () => {
    // Exactly the shape the blank-sealed-cover tier accepts: solid, plate-sized,
    // featureless, and far brighter than the wall. Only the clipping tells them
    // apart.
    const img = makeImage(200, 150);
    paintLed(img, 84, 52, 34, 44);
    expect(detectSockets(img)).toHaveLength(0);
  });

  it('rejects a run of LED cove lighting', () => {
    // A strip broken into plate-sized chunks by the morphological opening —
    // this is what produced 33 candidates in one frame in the field, and what
    // made the boxes appear to slide along the strip between frames.
    const img = makeImage(320, 200);
    for (let i = 0; i < 5; i++) paintLed(img, 30 + i * 52, 40, 36, 30);
    expect(detectSockets(img)).toHaveLength(0);
  });

  it('still finds a real socket on a wall lit by an LED strip', () => {
    // The point of the gate is to remove the lighting WITHOUT removing the
    // sockets under it; a detector that goes quiet in a lit room is no better
    // than one that cries wolf.
    const img = makeImage(320, 200);
    for (let i = 0; i < 4; i++) paintLed(img, 20 + i * 60, 24, 40, 18);
    paintSocket(img, 160, 130);
    const dets = detectSockets(img);
    expect(dets).toHaveLength(1);
    expect(dets[0].cx).toBeGreaterThan(0.4);
    expect(dets[0].cx).toBeLessThan(0.6);
  });

  it('keeps a plate carrying a small specular hotspot', () => {
    // A window or a lamp can clip a CORNER of a real plate. The threshold is a
    // quarter of its face precisely so this survives.
    const img = makeImage(200, 150);
    paintSocket(img, 100, 72);
    rect(img, 88, 56, 8, 8, 255); // ~4% of a 34x44 plate
    expect(detectSockets(img)).toHaveLength(1);
  });
});

describe('saturatedFraction', () => {
  it('is 1 for a fully clipped box and 0 for an unclipped one', () => {
    const g = new Float32Array(10 * 10).fill(200);
    expect(saturatedFraction(g, 10, 0, 0, 9, 9)).toBe(0);
    g.fill(255);
    expect(saturatedFraction(g, 10, 0, 0, 9, 9)).toBe(1);
  });

  it('counts only the clipped pixels inside the box', () => {
    const g = new Float32Array(10 * 10).fill(0);
    for (let y = 0; y < 5; y++) for (let x = 0; x < 10; x++) g[y * 10 + x] = 255;
    expect(saturatedFraction(g, 10, 0, 0, 9, 9)).toBeCloseTo(0.5, 6);
    expect(saturatedFraction(g, 10, 0, 0, 9, 4)).toBe(1);
    expect(saturatedFraction(g, 10, 0, 5, 9, 9)).toBe(0);
  });
});
