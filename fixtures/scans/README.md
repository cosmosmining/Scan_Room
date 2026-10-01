# Golden scans

Real rooms, replayed on every `npm test` (`src/systems/scan/__tests__/goldenScans.test.ts`).

| File | What it is |
|------|-----------|
| `<room>.scan.json` | the scan exactly as the iPad shared it (Floorplan → Share scan) |
| `<room>.expected.json` | what the web made of it last time — the regression snapshot |
| `<room>.truth.json` | optional: the room measured by hand (template: `docs/testing/truth-template.json`). With `"ciEnforce": true` the scan must also pass `scripts/scan-accuracy.mjs` |

To add one: copy the scan and truth here, run `npm run test:golden:update`, read the
new `.expected.json` to check it describes the room you scanned, and commit all three.
Name files `<city>-<nn>-<room>`, e.g. `TPE-03-kitchen`. See docs/TESTING-PLAN.md §4.

`synthetic-l-room` is a hand-written seed so the suite is never empty; replace the
seed's role with field rooms as they arrive.
