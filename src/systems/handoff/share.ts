import type { Room } from '@/lib/types';
import {
  createNode,
  createRoot,
  type ConfigNode,
  type NodeKind,
  type ProjectConfiguration,
} from '@/systems/config';
import { canonicalTree } from './id';
import { EXPORT_SCHEMA_VERSION, type CanonicalNode, type SharePayload } from './types';

export function buildSharePayload(
  config: ProjectConfiguration,
  room: Room,
): SharePayload {
  return {
    v: EXPORT_SCHEMA_VERSION,
    styleId: config.styleId,
    materialOverrides: config.materialOverrides,
    selectedAddOnIds: config.selectedAddOnIds,
    room,
    tree: canonicalTree(config.moduleTree),
  };
}

/** Rebuild a fresh module tree (new ids) from a shared canonical tree. */
export function rebuildModuleTree(nodes: CanonicalNode[]): ConfigNode {
  const root = createRoot();
  root.children = nodes.map((n) => canonicalToNode(n, 'module'));
  return root;
}

function canonicalToNode(n: CanonicalNode, kind: NodeKind): ConfigNode {
  const node = createNode(n.definitionId, kind, {
    width: n.width,
    wallId: n.wallId,
    materials: n.materials,
    selectedOptionIds: n.options,
  });
  node.children = n.children.map((c) => canonicalToNode(c, 'accessory'));
  return node;
}

// ── share-link codec (base64url, SSR + browser safe) ─────────────────────────

export function encodeShare(payload: SharePayload): string {
  return base64UrlEncode(JSON.stringify(payload));
}

export function decodeShare(code: string): SharePayload | null {
  try {
    return JSON.parse(base64UrlDecode(code)) as SharePayload;
  } catch {
    return null;
  }
}

export function shareUrl(origin: string, payload: SharePayload): string {
  return `${origin}/share/${encodeShare(payload)}`;
}

// btoa/atob are global in browsers and Node 18+ (the project targets Node 20+).
function base64UrlEncode(str: string): string {
  const utf8 = encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, h) =>
    String.fromCharCode(parseInt(h, 16)),
  );
  return btoa(utf8).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(code: string): string {
  const bin = atob(code.replace(/-/g, '+').replace(/_/g, '/'));
  return decodeURIComponent(
    bin
      .split('')
      .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
      .join(''),
  );
}
