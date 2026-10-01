import { describe, expect, it } from 'vitest';
import { analyseWalls } from '@/systems/scan/wallLoop';
import { isAccurate, mulberry32, outlineError, room, type RoomShape } from './helpers/roomGen';

// A thousand badly scanned rooms with known answers (see helpers/roomGen.ts).
// This is what found the U-shaped-room bugs the hand-written cases never
// reached. The code as it stood before those fixes got 278 of these wrong.
//
// FUZZ_ROOMS / FUZZ_SEED widen it — the nightly CI run uses 15,000 rooms.
const ROOMS = Number(process.env.FUZZ_ROOMS ?? 1000);
const SEED = Number(process.env.FUZZ_SEED ?? 777);

describe(`${ROOMS} badly scanned rooms (seed ${SEED})`, () => {
  it('gives back every true outline, to 5mm and 0.2% of area', () => {
    const rnd = mulberry32(SEED);
    const wrong: { i: number; shape: RoomShape }[] = [];
    for (let i = 0; i < ROOMS; i++) {
      const { truth, segments, shape } = room(rnd);
      if (!isAccurate(outlineError(analyseWalls(segments).outline, truth))) wrong.push({ i, shape });
    }
    // Known residue at scale: 0.04-0.06% of rooms, almost all U-shaped, where
    // a short wall is seen only as a sliver. Zero is required at the default
    // size; the large nightly run is held to 0.1% so any regression shows.
    const allowed = ROOMS <= 1000 ? 0 : Math.ceil(ROOMS / 1000);
    expect(wrong.length, JSON.stringify(wrong.slice(0, 10))).toBeLessThanOrEqual(allowed);
  });
});
