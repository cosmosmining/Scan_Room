import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoomScan } from '@mozu/scan-sdk';
import { RedisHandoffStore, redisConfigFromEnv } from '../redisStore';
import { fetchScan, storeScan } from '../scanHandoff';
import { __resetHandoffStoreForTests, resolveHandoffStore } from '../store';

const SCAN = {
  schema: 'mozu.roomscan/1',
  polygon: [{ x: 0, z: 0 }, { x: 3000, z: 0 }, { x: 3000, z: 2000 }, { x: 0, z: 2000 }],
  height: 2400,
  openings: [],
  objects: [],
  fixtures: [{ type: 'socket', wall: 0, offset: 500, height: 1100, source: 'detected', confidence: 0.9 }],
  source: 'roomplan',
  unitSystem: 'metric',
  confidence: 0.9,
  capturedAt: '2026-08-02T12:00:00.000Z',
} as RoomScan;

/** A Redis that lives in a Map, speaking the Upstash REST dialect. */
function fakeRedis() {
  const data = new Map<string, string>();
  const calls: string[][] = [];
  const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
    const args = JSON.parse(String(init.body)) as string[];
    calls.push(args);
    const [cmd, key, value] = args;
    let result: unknown = null;
    if (cmd === 'SET') { data.set(key, value); result = 'OK'; }
    else if (cmd === 'GET') result = data.get(key) ?? null;
    else if (cmd === 'DEL') { data.delete(key); result = 1; }
    return { ok: true, json: async () => ({ result }) } as unknown as Response;
  });
  return { data, calls, fetchImpl };
}

afterEach(() => {
  vi.unstubAllGlobals();
  __resetHandoffStoreForTests();
});

describe('the Redis-backed store', () => {
  it('round-trips a scan through a code', async () => {
    const { fetchImpl } = fakeRedis();
    vi.stubGlobal('fetch', fetchImpl);
    const store = new RedisHandoffStore({ url: 'https://kv.example', token: 't' });

    const code = await storeScan(store, SCAN);
    expect(await fetchScan(store, code.toLowerCase())).toEqual(SCAN);
  });

  it('hands expiry to Redis rather than hoping something sweeps', async () => {
    // A TTL we have to remember to enforce is a TTL that eventually is not
    // enforced, so SET carries EX and Redis owns the deadline.
    const { calls, fetchImpl } = fakeRedis();
    vi.stubGlobal('fetch', fetchImpl);
    const store = new RedisHandoffStore({ url: 'https://kv.example', token: 't' });

    await storeScan(store, SCAN, Date.now(), 60_000);
    const set = calls.find((c) => c[0] === 'SET')!;
    expect(set[3]).toBe('EX');
    expect(Number(set[4])).toBeGreaterThan(50);
    expect(Number(set[4])).toBeLessThanOrEqual(60);
  });

  it('refuses to hand back a room whose deadline has passed', async () => {
    // Defence against clock skew between the writer and the reader: the entry
    // itself carries its expiry, so a stale read cannot resurrect a room.
    const { data, fetchImpl } = fakeRedis();
    vi.stubGlobal('fetch', fetchImpl);
    const store = new RedisHandoffStore({ url: 'https://kv.example', token: 't' });

    const code = await storeScan(store, SCAN);
    const key = [...data.keys()][0];
    const entry = JSON.parse(data.get(key)!);
    data.set(key, JSON.stringify({ ...entry, expiresAt: Date.now() - 1 }));

    expect(await store.get(code)).toBeNull();
  });

  it('surfaces the server’s own error rather than a bare failure', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: false, status: 401, text: async () => 'Unauthorized',
    }) as unknown as Response);
    const store = new RedisHandoffStore({ url: 'https://kv.example', token: 'wrong' });
    await expect(store.put('ABC123', { scan: SCAN, createdAt: 0, expiresAt: 1 })).rejects.toThrow(/401/);
  });

  it('namespaces its keys so it can share a database', () => {
    const { data, fetchImpl } = fakeRedis();
    vi.stubGlobal('fetch', fetchImpl);
    const store = new RedisHandoffStore({ url: 'https://kv.example', token: 't' });
    return storeScan(store, SCAN).then(() => {
      expect([...data.keys()][0]).toMatch(/^mozu:handoff:/);
    });
  });
});

describe('choosing a store', () => {
  it('reads either naming convention', () => {
    expect(redisConfigFromEnv({ KV_REST_API_URL: 'https://a/', KV_REST_API_TOKEN: 'x' } as never))
      .toEqual({ url: 'https://a', token: 'x' });
    expect(redisConfigFromEnv({ UPSTASH_REDIS_REST_URL: 'https://b', UPSTASH_REDIS_REST_TOKEN: 'y' } as never))
      .toEqual({ url: 'https://b', token: 'y' });
    expect(redisConfigFromEnv({} as never)).toBeNull();
  });

  it('uses Redis when it is configured', () => {
    const store = resolveHandoffStore({ KV_REST_API_URL: 'https://a', KV_REST_API_TOKEN: 'x' } as never);
    expect(store).toBeInstanceOf(RedisHandoffStore);
  });

  it('warns loudly when running in memory on a serverless host', () => {
    // This is the failure that gets blamed on the iPad: the POST and the GET
    // land on different instances, so codes fail INTERMITTENTLY. It must not be
    // silent.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    resolveHandoffStore({ VERCEL: '1' } as never);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('intermittently'));
    warn.mockRestore();
  });
});
