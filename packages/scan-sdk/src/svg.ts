/**
 * Render a {@link Floorplan} to a standalone SVG string — the dimensioned
 * top-down plan in the "2 Floorplan" step. Used by the browser extensions, the
 * iOS app's web preview, file export, and (via the same model) the web app.
 *
 * The viewBox is in millimetres, so every coordinate is drawn at real scale and
 * the plan stays accurate at any display size.
 */
import { add, distance, midpoint, normalize, scale, sub } from './geometry';
import { formatArea, formatLength } from './format';
import { floorplanCenter } from './floorplan';
import { FIXTURE_GLYPH } from './fixtures';
import type { Floorplan, FloorplanFixture, ScanOpening, Vec2 } from './types';

export interface SvgTheme {
  paper: string;
  floor: string;
  wall: string;
  dimension: string;
  label: string;
  labelText: string;
  area: string;
  object: string;
  accent: string;
  /** Marker fill for detected MEP fixtures (sockets / pipes). */
  fixture?: string;
}

const LIGHT: SvgTheme = {
  paper: '#ffffff',
  floor: '#f4f2ee',
  wall: '#1f2937',
  dimension: '#6b7280',
  label: '#111827',
  labelText: '#ffffff',
  area: '#374151',
  object: '#e6e1d8',
  accent: '#2563eb',
  fixture: '#111827',
};

const DARK: SvgTheme = {
  paper: '#0a0a0a',
  floor: '#161618',
  wall: '#e5e7eb',
  dimension: '#9ca3af',
  label: '#f9fafb',
  labelText: '#0a0a0a',
  area: '#d1d5db',
  object: '#2a2a2e',
  accent: '#22d3ee',
  fixture: '#f9fafb',
};

export const THEMES = { light: LIGHT, dark: DARK } as const;

export interface FloorplanSvgOptions {
  theme?: keyof typeof THEMES | SvgTheme;
  /** Padding around the plan, millimetres (room for dimension lines/labels). */
  padding?: number;
  /** Draw per-wall dimension lines + length labels. Default true. */
  dimensions?: boolean;
  /** Draw the area / height summary in the centre. Default true. */
  showArea?: boolean;
  /** Draw detected objects (furniture) if present. Default true. */
  showObjects?: boolean;
  /** Draw detected wall fixtures (sockets / pipes) with labels. Default true. */
  showFixtures?: boolean;
  /** Emit width/height attributes (px) in addition to the viewBox. */
  width?: number;
  height?: number;
}

