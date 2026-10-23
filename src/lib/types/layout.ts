import type { ModuleInstance } from './module';

export type LayoutStatus = 'draft' | 'finalized' | 'sent-to-designer';

/** The design domain the user is configuring. */
export type DesignDomain = 'kitchen' | 'wardrobe';

/** High-level arrangement template. */
export type LayoutType =
  | 'straight'
  | 'l-shaped'
  | 'u-shaped'
  | 'galley'
  | 'island';

export interface Layout {
  id: string;
  projectId: string;
  roomId: string;
  name: string;
  domain: DesignDomain;
  type: LayoutType;
  modules: ModuleInstance[];
  /** Bumped on each save; supports optimistic concurrency. */
  version: number;
  status: LayoutStatus;
  createdAt: string;
  updatedAt: string;
}
