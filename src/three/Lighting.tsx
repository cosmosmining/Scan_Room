import { Environment, Lightformer } from '@react-three/drei';
import type { LightingPreset } from '@/state/types';

/**
 * Lighting, ported from `DesignScene3DView.configureEnvironment` +
 * `buildLighting`.
 *
 * The important part is the environment, not the lamps. PBR materials need
 * something to REFLECT or they read as flat plastic no matter how many lights
 * you add — that comment in the Swift is the whole reason the iPad bundles a
 * Studio skybox, and its absence is why the web's oak looked like grey card.
 * Here the environment is built from `Lightformer` panels rendered into a cube
 * target: no HDRI download, nothing to 404 on a LAN, and the same job done.
 *
 * On top of it sits the iPad's four-light rig — a warm key that casts the
 * shadows, a cool sky fill from the opposite side, an overhead skylight, and a
 * faint up-fill so shadowed faces never crush to black. Intensities are
 * translated from RealityKit lux to Three.js units by their ratios, which is
 * what preserves the LOOK; copying the numbers would just be bright.
 */
export function Lighting({ preset }: { preset: LightingPreset }) {
  if (preset === 'evening') {
    return (
      <>
        <color attach="background" args={['#14100e']} />
        <Environment resolution={128}>
          <Lightformer intensity={0.5} color="#ffb070" position={[3, 4, 2]} scale={[8, 8, 1]} />
          <Lightformer intensity={0.12} color="#3a2f4a" position={[0, -3, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[16, 16, 1]} />
        </Environment>
        <ambientLight intensity={0.18} />
        <directionalLight
          castShadow
          position={[3, 6, 2]}
          intensity={1.6}
          color="#ffb070"
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-10}
          shadow-camera-right={10}
          shadow-camera-top={10}
          shadow-camera-bottom={-10}
          shadow-camera-near={0.5}
          shadow-camera-far={40}
          shadow-bias={-0.0004}
        />
        <pointLight position={[2, 2.2, 1.5]} intensity={12} color="#ffd9a0" />
      </>
    );
  }

  const daylight = preset === 'daylight';

  return (
    <>
      <color attach="background" args={[daylight ? '#dfe7ef' : '#f4f2ee']} />

      {/* The "Studio" environment: a bright overhead soft box, two side panels
          and a warm floor bounce. Anything glossy has something to reflect. */}
      <Environment resolution={256}>
        <Lightformer
          intensity={daylight ? 3 : 2.2}
          color="#ffffff"
          position={[0, 6, 0]}
          rotation={[Math.PI / 2, 0, 0]}
          scale={[12, 12, 1]}
        />
        <Lightformer
          intensity={daylight ? 1.6 : 1.1}
          color="#dceaff"
          position={[-6, 3, -4]}
          rotation={[0, Math.PI / 2, 0]}
          scale={[10, 8, 1]}
        />
        <Lightformer
          intensity={daylight ? 1.2 : 0.9}
          color="#fff3e2"
          position={[6, 3, 4]}
          rotation={[0, -Math.PI / 2, 0]}
          scale={[10, 8, 1]}
        />
        <Lightformer
          intensity={0.5}
          color="#e8dcc8"
          position={[0, -3, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          scale={[16, 16, 1]}
        />
      </Environment>

      {/* Key: warm sun from a high front-side angle, the only shadow caster —
          `key.look(at: .zero, from: [4, 7, 5])`. */}
      <directionalLight
        castShadow
        position={[4, 7, 5]}
        intensity={daylight ? 2.2 : 1.8}
        color="#fff7ea"
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-10}
        shadow-camera-right={10}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
        shadow-camera-near={0.5}
        shadow-camera-far={40}
        // Without this, a wall's own shadow stripes it at grazing angles.
        shadow-bias={-0.0004}
      />
      {/* Sky fill from the opposite side — lifts the shadows so the room reads
          like daylight rather than one hard spotlight. */}
      <directionalLight position={[-5, 4, -4]} intensity={0.7} color="#dbe8ff" />
      {/* Overhead skylight, so floors and worktops are not flat-lit. */}
      <directionalLight position={[0.5, 9, 0.5]} intensity={0.45} color="#ffffff" />
      {/* Up-fill: bounced ambient, so undersides never crush to black. */}
      <directionalLight position={[0, -2, 0]} intensity={0.35} color="#fffaf2" />
      <ambientLight intensity={0.12} />
    </>
  );
}
