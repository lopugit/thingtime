export const THING_ARCHIVE_CHANGED = 'thingtime:library-archive-changed';
export type ThingArchiveChanged = {
  origin: string;
  ownerId: string;
  dataPlane: 'home';
  ids: string[];
  archived: boolean;
};