const esc = (s: string): string =>
  s.replace(/[<>&"']/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c === '"' ? '&quot;' : '&#39;',
  );

const fmt = (n: number): string => (Math.abs(n) < 1e-6 ? '0' : Number(n.toFixed(2)).toString());
const pt = (p: Vec2): string => `${fmt(p.x)},${fmt(p.z)}`;

/** Render the plan to a complete `<svg>…</svg>` document string. */
export function floorplanToSvg(fp: Floorplan, opts: FloorplanSvgOptions = {}): string {
  const theme = resolveTheme(opts.theme);
  const showDims = opts.dimensions !== false;
  const showArea = opts.showArea !== false;
  const showObjects = opts.showObjects !== false;
  const showFixtures = opts.showFixtures !== false;

  const span = Math.max(fp.bounds.width, fp.bounds.depth) || 1000;
  const pad = opts.padding ?? Math.max(span * 0.18, 700);
  const font = clamp(span / 20, 130, 360);
  const wallW = clamp(span / 45, 60, 140);
  const thin = Math.max(wallW * 0.16, 10);
  const dimOff = font * 1.5;

  const vb = {
    x: fp.bounds.minX - pad,
    y: fp.bounds.minZ - pad,
    w: fp.bounds.width + pad * 2,
    h: fp.bounds.depth + pad * 2,
  };

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(vb.x)} ${fmt(vb.y)} ${fmt(vb.w)} ${fmt(vb.h)}"` +
      (opts.width ? ` width="${opts.width}"` : '') +
      (opts.height ? ` height="${opts.height}"` : '') +
      ` font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif">`,
  );
  parts.push(`<rect x="${fmt(vb.x)}" y="${fmt(vb.y)}" width="${fmt(vb.w)}" height="${fmt(vb.h)}" fill="${theme.paper}"/>`);

  // Floor + walls.
  const poly = fp.points.map(pt).join(' ');
  parts.push(`<polygon points="${poly}" fill="${theme.floor}"/>`);
  parts.push(
    `<polygon points="${poly}" fill="none" stroke="${theme.wall}" stroke-width="${fmt(wallW)}" stroke-linejoin="miter"/>`,
  );

  // Objects (furniture from RoomPlan-class scans).
  if (showObjects) {
    for (const o of fp.objects) {
      const deg = (o.rotation * 180) / Math.PI;
      parts.push(
        `<g transform="translate(${fmt(o.center.x)} ${fmt(o.center.z)}) rotate(${fmt(deg)})">` +
          `<rect x="${fmt(-o.width / 2)}" y="${fmt(-o.depth / 2)}" width="${fmt(o.width)}" height="${fmt(o.depth)}" ` +
          `rx="${fmt(thin * 1.5)}" fill="${theme.object}" stroke="${theme.dimension}" stroke-width="${fmt(thin)}"/>` +
          `</g>`,
      );
      parts.push(
        `<text x="${fmt(o.center.x)}" y="${fmt(o.center.z)}" font-size="${fmt(font * 0.55)}" fill="${theme.area}" ` +
          `text-anchor="middle" dominant-baseline="central">${esc(o.category)}</text>`,
      );
    }
  }

  // Openings (doors / windows) drawn over the wall.
  for (const op of fp.openings) {
    const wall = fp.walls[op.wall];
    if (wall) parts.push(opening(op, wall.start, wall.end, theme, wallW, thin));
  }

  // Detected MEP fixtures (sockets / pipes), marked and labelled on the wall.
  if (showFixtures && fp.fixtures.length) {
    for (const f of fp.fixtures) parts.push(fixtureMark(f, theme, { font, thin, wallW }));
  }

  // Dimension lines + auto-captured wall lengths.
  if (showDims) {
    for (const wall of fp.walls) {
      if (wall.length < 1) continue;
      parts.push(
        dimension(wall.start, wall.end, wall.outward, wall.length, fp.unitSystem, theme, {
          off: dimOff,
          font,
          thin,
        }),
      );
    }
  }

  // Area + height summary.
  if (showArea) {
    const c = floorplanCenter(fp);
    parts.push(
      `<text x="${fmt(c.x)}" y="${fmt(c.z)}" font-size="${fmt(font * 1.05)}" font-weight="600" fill="${theme.area}" ` +
        `text-anchor="middle" dominant-baseline="central">${esc(formatArea(fp.areaMm2, fp.unitSystem))}</text>`,
    );
    parts.push(
      `<text x="${fmt(c.x)}" y="${fmt(c.z + font * 1.25)}" font-size="${fmt(font * 0.62)}" fill="${theme.dimension}" ` +
        `text-anchor="middle" dominant-baseline="central">ceiling ${esc(formatLength(fp.height, fp.unitSystem))}</text>`,
    );
  }

  parts.push('</svg>');
  return parts.join('');
}

function dimension(
  start: Vec2,
  end: Vec2,
  outward: Vec2,
  len: number,
  unit: Floorplan['unitSystem'],
  theme: SvgTheme,
  s: { off: number; font: number; thin: number },
): string {
  const n = normalize(outward);
  const a = add(start, scale(n, s.off));
  const b = add(end, scale(n, s.off));
  const ext = s.off * 0.85;
  const mid = midpoint(a, b);
  const label = formatLength(len, unit);
  const halfW = label.length * s.font * 0.31 + s.font * 0.3;
  const halfH = s.font * 0.7;
  const startExt = add(start, scale(n, ext));
  const endExt = add(end, scale(n, ext));
  return (
    `<g stroke="${theme.dimension}" stroke-width="${fmt(s.thin)}" fill="none" stroke-linecap="round">` +
    `<line x1="${fmt(start.x)}" y1="${fmt(start.z)}" x2="${fmt(startExt.x)}" y2="${fmt(startExt.z)}"/>` +
    `<line x1="${fmt(end.x)}" y1="${fmt(end.z)}" x2="${fmt(endExt.x)}" y2="${fmt(endExt.z)}"/>` +
    `<line x1="${fmt(a.x)}" y1="${fmt(a.z)}" x2="${fmt(b.x)}" y2="${fmt(b.z)}"/>` +
    `</g>` +
    `<rect x="${fmt(mid.x - halfW)}" y="${fmt(mid.z - halfH)}" width="${fmt(halfW * 2)}" height="${fmt(halfH * 2)}" ` +
    `rx="${fmt(halfH * 0.5)}" fill="${theme.label}"/>` +
    `<text x="${fmt(mid.x)}" y="${fmt(mid.z)}" font-size="${fmt(s.font * 0.8)}" font-weight="600" fill="${theme.labelText}" ` +
    `text-anchor="middle" dominant-baseline="central">${esc(label)}</text>`
  );
}

