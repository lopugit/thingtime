// Compatibility for early Lopu folders: explicit data kind/type markers only.
// Merely naming a data Thing "folder" never makes it a container.
export const isFolderThing = (thing: { thingtime?: readonly string[]; crystal?: Record<string, unknown> | null }): boolean =>
  !!thing.thingtime?.includes('folder') ||
  (thing.thingtime?.length === 1 && thing.thingtime[0] === 'data' &&
    (thing.crystal?.kind === 'folder' || thing.crystal?.type === 'folder'));

export const folderThingMatch = () => ({ $or: [
  { thingtime: 'folder' },
  { thingtime: ['data'], 'crystal.kind': 'folder' },
  { thingtime: ['data'], 'crystal.type': 'folder' }
] });
