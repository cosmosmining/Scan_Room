'use client';

import { useMemo, useState } from 'react';
import {
  FURNITURE_CATEGORIES,
  furnitureIn,
  furnitureItem,
} from '@/systems/furniture/catalog';
import { recommendFurniture } from '@/systems/furniture/recommend';
import { useConfiguratorStore } from '@/state/useConfiguratorStore';

/**
 * The Modules step's controls — the web twin of the iPad's bottom bar: Add
 * Furniture, Need advice (Recommend), and the placed-items list with the
 * duplicate / rotate / delete actions the plan's selection also offers.
 *
 * The step used to render "Controls placeholder", which is a fair description
 * of how much of the iPad's design mode had made it across.
 */
const TABS = ['Catalogue', 'Advice', 'Placed'] as const;
type Tab = (typeof TABS)[number];

export function FurniturePanel() {
  const [tab, setTab] = useState<Tab>('Catalogue');

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

      {tab === 'Catalogue' && <Catalogue />}
      {tab === 'Advice' && <Advice />}
      {tab === 'Placed' && <Placed />}
    </div>
  );
}

/** `AddFurnitureSheet` — category tabs over the catalogue, one tap to place. */
function Catalogue() {
  const addFurniture = useConfiguratorStore((s) => s.addFurniture);
  const [category, setCategory] = useState(FURNITURE_CATEGORIES[0]);
  const items = useMemo(() => furnitureIn(category), [category]);

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap gap-1.5">
        {FURNITURE_CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(c)}
            className={`rounded-full px-2.5 py-1 text-xs ${
              c === category ? 'bg-white text-neutral-950' : 'bg-white/10 text-neutral-300'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      <ul className="flex flex-col gap-1.5">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => addFurniture(item.id)}
              className="flex w-full items-center justify-between rounded-lg border border-white/10 bg-neutral-900/60 px-3 py-2.5 text-left hover:border-white/25"
            >
              <span className="min-w-0 truncate">{item.name}</span>
              <span className="ml-3 shrink-0 tabular-nums text-xs text-neutral-500">
                {item.size.width} × {item.size.depth} mm
              </span>
            </button>
          </li>
        ))}
      </ul>

      <p className="text-xs text-neutral-600">
        Placed at the room centre — drag it on the plan or in 3D from there.
      </p>
    </div>
  );
}

/** `RecommendPanel` — whole sets, laid along the room's longest wall. */
function Advice() {
  const room = useConfiguratorStore((s) => s.room);
  const applyRecommendation = useConfiguratorStore((s) => s.applyRecommendation);
  // Deterministic for a given room, so there is nothing to recompute live.
  const recommendations = useMemo(() => recommendFurniture(room), [room]);

  if (recommendations.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-white/10 p-4 text-sm text-neutral-400">
        No sets fit this room yet — scan or draw a room with a wall long enough to lay a run
        against.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {recommendations.map((rec) => (
        <div key={rec.id} className="rounded-lg border border-white/10 bg-neutral-900/60 p-3">
          <div className="flex items-baseline justify-between gap-2">
            <h4 className="text-sm font-medium">{rec.title}</h4>
            <span className="shrink-0 text-xs text-neutral-500">{rec.items.length} pieces</span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-neutral-400">{rec.rationale}</p>
          <button
            type="button"
            onClick={() => applyRecommendation(rec.items)}
            className="mt-2.5 w-full rounded-md bg-white px-3 py-2 text-xs font-medium text-neutral-950"
          >
            Place this set
          </button>
        </div>
      ))}
    </div>
  );
}

/** What is in the room, with the same actions the plan's selection offers. */
function Placed() {
  const items = useConfiguratorStore((s) => s.designItems);
  const selection = useConfiguratorStore((s) => s.designSelection);
  const select = useConfiguratorStore((s) => s.selectFurniture);
  const remove = useConfiguratorStore((s) => s.removeFurniture);
  const duplicate = useConfiguratorStore((s) => s.duplicateFurniture);
  const rotateItem = useConfiguratorStore((s) => s.rotateFurniture);
  const clear = useConfiguratorStore((s) => s.clearFurniture);

  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-white/10 p-4 text-sm text-neutral-400">
        Nothing placed yet. Add something from the catalogue, or take a set from Advice.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {items.map((placed) => {
        const item = furnitureItem(placed.itemId);
        const isSelected = placed.id === selection;
        return (
          <div
            key={placed.id}
            className={`rounded-lg border p-2.5 ${
              isSelected ? 'border-sky-400 bg-sky-400/5' : 'border-white/10 bg-neutral-900/60'
            }`}
          >
            <button
              type="button"
              onClick={() => select(isSelected ? null : placed.id)}
              className="flex w-full items-center justify-between text-left text-sm"
            >
              <span className="min-w-0 truncate">{item?.name ?? placed.itemId}</span>
              <span className="ml-2 shrink-0 tabular-nums text-xs text-neutral-500">
                {Math.round((placed.rotationY * 180) / Math.PI)}°
              </span>
            </button>
            {isSelected && (
              <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                <button
                  type="button"
                  onClick={() => rotateItem(placed.id, placed.rotationY + Math.PI / 2)}
                  className="rounded border border-white/15 px-2 py-1 text-neutral-300"
                >
                  Rotate 90°
                </button>
                <button
                  type="button"
                  onClick={() => duplicate(placed.id)}
                  className="rounded border border-white/15 px-2 py-1 text-neutral-300"
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  onClick={() => remove(placed.id)}
                  className="ml-auto rounded border border-red-500/40 px-2 py-1 text-red-300"
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        );
      })}

      <button
        type="button"
        onClick={clear}
        className="mt-1 self-start text-xs text-neutral-500 underline"
      >
        Clear all
      </button>
    </div>
  );
}
