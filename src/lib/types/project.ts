export type ProjectStatus = 'draft' | 'in-review' | 'quoted' | 'archived';

export interface Project {
  id: string;
  ownerId: string; // Supabase auth user id
  name: string;
  roomId: string;
  activeLayoutId: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}
