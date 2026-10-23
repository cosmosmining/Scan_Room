/**
 * Pick the handoff store this deployment should use, and say so out loud.
 *
 * There are exactly two situations, and confusing them is the failure that
 * wastes an afternoon:
 *
 *   * ONE long-lived process — `next start` on a laptop, a VPS, a container.
 *     Memory is fine, and needs no accounts or keys.
 *   * SERVERLESS or more than one instance — Vercel, Netlify, a load balancer.
 *     Memory is broken: the POST that files a scan and the GET that fetches it
 *     can land on different instances, so codes fail INTERMITTENTLY, which
 *     everyone will blame on the iPad or the wifi rather than on the store.
 *
 * So when Redis is configured we use it, and when it is not we log which mode
 * we are in and why. A store that silently degrades is worse than one that
 * refuses, because the failure surfaces in front of a customer.
 */

import { MemoryHandoffStore, type HandoffStore } from './scanHandoff';
import { RedisHandoffStore, redisConfigFromEnv } from './redisStore';

let cached: HandoffStore | null = null;
let announced = false;

export function resolveHandoffStore(env: NodeJS.ProcessEnv = process.env): HandoffStore {
  if (cached) return cached;

  const redis = redisConfigFromEnv(env);
  if (redis) {
    cached = new RedisHandoffStore(redis);
    if (!announced) {
      announced = true;
      console.log('[mozu] scan handoff: Redis/KV store — safe on serverless and multi-instance.');
    }
    return cached;
  }

  // Reuse one Map across hot reloads in dev, or every save wipes the codes.
  const g = globalThis as unknown as { __mozuScanHandoff?: MemoryHandoffStore };
  cached = g.__mozuScanHandoff ??= new MemoryHandoffStore();
  if (!announced) {
    announced = true;
    const serverless = Boolean(env.VERCEL ?? env.NETLIFY ?? env.AWS_LAMBDA_FUNCTION_NAME);
    if (serverless) {
      console.warn(
        '[mozu] scan handoff: IN-MEMORY store on a serverless host. Handoff codes will fail ' +
          'intermittently, because the upload and the lookup can hit different instances. ' +
          'Set KV_REST_API_URL and KV_REST_API_TOKEN (Vercel KV) or UPSTASH_REDIS_REST_URL / ' +
          'UPSTASH_REDIS_REST_TOKEN. See docs/hosting.md.',
      );
    } else {
      console.log(
        '[mozu] scan handoff: in-memory store — correct for a single process. ' +
          'Set KV_REST_API_URL / KV_REST_API_TOKEN before running more than one instance.',
      );
    }
  }
  return cached;
}

/** Tests need a clean slate. */
export function __resetHandoffStoreForTests(): void {
  cached = null;
  announced = false;
}
