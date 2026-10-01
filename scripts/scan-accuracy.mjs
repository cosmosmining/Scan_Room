#!/usr/bin/env node
// Score a real scan against what was measured with a tape or laser.
//
//   node scripts/scan-accuracy.mjs <scan.json> <truth.json>
//
// <scan.json>  — the iPad's "Share scan" file (mozu.roomscan/1).
// <truth.json> — the room measured by hand; see docs/testing/truth-template.json.
//
// Prints one line per check with the limit it is held to, and exits 1 if any
// check fails, so a field session ends with numbers, not impressions. The
// limits are the acceptance bar in docs/TESTING-PLAN.md §3.

/** Acceptance limits. Millimetres unless named otherwise. */
export const LIMITS = {
  wallMm: 30,          // each wall length
  wallPct: 1.5,        // …or this % of it, whichever is larger
  areaPct: 2,          // floor area
  ceilingMm: 30,
  columnDiameterMm: 40,
};

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const polygonArea = (p) =>
  Math.abs(p.reduce((n, a, i) => { const b = p[(i + 1) % p.length]; return n + a.x * b.z - b.x * a.z; }, 0)) / 2;

/**
 * Line up the scan's walls with the measured ones. The tester lists walls in
 * order round the room from any corner, in either direction, so every starting
 * wall and both directions are tried and the best fit is kept.
 */
export function alignWalls(scanned, measured) {
  if (scanned.length !== measured.length || scanned.length === 0) return null;
  const n = scanned.length;
  let best = null;
  for (const dir of [1, -1]) {
    for (let start = 0; start < n; start++) {
      const pairs = measured.map((m, i) => ({
        measured: m,
        scanned: scanned[(((start + dir * i) % n) + n) % n],
      }));
      const worst = Math.max(...pairs.map((p) => Math.abs(p.scanned - p.measured)));
      if (!best || worst < best.worst) best = { worst, pairs };
    }
  }
  return best.pairs;
}

/** Every check for one room, as rows. */
export function compareScan(scan, truth) {
  const rows = [];
  const row = (check, measured, scanned, error, limit, pass) => rows.push({ check, measured, scanned, error, limit, pass });

  const poly = scan.polygon ?? [];
  const lengths = poly.map((p, i) => dist(p, poly[(i + 1) % poly.length]));

  if (Array.isArray(truth.walls)) {
    row('wall count', truth.walls.length, lengths.length, lengths.length - truth.walls.length, 0, lengths.length === truth.walls.length);
    const pairs = alignWalls(lengths, truth.walls);
    pairs?.forEach((p, i) => {
      const limit = Math.max(LIMITS.wallMm, (p.measured * LIMITS.wallPct) / 100);
      const err = p.scanned - p.measured;
      row(`wall ${i + 1}`, Math.round(p.measured), Math.round(p.scanned), Math.round(err), Math.round(limit), Math.abs(err) <= limit);
    });
  }
  if (typeof truth.areaM2 === 'number') {
    const a = polygonArea(poly) / 1e6;
    const pct = ((a - truth.areaM2) / truth.areaM2) * 100;
    row('floor area m²', truth.areaM2, +a.toFixed(2), `${pct.toFixed(1)}%`, `${LIMITS.areaPct}%`, Math.abs(pct) <= LIMITS.areaPct);
  }
  if (typeof truth.ceilingMm === 'number') {
    const err = scan.height - truth.ceilingMm;
    row('ceiling', truth.ceilingMm, Math.round(scan.height), Math.round(err), LIMITS.ceilingMm, Math.abs(err) <= LIMITS.ceilingMm);
  }

  const columns = (scan.objects ?? []).filter((o) => o.category === 'column');
  if (Array.isArray(truth.columns)) {
    row('columns', truth.columns.length, columns.length, columns.length - truth.columns.length, 0, columns.length === truth.columns.length);
    // Pair each measured column with the scanned one closest in size.
    const left = [...columns];
    for (const [i, c] of truth.columns.entries()) {
      if (!left.length) break;
      left.sort((a, b) => Math.abs(a.width - c.diameterMm) - Math.abs(b.width - c.diameterMm));
      const s = left.shift();
      const err = s.width - c.diameterMm;
      row(`column ${i + 1} size`, c.diameterMm, Math.round(s.width), Math.round(err), LIMITS.columnDiameterMm, Math.abs(err) <= LIMITS.columnDiameterMm);
      if (c.shape) row(`column ${i + 1} shape`, c.shape, s.shape ?? 'box', '', '', (s.shape ?? 'box') === c.shape);
    }
  }

  const openings = scan.openings ?? [];
  if (truth.openings) {
    for (const type of ['door', 'window', 'archway']) {
      if (typeof truth.openings[type] !== 'number') continue;
      const found = openings.filter((o) => o.type === type).length;
      row(`${type}s`, truth.openings[type], found, found - truth.openings[type], 0, found === truth.openings[type]);
    }
    const glass = openings.filter((o) => o.glass).length;
    if (glass) row('glass suggestions (review each)', '', glass, '', '', true);
  }

  if (typeof truth.sockets === 'number') {
    const found = (scan.fixtures ?? []).filter((f) => f.type === 'socket').length;
    row('sockets', truth.sockets, found, found - truth.sockets, 0, found === truth.sockets);
  }
  return rows;
}

export function formatReport(rows) {
  const cell = (v, w) => String(v ?? '').padEnd(w);
  const lines = [
    `${cell('check', 32)}${cell('measured', 10)}${cell('scanned', 10)}${cell('error', 9)}${cell('limit', 8)}result`,
    ...rows.map((r) => `${cell(r.check, 32)}${cell(r.measured, 10)}${cell(r.scanned, 10)}${cell(r.error, 9)}${cell(r.limit, 8)}${r.pass ? 'PASS' : 'FAIL'}`),
  ];
  const failed = rows.filter((r) => !r.pass).length;
  lines.push('', failed ? `${failed} of ${rows.length} checks FAILED` : `all ${rows.length} checks passed`);
  return lines.join('\n');
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  const [scanPath, truthPath] = process.argv.slice(2);
  if (!scanPath || !truthPath) {
    console.error('usage: node scripts/scan-accuracy.mjs <scan.json> <truth.json>');
    process.exit(2);
  }
  const { readFileSync } = await import('node:fs');
  const scan = JSON.parse(readFileSync(scanPath, 'utf8'));
  const truth = JSON.parse(readFileSync(truthPath, 'utf8'));
  const rows = compareScan(scan, truth);
  console.log(`${truth.room ?? truthPath}\n`);
  console.log(formatReport(rows));
  process.exit(rows.every((r) => r.pass) ? 0 : 1);
}
