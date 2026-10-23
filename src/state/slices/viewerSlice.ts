import type { StateCreator } from 'zustand';
import type { ConfiguratorState, ViewerSlice } from '@/state/types';

export const AVATAR_MIN_CM = 140;
export const AVATAR_MAX_CM = 200;

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(Math.max(v, lo), hi);

export const createViewerSlice: StateCreator<
  ConfiguratorState,
  [],
  [],
  ViewerSlice
> = (set) => ({
  lightingPreset: 'studio',
  avatarHeight: 175,
  // Off by default. The scale figure answers "is this worktop the right height
  // for me", which is a question you ask once — and until you ask it, a person
  // standing in the middle of the room is just something in the way of the
  // room. The Avatar button in the viewer bar brings it back.
  showAvatar: false,
  showSnapGuides: true,
  viewMode: '3d',
  setLightingPreset: (preset) => set({ lightingPreset: preset }),
  setAvatarHeight: (cm) =>
    set({ avatarHeight: clamp(Math.round(cm), AVATAR_MIN_CM, AVATAR_MAX_CM) }),
  toggleAvatar: () => set((s) => ({ showAvatar: !s.showAvatar })),
  toggleSnapGuides: () => set((s) => ({ showSnapGuides: !s.showSnapGuides })),
  setViewMode: (mode) => set({ viewMode: mode }),
});
