import type { StateCreator } from 'zustand';
import { createDefaultRoom } from '@/lib/defaults';
import type { ConfiguratorState, RoomSlice } from '@/state/types';

export const createRoomSlice: StateCreator<
  ConfiguratorState,
  [],
  [],
  RoomSlice
> = (set) => ({
  room: createDefaultRoom(),
  setRoom: (room) => set({ room }),
  updateRoom: (patch) =>
    set((s) => ({
      room: { ...s.room, ...patch, updatedAt: new Date().toISOString() },
    })),
  resetRoom: () => set({ room: createDefaultRoom() }),
});
