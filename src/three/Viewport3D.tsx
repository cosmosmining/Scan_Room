'use client';

import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { Scene } from './Scene';

/**
 * The WebGL canvas and everything in it. Its own module so that three.js, the
 * model loaders and the scene are fetched only when the 3D view is shown —
 * `SceneCanvas` loads it lazily. A scan opened from its code lands on the 2D
 * plan, and used to download all of it first anyway.
 */
export default function Viewport3D({ cx, cz }: { cx: number; cz: number }) {
  return (
    <Canvas
      shadows
      frameloop="demand"
      dpr={[1, 2]}
      // ACES filmic + sRGB is what RealityKit tonemaps through, and it is
      // what keeps a sunlit plaster wall off pure white.
      gl={{
        antialias: true,
        powerPreference: 'high-performance',
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.05,
        outputColorSpace: THREE.SRGBColorSpace,
      }}
      camera={{ position: [cx + 3.5, 2.6, cz + 4.5], fov: 45, near: 0.1, far: 100 }}
    >
      <Scene />
    </Canvas>
  );
}
