/**
 * Generate the extension toolbar icons (no image tooling required): a cyan
 * rounded square with a white floorplan motif, encoded straight to PNG. Writes
 * 16/48/128 px into a target icons/ dir.
 *
 *   node make-icons.mjs ../chrome/icons
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const out = resolve(process.argv[2] ?? '../chrome/icons');
mkdirSync(out, { recursive: true });

const BG = [34, 211, 238, 255]; // cyan-400
const INK = [10, 12, 16, 255]; // near-black plan lines
const CLEAR = [0, 0, 0, 0];

/** Render the 128px master as an RGBA pixel buffer. */
function master(size) {
  const px = (x, y, c) => {
    const i = (y * size + x) * 4;
    buf[i] = c[0];
    buf[i + 1] = c[1];
    buf[i + 2] = c[2];
    buf[i + 3] = c[3];
  };
  const buf = new Uint8Array(size * size * 4);
  const r = size * 0.18; // corner radius
  const inset = size * 0.22; // plan rectangle inset
  const lw = Math.max(1, Math.round(size * 0.05)); // line weight
  const notch = size * 0.5; // L-shape notch
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Rounded-square mask.
      const cx = Math.min(x, size - 1 - x);
      const cy = Math.min(y, size - 1 - y);
      const inCorner = cx < r && cy < r;
      const outside = inCorner && Math.hypot(r - cx, r - cy) > r;
      if (outside) {
        px(x, y, CLEAR);
        continue;
      }
      px(x, y, BG);
      // Draw an L-shaped floorplan outline in ink.
      const inL = x >= inset && x <= size - inset && y >= inset && y <= size - inset;
      const inNotch = x > notch && y > notch; // cut bottom-right quadrant
      const onEdge =
        inL &&
        !inNotch &&
        (Math.abs(x - inset) < lw ||
          Math.abs(x - (size - inset)) < lw ||
          Math.abs(y - inset) < lw ||
          Math.abs(y - (size - inset)) < lw ||
          (x > notch - lw && x < notch + lw && y >= notch) ||
          (y > notch - lw && y < notch + lw && x >= notch));
      if (onEdge) px(x, y, INK);
    }
  }
  return buf;
}

/** Minimal PNG encoder (truecolour + alpha, no interlace). */
function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0, 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  // 10,11,12 = 0 (deflate / filter / no interlace)
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

for (const size of [16, 48, 128]) {
  const png = encodePng(size, size, master(size));
  writeFileSync(resolve(out, `icon-${size}.png`), png);
}
console.log(`✓ wrote icon-16/48/128.png → ${out}`);
