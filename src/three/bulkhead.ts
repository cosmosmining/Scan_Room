import * as THREE from 'three';

/**
 * A bulkhead (soffit) as a solid hanging from the ceiling: its underside at
 * `bottom`, its sides up to the ceiling at `top`, following the outline the
 * scan found — angled and L-shaped edges included. No lid: the top is hidden
 * against the ceiling from inside, and leaving it off keeps the dollhouse view
 * from above looking into the room rather than at a slab.
 *
 * The underside faces down and every side faces out of the outline, whichever
 * way the outline winds. UVs are in millimetres, so the ceiling finish tiles at
 * real size, as on the rest of the shell.
 */
export function bulkheadGeometry(polygon: { x: number; z: number }[], bottom: number, top: number) {
  const geometry = new THREE.BufferGeometry();
  const n = polygon.length;
  if (n < 3 || top <= bottom) return geometry;

  const positions: number[] = [];
  const uvs: number[] = [];
  const vertex = (x: number, y: number, z: number, u: number, v: number) => {
    positions.push(x, y, z);
    uvs.push(u, v);
  };

  // Underside: triangulate, then wind each triangle so it faces down (-y).
  const contour = polygon.map((p) => new THREE.Vector2(p.x, p.z));
  for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(contour, [])) {
    const a = polygon[i];
    let b = polygon[j];
    let c = polygon[k];
    // y of (b − a) × (c − a); facing down needs it negative.
    if ((b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z) > 0) [b, c] = [c, b];
    for (const p of [a, b, c]) vertex(p.x, bottom, p.z, p.x, p.z);
  }

  // Sides: one quad per edge, wound to face out of the outline.
  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    area2 += a.x * b.z - b.x * a.z;
  }
  let along = 0;
  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 1e-6) continue;
    const a0 = [a.x, bottom, a.z, along, bottom] as const;
    const b0 = [b.x, bottom, b.z, along + len, bottom] as const;
    const b1 = [b.x, top, b.z, along + len, top] as const;
    const a1 = [a.x, top, a.z, along, top] as const;
    const quad = area2 > 0 ? [a0, b1, b0, a0, a1, b1] : [a0, b0, b1, a0, b1, a1];
    for (const q of quad) vertex(...q);
    along += len;
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}