function opening(
  op: ScanOpening,
  wallStart: Vec2,
  wallEnd: Vec2,
  theme: SvgTheme,
  wallW: number,
  thin: number,
): string {
  const dir = normalize(sub(wallEnd, wallStart));
  const total = distance(wallStart, wallEnd);
  const o = Math.min(op.offset, Math.max(0, total - op.width));
  const p0 = add(wallStart, scale(dir, o));
  const p1 = add(wallStart, scale(dir, o + op.width));
  // Cut the wall: paint the gap with the floor colour over the wall stroke.
  const cut =
    `<line x1="${fmt(p0.x)}" y1="${fmt(p0.z)}" x2="${fmt(p1.x)}" y2="${fmt(p1.z)}" ` +
    `stroke="${theme.floor}" stroke-width="${fmt(wallW * 1.25)}"/>`;
  if (op.type === 'window') {
    return (
      cut +
      `<line x1="${fmt(p0.x)}" y1="${fmt(p0.z)}" x2="${fmt(p1.x)}" y2="${fmt(p1.z)}" ` +
      `stroke="${theme.wall}" stroke-width="${fmt(thin * 1.4)}"/>`
    );
  }
  // Door: jamb posts + a 90° swing arc + the leaf.
  const inward = { x: -dir.z, z: dir.x }; // perpendicular; either side is fine
  const hinge = p0;
  const leafEnd = add(hinge, scale(inward, op.width));
  const arc =
    `<path d="M ${fmt(p1.x)} ${fmt(p1.z)} A ${fmt(op.width)} ${fmt(op.width)} 0 0 1 ${fmt(leafEnd.x)} ${fmt(leafEnd.z)}" ` +
    `fill="none" stroke="${theme.dimension}" stroke-width="${fmt(thin)}" stroke-dasharray="${fmt(thin * 3)} ${fmt(thin * 2)}"/>`;
  const leaf =
    `<line x1="${fmt(hinge.x)}" y1="${fmt(hinge.z)}" x2="${fmt(leafEnd.x)}" y2="${fmt(leafEnd.z)}" ` +
    `stroke="${theme.wall}" stroke-width="${fmt(thin * 1.4)}"/>`;
  return cut + arc + leaf;
}

/**
 * One fixture on the plan: a glyph disc sitting just inside the wall with its
 * label beside it. A manually-added fixture is drawn hollow so it reads as
 * user-asserted rather than measured.
 */
function fixtureMark(
  f: FloorplanFixture,
  theme: SvgTheme,
  s: { font: number; thin: number; wallW: number },
): string {
  const ink = theme.fixture ?? theme.label;
  const n = normalize(f.inward);
  const r = Math.max(s.wallW * 0.62, s.font * 0.34);
  const c = add(f.point, scale(n, r * 1.15));
  const detected = f.source === 'detected';
  const labelPos = add(c, scale(n, r * 1.5));
  // Push the text further in so it never sits on top of the wall stroke.
  const anchor = Math.abs(n.x) > Math.abs(n.z) ? (n.x > 0 ? 'start' : 'end') : 'middle';
  const dy = Math.abs(n.x) > Math.abs(n.z) ? 0 : n.z > 0 ? s.font * 0.5 : -s.font * 0.5;
  return (
    `<g>` +
    `<line x1="${fmt(f.point.x)}" y1="${fmt(f.point.z)}" x2="${fmt(c.x)}" y2="${fmt(c.z)}" ` +
    `stroke="${ink}" stroke-width="${fmt(s.thin)}"/>` +
    `<circle cx="${fmt(c.x)}" cy="${fmt(c.z)}" r="${fmt(r)}" ` +
    `fill="${detected ? ink : theme.paper}" stroke="${ink}" stroke-width="${fmt(s.thin * 1.2)}"/>` +
    `<text x="${fmt(c.x)}" y="${fmt(c.z)}" font-size="${fmt(r * 1.15)}" font-weight="700" ` +
    `fill="${detected ? theme.paper : ink}" text-anchor="middle" dominant-baseline="central">` +
    `${esc(FIXTURE_GLYPH[f.type] ?? '?')}</text>` +
    `<text x="${fmt(labelPos.x)}" y="${fmt(labelPos.z + dy)}" font-size="${fmt(s.font * 0.52)}" ` +
    `fill="${ink}" text-anchor="${anchor}" dominant-baseline="central">${esc(f.text)}</text>` +
    `</g>`
  );
}

function resolveTheme(t: FloorplanSvgOptions['theme']): SvgTheme {
  if (!t) return LIGHT;
  return typeof t === 'string' ? THEMES[t] : t;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}
