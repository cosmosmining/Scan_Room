import { OrbitControls } from '@react-three/drei';
import { useConfiguratorStore } from '@/state/useConfiguratorStore';
import { DesignItems } from './DesignItems';
import { HumanAvatar } from './HumanAvatar';
import { Lighting } from './Lighting';
import { ModuleInstances } from './ModuleInstances';
import { RoomShell } from './RoomShell';
import { SnapGuides } from './SnapGuides';
import { WallDropTarget, useWallDrag } from './DragToWall';
import { WallFixtures } from './WallFixtures';
import { MM_TO_M, roomCenterM } from './units';

/**
 * Scene graph. Lights, grid, and camera controls live in metre space; the room,
 * modules, snap guides, and avatar are authored in millimetres inside the
 * MM_TO_M group. The graph is a pure projection of the store.
 */
export function Scene() {
  const room = useConfiguratorStore((s) => s.room);
  const lightingPreset = useConfiguratorStore((s) => s.lightingPreset);
  const showAvatar = useConfiguratorStore((s) => s.showAvatar);
  const showSnapGuides = useConfiguratorStore((s) => s.showSnapGuides);
  const avatarHeight = useConfiguratorStore((s) => s.avatarHeight);

  const target = roomCenterM(room);
  const { drag, begin } = useWallDrag(room);

  return (
    <>
      <Lighting preset={lightingPreset} />

      {/* Ground grid, dropped 5mm so it never z-fights the room's own floor. */}
      <gridHelper
        args={[14, 28, '#3a3a3a', '#262626']}
        position={[target[0], -0.005, target[2]]}
      />

      <group scale={MM_TO_M}>
        <RoomShell room={room} />
        {/* Sockets and pipework, so the 3D view shows the same room the plan
            does — a cabinet visibly covering a socket is an argument nobody
            misses, where the same clash listed in a panel gets scrolled past. */}
        <WallFixtures room={room} />
        <ModuleInstances onGrab={begin} draggingId={drag.id} />
        {/* Catalogue furniture, placed freely — the iPad's design mode. */}
        <DesignItems />
        {drag.id && <WallDropTarget room={room} wallId={drag.targetWallId} />}
        {showSnapGuides && <SnapGuides room={room} />}
        {showAvatar && <HumanAvatar heightCm={avatarHeight} />}
      </group>

      <OrbitControls
        makeDefault
        // Carrying a unit must not also orbit the camera.
        enabled={!drag.id}
        target={target}
        enableDamping={false}
        minDistance={1.5}
        maxDistance={20}
        maxPolarAngle={Math.PI / 2.05}
      />
    </>
  );
}
