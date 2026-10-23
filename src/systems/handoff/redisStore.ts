/**
 * A `HandoffStore` that survives being deployed.
 *
 * The in-memory store is correct on one long-lived process and wrong everywhere
 * else — and "everywhere else" includes the most likely place this gets hosted.
 * On Vercel, Netlify or any serverless platform, the POST that files a scan and
 * the GET that fetches it can land on DIFFERENT instances, so the code would
 * come back 404 perhaps half the time. That failure is intermittent, which is
 * the worst kind: it looks like a flaky network rather than a missing database,
 * and it will be blamed on the iPad.
 *
 * This talks the Upstash REST dialect, which is what both Upstash Redis and
 * Vercel KV speak. It is plain `fetch` — no client library, no build step, and
 * it runs on the Edge runtime as happily as on Node.
 *
 * Configure with either naming (Vercel KV sets the first pair for you):
 *
 *   KV_REST_API_URL            / KV_REST_API_TOKEN
 *   UPSTASH_REDIS_REST_URL     / UPSTASH_REDIS_REST_TOKEN
 */

import type { RoomScan } from '@mozu/scan-sdk';
import type { HandoffStore, StoredScan } from './scanHandoff';

const PREFIX = 'mozu:handoff:';

export interface RedisConfig {
  url: string;
  token: string;
}

/** Read the config from the environment, whichever naming the host uses. */
export function redisConfigFromEnv(env: NodeJS.ProcessEnv = process.env): RedisConfig | null {
  const url = env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ''), token };
}

export class RedisHandoffStore implements HandoffStore {
  constructor(private readonly config: RedisConfig) {}

  async put(code: string, entry: StoredScan): Promise<void> {
    // Expiry is Redis's job, not ours: SET with EX means a code cannot outlive
    // its TTL even if nothing ever reads it again. A sweep we have to remember
    // to run is a sweep that eventually does not run.
    const ttlSeconds = Math.max(1, Math.round((entry.expiresAt - Date.now()) / 1000));
    await this.command([
      'SET',
      PREFIX + code,
      JSON.stringify(entry),
      'EX',
      String(ttlSeconds),
    ]);
  }

  async get(code: string): Promise<StoredScan | null> {
    const result = await this.command(['GET', PREFIX + code]);
    if (typeof result !== 'string' || !result) return null;
    try {
      const entry = JSON.parse(result) as StoredScan;
      // Belt and braces: Redis should already have dropped it, but a clock skew
      // between writer and reader must not hand out an expired room.
      if (entry.expiresAt <= Date.now()) return null;
      return entry;
    } catch {
      return null;
    }
  }

  async delete(code: string): Promise<void> {
    await this.command(['DEL', PREFIX + code]);
  }

  /** One Upstash REST command. Throws with the server's own message on failure. */
  private async command(args: string[]): Promise<unknown> {
    const res = await fetch(this.config.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.config.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(args),
      cache: 'no-store',
    });
    if (!res.ok) {
      throw new Error(`handoff store: ${res.status} ${await res.text().catch(() => '')}`.trim());
    }
    const body = (await res.json()) as { result?: unknown; error?: string };
    if (body.error) throw new Error(`handoff store: ${body.error}`);
    return body.result ?? null;
  }
}

/** Convenience for tests and callers that only have a scan. */
export type { RoomScan };
