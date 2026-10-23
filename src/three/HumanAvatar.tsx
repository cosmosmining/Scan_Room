/**
 * Real-scale human proxy for judging proportions, driven by the height slider
 * (140–200 cm). Authored in millimetres; a capsule body + sphere head sized so
 * the crown sits at the given height. Standing inside the room near the front.
 */
export function HumanAvatar({ heightCm }: { heightCm: number }) {
  const h = heightCm * 10; // mm
  const headR = h * 0.07;
  const bodyR = h * 0.13;
  const bodyTotal = h - 2 * headR; // leave room for the head on top
  const capsuleLen = Math.max(bodyTotal - 2 * bodyR, 1);

  return (
    <group position={[900, 0, 2300]}>
      <mesh castShadow position={[0, bodyR + capsuleLen / 2, 0]}>
        <capsuleGeometry args={[bodyR, capsuleLen, 6, 14]} />
        <meshStandardMaterial color="#5b6472" roughness={0.8} />
      </mesh>
      <mesh castShadow position={[0, bodyTotal + headR, 0]}>
        <sphereGeometry args={[headR, 18, 18]} />
        <meshStandardMaterial color="#5b6472" roughness={0.8} />
      </mesh>
    </group>
  );
}
