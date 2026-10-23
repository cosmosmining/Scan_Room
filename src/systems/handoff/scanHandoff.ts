/**
 * The iPad → website handoff: a scan, a short code, a room on screen.
 *
 * The `/scan?scan=<base64>` deep link already carries a RoomScan, and it is the
 * right thing when the iPad and the browser are the same device or a link can be
 * pasted. It is the wrong thing for the actual job:
 *
 *   * A surveyor scans on an iPad and designs on a laptop. There is no link to
 *     paste between them, so the payload has to travel some other way.
 *   * A whole house — several rooms, their openings, objects and fixtures — is
 *     tens of kilobytes of JSON. Base64 inflates that by a third, and browsers,
 *     proxies and chat apps all truncate long URLs at different lengths. A link
 *     that works for a galley kitchen and silently fails for a house is worse
 *     than one that never worked.
 *
 * So the scan is POSTed once and comes back as a SHORT CODE the person can read
 * out, type, or photograph. Six characters from an unambiguous alphabet: no 0/O,
 * no 1/I/L, nothing that turns into a support call when it is read over a phone.
 *
 * Storage is deliberately behind one small interface. The default is in-memory
 * with a TTL, which is honest about what it is — good enough to demonstrate the
 * whole chain end to end, and wrong for production the moment there are two
 * server instances. Swapping in Redis, KV or a table means implementing three
 * methods, and nothing above this file changes.
 */

import type { RoomScan } from '@mozu/scan-sdk';

/**
 * Crockford-style alphabet: no O/0, no I/1/L, no U (which invites a different
 * word). A code gets read aloud down a phone line more often than anyone plans
 * for, so the characters that get confused are simply not in it.
 */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CODE_LENGTH = 6;

/** How long a code stays valid. Long enough to walk to a desk, short enough not to hoard. */
export const HANDOFF_TTL_MS = 24 * 60 * 60 * 1000;

/** Largest scan we accept, so a bad client cannot fill the store. */
export const MAX_SCAN_BYTES = 2_000_000;

export interface StoredScan {
  scan: RoomScan;
  createdAt: number;
  expiresAt: number;
}

export interface HandoffStore {
  put(code: string, entry: StoredScan): Promise<void>;
  get(code: string): Promise<StoredScan | null>;
  delete(code: string): Promise<void>;
}

/** Generate a code. Uses WebCrypto, which is present in Node 20+ and the browser. */
export function newCode(random: (n: number) => Uint8Array = randomBytes): string {
  const bytes = random(CODE_LENGTH);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

/**
 * Accept a code the way a person types it: lower case, with the spaces or
 * hyphens they added to make it readable, and with the characters the alphabet
 * deliberately excludes folded onto the ones it includes.
 *
 * Someone reading "B7K4M2" off a screen will type "b7k4m2", and someone hearing
 * it will type "B7K4M2" or "87K4M2". Rejecting those is a self-inflicted
 * support burden — the codes are unambiguous by construction, so the only
 * question is whether we bother to decode what the person meant.
 */
export function normaliseCode(input: string): string | null {
  const cleaned = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    // ...then fold the excluded characters onto their nearest neighbours.
    .replace(/0/g, 'Q')
    .replace(/1/g, 'J')
    .replace(/U/g, 'V');
  if (cleaned.length !== CODE_LENGTH) return null;
  for (const c of cleaned) if (!ALPHABET.includes(c)) return null;
  return cleaned;
}

/**
 * In-memory store with lazy expiry.
 *
 * Single-process only, and that is stated rather than hidden: it demonstrates
 * the full chain on one machine and must be replaced before two instances exist.
 * The alternative — pretending a Map is a database — is the kind of thing that
 * looks finished in a demo and pages someone at midnight.
 */
export class MemoryHandoffStore implements HandoffStore {
  private entries = new Map<string, StoredScan>();

  async put(code: string, entry: StoredScan): Promise<void> {
    this.sweep();
    this.entries.set(code, entry);
  }

  async get(code: string): Promise<StoredScan | null> {
    const found = this.entries.get(code);
    if (!found) return null;
    if (found.expiresAt <= Date.now()) {
      this.entries.delete(code);
      return null;
    }
    return found;
  }

  async delete(code: string): Promise<void> {
    this.entries.delete(code);
  }

  /** Drop anything expired. Cheap, and keeps a long-lived process from growing. */
  private sweep(now = Date.now()): void {
    for (const [code, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(code);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}

/**
 * Store a scan and return its code.
 *
 * Retries on collision rather than trusting a 30^6 space to be empty — 729
 * million codes is plenty, but "plenty" is not "never", and a collision would
 * hand someone else's room to the wrong person.
 */
export async function storeScan(
  store: HandoffStore,
  scan: RoomScan,
  now = Date.now(),
  ttlMs = HANDOFF_TTL_MS,
): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = newCode();
    if (await store.get(code)) continue;
    await store.put(code, { scan, createdAt: now, expiresAt: now + ttlMs });
    return code;
  }
  throw new Error('could not allocate a handoff code');
}

/** Fetch a scan by code, accepting whatever the person actually typed. */
export async function fetchScan(store: HandoffStore, input: string): Promise<RoomScan | null> {
  const code = normaliseCode(input);
  if (!code) return null;
  const entry = await store.get(code);
  return entry?.scan ?? null;
}

/** The URL a person opens to land on their room. */
export function handoffUrl(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, '')}/scan/${code}`;
}
