/**
 * Runtime types matching RootStore.allSurfaces / RootStore.allRunProfiles views.
 * These are plain objects (not MST snapshots), so we mirror the view shape directly.
 */

export interface Surface {
  id: string;
  name: string;
  allowedToolIds: string[];
  userId: string;
}

export interface RunProfile {
  id: string;
  name: string;
  selectedToolIds: string[];
  surfaceId: string;
  userId: string;
}
