import { createDefaultRoom } from '@/lib/defaults';
import { generateLayout } from './strategy';
import type { LayoutResult, PlacementModule, RunAssignment } from './types';

/**
 * Executable usage examples. These construct requests against the default room
 * (4000 × 3000 mm, walls `wall_0`..`wall_3`) and run the engine. Handy as a
 * smoke check once Node is installed: `import { demoLShapedKitchen } from ...`.
 */

const base = (definitionId: string, width: number): PlacementModule => ({
  definitionId,
  category: 'kitchen-base',
  mount: 'floor',
  width,
  depth: 600,
  height: 900,
});

const oven: PlacementModule = {
  ...base('oven-600', 600),
  category: 'appliance',
  frontClearance: 1100,
};

const wardrobe = (definitionId: string, width: number): PlacementModule => ({
  definitionId,
  category: 'wardrobe-frame',
  mount: 'floor',
  width,
  depth: 600,
  height: 2200,
});

/** Two adjacent walls meeting at a corner → an L. */
export function demoLShapedKitchen(): LayoutResult {
  const room = createDefaultRoom();
  const assignments: RunAssignment[] = [
    { wallId: 'wall_0', modules: [base('b-600', 600), base('b-800', 800), oven] },
    { wallId: 'wall_1', modules: [base('b-600', 600), base('b-1000', 1000)] },
  ];
  return generateLayout({ room, assignments });
}

/** Two opposing walls → a galley; clearance check guards the walkway. */
export function demoGalleyKitchen(): LayoutResult {
  const room = createDefaultRoom();
  const assignments: RunAssignment[] = [
    { wallId: 'wall_0', modules: [base('b-600', 600), base('b-600b', 600)] },
    { wallId: 'wall_2', modules: [base('b-800', 800), oven] },
  ];
  return generateLayout({ room, assignments });
}

/** A single wall of full-height units → a wardrobe wall system. */
export function demoWardrobeWall(): LayoutResult {
  const room = createDefaultRoom();
  const assignments: RunAssignment[] = [
    {
      wallId: 'wall_0',
      modules: [wardrobe('wr-1000', 1000), wardrobe('wr-1000b', 1000), wardrobe('wr-500', 500)],
    },
  ];
  return generateLayout({ room, assignments });
}
