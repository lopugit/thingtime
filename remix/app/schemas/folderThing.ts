import { BUILDER_THING_KIND } from './builderThing';
// Compatibility for early Lopu folders: explicit data kind/type markers only.
// Merely naming a data Thing "folder" never makes it a container.
export const isFolderThing = (thing: { thingtime?: readonly string[]; crystal?: Record<string, unknown> | null }): boolean =>
  !!thing.thingtime?.includes('folder') ||
  (!!thing.thingtime?.includes('data') && thing.thingtime.every(kind => kind === 'data' || kind === BUILDER_THING_KIND) &&
    (thing.crystal?.kind === 'folder' || thing.crystal?.type === 'folder'));

export const folderThingMatch = () => ({ $or: [
  { thingtime: 'folder' },
  { thingtime: ['data'], 'crystal.kind': 'folder' },
  { thingtime: ['data'], 'crystal.type': 'folder' },
  { thingtime: { $all: ['data', BUILDER_THING_KIND], $size: 2 }, 'crystal.kind': 'folder' },
  { thingtime: { $all: ['data', BUILDER_THING_KIND], $size: 2 }, 'crystal.type': 'folder' }
] });
