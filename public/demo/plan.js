/**
 * Draw a `mozu.roomscan/1` room as a dimensioned floor plan, in SVG.
 *
 * Shared by both ends of the demo — the iPad panel and the receiving website —
 * on purpose. If the two drew the room with separate code, "the same room
 * arrived" would be a claim about two renderers agreeing, not about the data.
 * One renderer means any difference on screen is a difference in the data.
 */
(function () {
  const NS = 'http://www.w3.org/2000/svg';

  const LABEL = {
    socket: 'Socket',
    switch: 'Switch',
    water: 'Water',
    waste: 'Waste',
    gas: 'Gas',
    vent: 'Vent',
    radiator: 'Radiator',
  };
  const GLYPH = { socket: 'S', switch: 'L', water: 'W', waste: 'D', gas: 'G', vent: 'V', radiator: 'R' };

  const el = (name, attrs, text) => {
    const node = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const sub = (a, b) => ({ x: a.x - b.x, z: a.z - b.z });
  const len = (a) => Math.hypot(a.x, a.z);
  const unit = (a) => {
    const l = len(a) || 1;
    return { x: a.x / l, z: a.z / l };
  };

  /** Signed area tells us which side of a wall is inside the room. */
  function signedArea(points) {
    let a = 0;
    for (let i = 0; i < points.length; i++) {
      const q = points[(i + 1) % points.length];
      a += points[i].x * q.z - q.x * points[i].z;
    }
    return a / 2;
  }

  /**
   * @param {SVGElement} svg   target, emptied first
   * @param {object} scan      a mozu.roomscan/1 room
   * @param {object} [opts]    { pad, showLabels }
   */
  window.drawRoomPlan = function drawRoomPlan(svg, scan, opts = {}) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const pts = scan.polygon;
    if (!pts || pts.length < 3) return;

    const showLabels = opts.showLabels !== false;
    const xs = pts.map((p) => p.x);
    const zs = pts.map((p) => p.z);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const span = Math.max(maxX - minX, maxZ - minZ);

    // Room-space padding so labels outside the walls stay on canvas.
    const pad = opts.pad ?? span * 0.22;
    const W = maxX - minX + pad * 2;
    const H = maxZ - minZ + pad * 2;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    const P = (p) => ({ x: p.x - minX + pad, y: p.z - minZ + pad });
    // Everything scales off the room so the plan reads the same at any size.
    const wallW = Math.max(span / 45, 55);
    const thin = wallW * 0.16;
    const font = span / 20;

    svg.appendChild(el('rect', { x: 0, y: 0, width: W, height: H, fill: '#f7f7f4' }));

    // Floor + walls.
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${P(p).x} ${P(p).y}`).join(' ') + ' Z';
    svg.appendChild(el('path', { d, fill: '#fdfdfb', stroke: '#1e2733', 'stroke-width': wallW, 'stroke-linejoin': 'miter' }));

    const ccw = signedArea(pts) > 0;

    // Openings: cut the wall, then draw a swing or a bar.
    for (const op of scan.openings ?? []) {
      const a = pts[op.wall];
      const b = pts[(op.wall + 1) % pts.length];
      if (!a || !b) continue;
      const dir = unit(sub(b, a));
      const total = len(sub(b, a));
      const o = Math.min(Math.max(op.offset, 0), Math.max(0, total - op.width));
      const s = P({ x: a.x + dir.x * o, z: a.z + dir.z * o });
      const e = P({ x: a.x + dir.x * (o + op.width), z: a.z + dir.z * (o + op.width) });

      svg.appendChild(el('line', { x1: s.x, y1: s.y, x2: e.x, y2: e.y, stroke: '#fdfdfb', 'stroke-width': wallW * 1.3 }));
      if (op.type === 'window') {
        svg.appendChild(el('line', { x1: s.x, y1: s.y, x2: e.x, y2: e.y, stroke: '#1e2733', 'stroke-width': thin * 1.5 }));
      } else {
        // Hinge at the leading edge, leaf swinging into the room.
        const cw = { x: dir.z, z: -dir.x };
        const inward = ccw ? { x: -cw.x, z: -cw.z } : cw;
        const leaf = P({ x: a.x + dir.x * o + inward.x * op.width, z: a.z + dir.z * o + inward.z * op.width });
        svg.appendChild(el('line', { x1: s.x, y1: s.y, x2: leaf.x, y2: leaf.y, stroke: '#1e2733', 'stroke-width': thin * 1.5 }));
        const r = Math.hypot(leaf.x - s.x, leaf.y - s.y);
        svg.appendChild(el('path', {
          d: `M${e.x} ${e.y} A${r} ${r} 0 0 ${ccw ? 1 : 0} ${leaf.x} ${leaf.y}`,
          fill: 'none', stroke: '#9aa3ad', 'stroke-width': thin, 'stroke-dasharray': `${thin * 3} ${thin * 2}`,
        }));
      }
    }

    // Fixtures: a marker just inside the wall, with its label beside it.
    //
    // Labels are staggered when they would collide. A sink's water and waste sit
    // 150mm apart on a real wall, so overlapping text is the NORMAL case, not an
    // edge case — and two labels printed on top of each other is the one outcome
    // that makes the plan less informative than no labels at all.
    const placed = [];
    for (const f of scan.fixtures ?? []) {
      const a = pts[f.wall];
      const b = pts[(f.wall + 1) % pts.length];
      if (!a || !b) continue;
      const dir = unit(sub(b, a));
      const t = Math.min(Math.max(f.offset, 0), len(sub(b, a)));
      const onWall = { x: a.x + dir.x * t, z: a.z + dir.z * t };
      const cw = { x: dir.z, z: -dir.x };
      const inward = ccw ? { x: -cw.x, z: -cw.z } : cw;

      const r = wallW * 0.62;
      const anchor = P(onWall);
      const c = { x: anchor.x + inward.x * r * 1.2, y: anchor.y + inward.z * r * 1.2 };

      svg.appendChild(el('line', { x1: anchor.x, y1: anchor.y, x2: c.x, y2: c.y, stroke: '#1e2733', 'stroke-width': thin }));
      // Detected is filled, hand-placed is hollow — provenance visible at a glance.
      const detected = f.source === 'detected';
      svg.appendChild(el('circle', {
        cx: c.x, cy: c.y, r,
        fill: detected ? '#1e2733' : '#fdfdfb', stroke: '#1e2733', 'stroke-width': thin * 1.2,
      }));
      svg.appendChild(el('text', {
        x: c.x, y: c.y + r * 0.38, 'font-size': r * 1.1, 'font-weight': 700,
        fill: detected ? '#fdfdfb' : '#1e2733', 'text-anchor': 'middle',
      }, GLYPH[f.type] ?? '?'));

      if (showLabels) {
        const text = (LABEL[f.type] ?? f.type) + (f.diameterMm ? ` ⌀${f.diameterMm}` : '');
        // Step further into the room until this label clears the ones already
        // drawn, then remember where it landed.
        let depth = 2.4;
        let lx = 0, ly = 0;
        for (let attempt = 0; attempt < 6; attempt++) {
          lx = c.x + inward.x * r * depth;
          ly = c.y + inward.z * r * depth;
          const clash = placed.some((q) => Math.abs(q.x - lx) < font * 3.4 && Math.abs(q.y - ly) < font * 0.85);
          if (!clash) break;
          depth += 1.35;
        }
        placed.push({ x: lx, y: ly });
        svg.appendChild(el('line', {
          x1: c.x, y1: c.y, x2: lx, y2: ly, stroke: '#c2c8cf', 'stroke-width': thin * 0.6,
        }));
        svg.appendChild(el('text', {
          x: lx, y: ly + font * 0.18, 'font-size': font * 0.62, fill: '#1e2733',
          'text-anchor': Math.abs(inward.x) > 0.5 ? (inward.x > 0 ? 'start' : 'end') : 'middle',
        }, text));
      }
    }

    // Wall lengths, outside each wall.
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const l = len(sub(b, a));
      if (l < 500) continue;
      const dir = unit(sub(b, a));
      const cw = { x: dir.z, z: -dir.x };
      const outward = ccw ? cw : { x: -cw.x, z: -cw.z };
      const mid = { x: (a.x + b.x) / 2 + outward.x * font * 1.15, z: (a.z + b.z) / 2 + outward.z * font * 1.15 };
      const p = P(mid);
      const label = (l / 1000).toFixed(2) + ' m';
      const w = label.length * font * 0.46 + font * 0.5;
      svg.appendChild(el('rect', {
        x: p.x - w / 2, y: p.y - font * 0.6, width: w, height: font * 1.2, rx: font * 0.3, fill: '#111418',
      }));
      svg.appendChild(el('text', {
        x: p.x, y: p.y + font * 0.24, 'font-size': font * 0.68, 'font-weight': 600, fill: '#fff', 'text-anchor': 'middle',
      }, label));
    }

    // Area + ceiling, in the middle of the mass.
    const cx = P({ x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 });
    const area = Math.abs(signedArea(pts)) / 1e6;
    svg.appendChild(el('text', {
      x: cx.x, y: cx.y, 'font-size': font * 0.95, 'font-weight': 600, fill: '#1e2733', 'text-anchor': 'middle',
    }, `${area.toFixed(1)} m²`));
    svg.appendChild(el('text', {
      x: cx.x, y: cx.y + font * 0.85, 'font-size': font * 0.55, fill: '#6b7480', 'text-anchor': 'middle',
    }, `ceiling ${(scan.height / 1000).toFixed(2)} m`));
  };
})();
