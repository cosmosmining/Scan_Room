import { describe, expect, it } from 'vitest';
import { parseScan, type RoomScan } from '@mozu/scan-sdk';
import {
  CODE_LENGTH,
  MemoryHandoffStore,
  fetchScan,
  handoffUrl,
  newCode,
  normaliseCode,
  storeScan,
} from '../scanHandoff';
import { scanToGeometry } from '@/systems/scan/scanToGeometry';

/** A kitchen with the things that matter: a door, a window, sockets, a waste pipe. */
const SCAN: RoomScan = {
  schema: 'mozu.roomscan/1',
  polygon: [
    { x: 0, z: 0 },
    { x: 4200, z: 0 },
    { x: 4200, z: 3000 },
    { x: 0, z: 3000 },
  ],
  height: 2500,
  openings: [{ type: 'door', wall: 0, offset: 400, width: 850, height: 2030, sill: 0 }],
  objects: [],
  fixtures: [
    { type: 'socket', wall: 1, offset: 900, height: 1100, source: 'detected', confidence: 0.9 },
    { type: 'socket', wall: 1, offset: 1400, height: 1100, source: 'manual', confidence: 1 },
    { type: 'waste', wall: 2, offset: 600, height: 350, source: 'detected', confidence: 0.8, diameterMm: 110 },
  ],
  source: 'roomplan',
  unitSystem: 'metric',
  confidence: 0.92,
  capturedAt: '2026-08-02T12:00:00.000Z',
};

describe('handoff codes', () => {
  it('are the advertised length and use only unambiguous characters', () => {
    for (let i = 0; i < 200; i++) {
      const code = newCode();
      expect(code).toHaveLength(CODE_LENGTH);
      // The characters that get misread down a phone line are simply absent.
      expect(code).not.toMatch(/[O0I1LU]/);
    }
  });

  it('accept a code the way a person actually types it', () => {
    const code = 'B7K4M2';
    for (const typed of ['B7K4M2', 'b7k4m2', 'B7K4-M2', ' b7 k4 m2 ']) {
      expect(normaliseCode(typed)).toBe(code);
    }
  });

  it('fold the excluded characters onto what the reader meant', () => {
    // Someone hearing "Q" writes "0"; someone reading "J" in a sans-serif font
    // types "1". Rejecting those is a self-inflicted support call.
    expect(normaliseCode('Q7K4M2')).toBe(normaliseCode('07K4M2'));
    expect(normaliseCode('J7K4M2')).toBe(normaliseCode('17K4M2'));
    expect(normaliseCode('J7K4M2')).toBe(normaliseCode('l7k4m2'));
  });

  it('reject anything that is not a code', () => {
    expect(normaliseCode('')).toBeNull();
    expect(normaliseCode('TOOLONGCODE')).toBeNull();
    expect(normaliseCode('ABC')).toBeNull();
    expect(normaliseCode('B7K4M!')).toBeNull();
  });
});

describe('the store', () => {
  it('round-trips a scan through a code', async () => {
    const store = new MemoryHandoffStore();
    const code = await storeScan(store, SCAN);
    const back = await fetchScan(store, code);
    expect(back).toEqual(SCAN);
  });

  it('accepts the code however it was typed', async () => {
    const store = new MemoryHandoffStore();
    const code = await storeScan(store, SCAN);
    expect(await fetchScan(store, code.toLowerCase())).toEqual(SCAN);
    expect(await fetchScan(store, `${code.slice(0, 3)}-${code.slice(3)}`)).toEqual(SCAN);
  });

  it('returns nothing for an unknown or malformed code', async () => {
    const store = new MemoryHandoffStore();
    expect(await fetchScan(store, 'B7K4M2')).toBeNull();
    expect(await fetchScan(store, 'nope')).toBeNull();
  });

  it('expires a code and stops handing out the room behind it', async () => {
    const store = new MemoryHandoffStore();
    const t0 = Date.now();
    const code = await storeScan(store, SCAN, t0, 1000);
    expect(await store.get(code)).not.toBeNull();

    const realNow = Date.now;
    try {
      Date.now = () => t0 + 1001;
      expect(await store.get(code)).toBeNull();
    } finally {
      Date.now = realNow;
    }
  });

  it('builds the URL a person opens', () => {
    expect(handoffUrl('https://app.mozu.example/', 'B7K4M2')).toBe(
      'https://app.mozu.example/scan/B7K4M2',
    );
  });
});

describe('iPad → code → room: the whole chain', () => {
  it('a scan sent from the app arrives as a designable room, fixtures intact', async () => {
    // 1. The iPad serialises exactly what it holds.
    const wire = JSON.stringify(SCAN);

    // 2. The server parses it with the shared contract before storing anything,
    //    so a malformed payload fails while the person is still holding the iPad.
    const parsed = parseScan(wire);
    expect(parsed).not.toBeNull();

    const store = new MemoryHandoffStore();
    const code = await storeScan(store, parsed!);

    // 3. The laptop asks for it by code.
    const received = await fetchScan(store, code);
    expect(received).not.toBeNull();

    // 4. It becomes the configurator's room — and this is the part worth
    //    asserting, because a room whose walls survive but whose sockets do not
    //    is a room the conflict engine cannot protect.
    const geometry = scanToGeometry(received!);
    expect(geometry.walls).toHaveLength(4);
    expect(geometry.provider).toBe('roomplan');

    const allFixtures = geometry.walls.flatMap((w) => w.fixtures ?? []);
    expect(allFixtures).toHaveLength(3);
    expect(allFixtures.filter((f) => f.type === 'socket')).toHaveLength(2);

    const waste = allFixtures.find((f) => f.type === 'waste');
    expect(waste?.diameterMm).toBe(110);
    expect(waste?.offset).toBe(600);
    expect(waste?.height).toBe(350);

    // The door came across too, so the layout cannot block it either.
    expect(geometry.walls[0].openings?.[0]?.type).toBe('door');
  });

  it('keeps a hand-placed socket distinguishable from a detected one', async () => {
    // Provenance survives the trip, because a designer deciding whether to trust
    // a socket's position needs to know whether a person put it there.
    const store = new MemoryHandoffStore();
    const code = await storeScan(store, SCAN);
    const geometry = scanToGeometry((await fetchScan(store, code))!);
    const sockets = geometry.walls.flatMap((w) => w.fixtures ?? []).filter((f) => f.type === 'socket');
    expect(sockets.map((s) => s.source).sort()).toEqual(['detected', 'manual']);
  });
});
