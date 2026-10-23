import { useGLTF } from '@react-three/drei';
import { Suspense, useMemo } from 'react';
import * as THREE from 'three';
import type { ModuleDefinition, ModuleInstance } from '@/lib/types';
import { materialKind, swatchById, type SurfaceFinish } from '@/systems/aesthetic/finishes';
import { useConfiguratorStore } from '@/state/useConfiguratorStore';
import { useFinishTexture } from './finishMaterial';

const FALLBACK_COLOR = '#c9c7c2';

interface Placed {
  inst: ModuleInstance;
  def: ModuleDefinition;
}

/**
 * Placed modules. Definitions with a CAD source (`stepUrl`) render their real
 * GLB model (generated from STEP — see scripts/cad); everything else renders as
 * a sized unit box. The GLB is authored in millimetres, recentred on its
 * footprint with its base at y=0, so it sits at the same `inst.position` the
 * box would.
 *
 * These are drawn as individual meshes rather than one InstancedMesh: units are
 * separately selectable, separately finished and separately draggable, and an
 * `<Instance>` inside drei's `<Instances>` does not reliably receive its own
 * pointer events — which is a poor trade for one draw call in a scene that has
 * a few dozen cabinets, not a few thousand.
 */
export function ModuleInstances({
  onGrab,
  draggingId,
}: {
  /** Called when a unit is picked up, so the scene can drive the drag. */
  onGrab?: (id: string) => void;
  draggingId?: string | null;
} = {}) {
  const instances = useConfiguratorStore((s) => s.instances);
  const catalog = useConfiguratorStore((s) => s.catalog);
  const selectedNodeId = useConfiguratorStore((s) => s.selectedNodeId);

  const placed = useMemo(
    () =>
      instances.flatMap<Placed>((inst) => {
        const def = catalog.definitions[inst.definitionId];
        return def ? [{ inst, def }] : [];
      }),
    [instances, catalog],
  );

  if (placed.length === 0) return null;

  return (
    <Suspense fallback={null}>
      {placed.map(({ inst, def }) => (
        <ModuleMesh
          key={inst.id}
          inst={inst}
          def={def}
          selected={inst.id === selectedNodeId}
          dragging={inst.id === draggingId}
          onGrab={onGrab}
        />
      ))}
    </Suspense>
  );
}

function ModuleMesh({
  inst,
  def,
  selected,
  dragging,
  onGrab,
}: {
  inst: ModuleInstance;
  def: ModuleDefinition;
  selected: boolean;
  dragging: boolean;
  onGrab?: (id: string) => void;
}) {
  const catalog = useConfiguratorStore((s) => s.catalog);
  const selectNode = useConfiguratorStore((s) => s.selectNode);
  const selectFurniture = useConfiguratorStore((s) => s.selectFurniture);
  const setFinishTarget = useConfiguratorStore((s) => s.setFinishTarget);
  const finish = useConfiguratorStore((s) => s.moduleFinishes[inst.id]);

  const width = inst.width ?? def.dimensions.width;
  const { height, depth } = def.dimensions;
  const material = useModuleMaterial(
    finish,
    (inst.finishId && catalog.materials[inst.finishId]?.albedo) || FALLBACK_COLOR,
    dragging,
  );

  const grab = (e: { stopPropagation: () => void }) => {
    e.stopPropagation(); // don't let OrbitControls start a spin
    selectNode(inst.id);
    selectFurniture(null); // one selection at a time, so "Selected" is unambiguous
    setFinishTarget({ kind: 'item', id: inst.id });
    onGrab?.(inst.id);
  };

  return (
    <group position={[inst.position.x, inst.position.y, inst.position.z]} rotation={[0, inst.rotationY, 0]}>
      {def.stepUrl ? (
        <group onPointerDown={grab}>
          {/* Only override the model's authored materials once someone has
              actually chosen a finish — flattening a CAD model's normal and
              roughness maps into one colour is what makes it look like
              plastic, and nobody asked for that by not choosing anything. */}
          <CadModel url={def.modelUrl} override={finish || dragging ? material : null} />
        </group>
      ) : (
        <mesh castShadow receiveShadow position={[0, height / 2, 0]} material={material} onPointerDown={grab}>
          <boxGeometry args={[width, height, depth]} />
        </mesh>
      )}

      {selected && (
        <mesh position={[0, height / 2, 0]}>
          <boxGeometry args={[width + 60, height + 60, depth + 60]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.16} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}

/**
 * A unit's material: the finish someone chose, else the catalogue material's
 * albedo, else a neutral carcass tone. The unit being carried is tinted so it
 * is obvious which one the drop applies to — with several units on a wall,
 * "the one I grabbed" is otherwise a guess.
 */
function useModuleMaterial(
  finish: SurfaceFinish | undefined,
  fallback: string,
  dragging: boolean,
): THREE.MeshStandardMaterial {
  const empty = useMemo<SurfaceFinish>(
    () => ({ swatchId: '', kind: 'matte', textureScale: 1, rotation: 0 }),
    [],
  );
  const texture = useFinishTexture(finish ?? empty);
  const swatch = finish ? swatchById(finish.swatchId) : undefined;
  const kind = materialKind(finish?.kind ?? 'matte');

  return useMemo(() => {
    const material = new THREE.MeshStandardMaterial({ roughness: 0.7 });
    if (dragging) {
      material.color = new THREE.Color('#7dd3fc');
      return material;
    }
    if (finish && texture) {
      const map = texture.clone();
      map.needsUpdate = true;
      // A cabinet door is roughly half a metre, so half a tile across it.
      const repeat = 0.5 * finish.textureScale;
      map.repeat.set(repeat, repeat);
      map.center.set(0.5, 0.5);
      map.rotation = finish.rotation;
      material.map = map;
      material.color = new THREE.Color(finish.tint ?? '#ffffff');
    } else {
      material.color = new THREE.Color(finish ? finish.tint ?? swatch?.color ?? fallback : fallback);
    }
    material.roughness = finish ? kind.roughness : 0.7;
    material.metalness = finish ? kind.metalness : 0;
    if (finish?.kind === 'glass') {
      material.transparent = true;
      material.opacity = kind.opacity;
    }
    return material;
  }, [finish, texture, swatch?.color, fallback, dragging, kind.roughness, kind.metalness, kind.opacity]);
}

function CadModel({ url, override }: { url: string; override: THREE.Material | null }) {
  const { scene } = useGLTF(url);
  const object = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (override) mesh.material = override;
    });
    return clone;
  }, [scene, override]);

  return <primitive object={object} />;
}
