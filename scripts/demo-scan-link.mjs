/**
 * Print a `/scan` deep link for a demo room that already carries detected
 * fixtures — the quickest way to see sockets and pipework land on the floor
 * plan, labelled, on a real device.
 *
 *   node scripts/demo-scan-link.mjs                       # http://localhost:3000
 *   node scripts/demo-scan-link.mjs https://abc.trycloudflare.com
 *
 * Open the printed URL on the iPad. The app ingests the payload, lands on the
 * floorplan step, and draws each fixture with its label (`Waste ⌀110`).
 */
const base = (process.argv[2] ?? 'http://localhost:3000').replace(/\/+$/, '');

// A 4.2 x 3.0 m room. Wall indices follow the polygon's edges: 0 = bottom
// (z=0), 1 = right, 2 = top, 3 = left.
const scan = {
  schema: 'mozu.roomscan/1',
  polygon: [
    { x: 0, z: 0 },
    { x: 4200, z: 0 },
    { x: 4200, z: 3000 },
    { x: 0, z: 3000 },
  ],
  height: 2700,
  openings: [
    { type: 'door', wall: 2, offset: 700, width: 900, height: 2050, sill: 0 },
    { type: 'window', wall: 0, offset: 2500, width: 1400, height: 1200, sill: 900 },
  ],
  objects: [],
  fixtures: [
    { type: 'socket', wall: 0, offset: 1100, height: 300, source: 'detected', confidence: 0.91 },
    { type: 'socket', wall: 0, offset: 3000, height: 1100, source: 'detected', confidence: 0.86 },
    { type: 'socket', wall: 1, offset: 1500, height: 300, source: 'detected', confidence: 0.78 },
    { type: 'water', wall: 3, offset: 1200, height: 550, source: 'detected', confidence: 0.74, diameterMm: 22 },
    { type: 'waste', wall: 3, offset: 1400, height: 300, source: 'detected', confidence: 0.83, diameterMm: 110 },
    { type: 'gas', wall: 2, offset: 3300, height: 250, source: 'detected', confidence: 0.69, diameterMm: 28 },
  ],
  source: 'roomplan',
  unitSystem: 'metric',
  confidence: 0.92,
  capturedAt: new Date().toISOString(),
};

const b64url = Buffer.from(JSON.stringify(scan), 'utf8')
  .toString('base64')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/, '');

const poly = scan.polygon.map((p) => `${p.x},${p.z}`).join(';');
const url =
  `${base}/scan?poly=${encodeURIComponent(poly)}&h=${scan.height}` +
  `&src=${scan.source}&scan=${b64url}`;

console.log('\nOpen this on the iPad:\n');
console.log(url);
console.log(
  `\n${scan.fixtures.length} fixtures: ` +
    scan.fixtures.map((f) => f.type + (f.diameterMm ? ` ⌀${f.diameterMm}` : '')).join(', ') +
    '\n',
);
