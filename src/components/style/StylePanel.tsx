'use client';

import { useState } from 'react';
import { MaterialEditor } from './MaterialEditor';
import { PhotorealRender } from './PhotorealRender';
import { ThemePicker } from './ThemePicker';
import { DEFAULT_FINISH, type SurfaceFinish } from '@/systems/aesthetic/finishes';
import { furnitureItem } from '@/systems/furniture/catalog';
import { useConfiguratorStore } from '@/state/useConfiguratorStore';

/**
 * The Style step: themes, the finish editor, and a photoreal render.
 *
 * Three tabs rather than one long column, because they are three different
 * jobs — pick a look, tune a surface, see the result — and stacking them makes
 * the two that are not being used into scroll.
 *
 * The finishes live in the store, not here: the 3D scene renders them, and a
 * finish only this panel can see is a finish that exists in the swatch grid and
 * nowhere else — which is exactly what "the room does not look like the iPad's"
 * turned out to mean.
 */
/**
 * "Colour", not "Finishes". The iPad's button is called Change Colour and that
 * is what people call it; "Finishes" is trade language, and a tab nobody reads
 * as the colour control is a colour control nobody finds.
 */
const TABS = ['Colour', 'Theme', 'Render'] as const;
type Tab = (typeof TABS)[number];

export function StylePanel() {
  // Open on the colour editor. The step is called "Pick finishes" and that is
  // what people come here to do; a theme is the occasional shortcut, not the
  // thing you were looking for.
  const [tab, setTab] = useState<Tab>('Colour');

  const target = useConfiguratorStore((s) => s.finishTarget);
  const setTarget = useConfiguratorStore((s) => s.setFinishTarget);
  const applyFinish = useConfiguratorStore((s) => s.applyFinish);
  const wall = useConfiguratorStore((s) => s.wallFinish);
  const floor = useConfiguratorStore((s) => s.floorFinish);
  const ceiling = useConfiguratorStore((s) => s.ceilingFinish);
  // "Selected" follows whichever object is selected — a catalogue piece or a
  // kitchen unit. Only one can be selected at a time, so this is unambiguous.
  const furnitureSelection = useConfiguratorStore((s) => s.designSelection);
  const moduleSelection = useConfiguratorStore((s) => s.selectedNodeId);
  const items = useConfiguratorStore((s) => s.designItems);
  const moduleFinishes = useConfiguratorStore((s) => s.moduleFinishes);
  const selection = furnitureSelection ?? moduleSelection;

  const selectedFinish = furnitureSelection
    ? items.find((i) => i.id === furnitureSelection)?.finish
    : moduleSelection
      ? moduleFinishes[moduleSelection]
      : undefined;
  const current =
    target.kind === 'floor' ? floor
      : target.kind === 'ceiling' ? ceiling
        : target.kind === 'item' ? selectedFinish ?? DEFAULT_FINISH
          : wall;
  const setCurrent = (finish: SurfaceFinish) => applyFinish(finish, target);

  const instances = useConfiguratorStore((s) => s.instances);
  const catalog = useConfiguratorStore((s) => s.catalog);
  const targetName = furnitureSelection
    ? furnitureItem(items.find((i) => i.id === furnitureSelection)?.itemId ?? '')?.name ?? null
    : moduleSelection
      ? catalog.definitions[
          instances.find((i) => i.id === moduleSelection)?.definitionId ?? ''
        ]?.name ?? null
      : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1 rounded-lg bg-white/5 p-1">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 rounded-md px-2 py-1.5 text-xs ${
              t === tab ? 'bg-white text-neutral-950' : 'text-neutral-300'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Theme' && <ThemePicker />}
      {tab === 'Colour' && (
        <MaterialEditor
          finish={current}
          onChange={setCurrent}
          target={target}
          onTargetChange={setTarget}
          hasSelection={selection !== null}
          selectionId={selection}
          targetName={targetName}
          initialCategory={target.kind === 'item' && !selectedFinish ? 'color' : undefined}
        />
      )}
      {tab === 'Render' && <PhotorealRender wall={wall} floor={floor} ceiling={ceiling} />}
    </div>
  );
}
