import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseScan } from '@mozu/scan-sdk';
import { scanToGeometry } from '@/systems/scan/scanToGeometry';
import { compareScan, formatReport } from '../../../../scripts/scan-accuracy.mjs';

// ---------------------------------------------------------------------------
// Golden scans: real rooms, replayed on every test run.
//
// Each fixtures/scans/<name>.scan.json is a scan exactly as the iPad shared it.
// It goes through the web's own import (parse → geometry → store), and what
// comes out — walls, area, openings, columns, furniture, sockets — must match
// <name>.expected.json. Any change to what a real room becomes on the web then
// shows up as a failing test and a reviewable diff, instead of in the field.
//
// New scan, or an intended change:  UPDATE_GOLDEN=1 npx vitest run goldenScans
// then read the .expected.json diff before committing it.
//
// <name>.truth.json (optional) holds what was measured by hand; with
// "ciEnforce": true the scan must also pass scripts/scan-accuracy.mjs.
// ---------------------------------------------------------------------------

const DIR = fileURLToPath(new URL('../../../../fixtures/scans/', import.meta.url));
const UPDATE = process.env.UPDATE_GOLDEN === '1';
const names = readdirSync(DIR).filter((f) => f.endsWith('.scan.json')).map((f) => f.replace(/\.scan\.json$/, ''));

async function summarise(json: string) {
  const scan = parseScan(json);
  if (!scan) throw new Error('not a valid mozu.roomscan/1 file');
  const { useConfiguratorStore } = await import('@/state/useConfiguratorStore');
  useConfiguratorStore.getState().applyRoomGeometry(scanToGeometry(scan));
  const s = useConfiguratorStore.getState();
  const f = s.room.footprint;
  const area = Math.abs(f.reduce((n, a, i) => { const b = f[(i + 1) % f.length]; return n + a.x * b.z - b.x * a.z; }, 0)) / 2;
  return {
    walls: s.room.walls.map((w) => Math.round(Math.hypot(w.end.x - w.start.x, w.end.z - w.start.z))),
    areaM2: +(area / 1e6).toFixed(3),
    ceilingMm: Math.round(s.room.height),
    openings: s.room.walls.flatMap((w, i) =>
      (w.openings ?? []).map((o) => `${o.type}@wall${i}+${Math.round(o.offset)}x${Math.round(o.width)}${o.glass ? ' (glass?)' : ''}`)),
    columns: s.designItems.filter((d) => d.column).map((d) => `${d.column} ${Math.round(d.size?.width ?? 0)}`),
    furniture: s.designItems.filter((d) => d.scanned && !d.column).map((d) => d.label ?? '?').sort(),
    fixtures: s.room.walls.flatMap((w) => (w.fixtures ?? []).map((x) => x.type)).sort(),
  };
}

describe('golden scans', () => {
  it('has at least one scan to replay', () => expect(names.length).toBeGreaterThan(0));

  for (const name of names) {
    it(`${name} imports as it did`, async () => {
      const got = await summarise(readFileSync(`${DIR}${name}.scan.json`, 'utf8'));
      const expectedPath = `${DIR}${name}.expected.json`;
      if (UPDATE || !existsSync(expectedPath)) {
        writeFileSync(expectedPath, `${JSON.stringify(got, null, 2)}\n`);
        if (!UPDATE) throw new Error(`no ${name}.expected.json — wrote one; review it and re-run`);
        return;
      }
      expect(got).toEqual(JSON.parse(readFileSync(expectedPath, 'utf8')));
    });

    const truthPath = `${DIR}${name}.truth.json`;
    if (existsSync(truthPath)) {
      const truth = JSON.parse(readFileSync(truthPath, 'utf8'));
      it.runIf(truth.ciEnforce)(`${name} is within the accuracy limits`, () => {
        const rows = compareScan(JSON.parse(readFileSync(`${DIR}${name}.scan.json`, 'utf8')), truth);
        expect(rows.filter((r) => !r.pass), formatReport(rows)).toEqual([]);
      });
    }
  }
});
