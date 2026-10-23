'use client';

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { ScanEdge } from '@/systems/scan';

/**
 * The glowing boundary lines that snap onto detected edges during a scan — the
 * white wireframe tracing wall/floor/ceiling junctions and object outlines in
 * the reference video. Drawn as a single `LineSegments` for efficiency.
 * Authored in millimetres; wrap in a `<group scale={MM_TO_M}>`.
 */
export function ScanEdges({
  edges,
  color = '#3DE3FF',
}: {
  edges: ScanEdge[];
  color?: string;
}) {
  const geometry = useMemo(() => {
    const positions = new Float32Array(edges.length * 6);
    edges.forEach((edge, i) => {
      positions[i * 6 + 0] = edge.a.x;
      positions[i * 6 + 1] = edge.a.y;
      positions[i * 6 + 2] = edge.a.z;
      positions[i * 6 + 3] = edge.b.x;
      positions[i * 6 + 4] = edge.b.y;
      positions[i * 6 + 5] = edge.b.z;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return g;
  }, [edges]);

  // Free the GPU buffer when the edge set changes or the component unmounts.
  useEffect(() => () => geometry.dispose(), [geometry]);

  if (edges.length === 0) return null;

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color={color} transparent opacity={0.95} toneMapped={false} />
    </lineSegments>
  );
}
