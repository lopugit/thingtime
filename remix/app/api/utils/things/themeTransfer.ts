import { deleteTheme, getOwnedTheme, getSharedTheme, saveTheme } from '../themes/themes';
import type { JsonValue, TransferThing } from '../../../utils/thingTransfer/format';
import { readManagedContentFolder } from './managedPlacement';

const defaults = { owned: getOwnedTheme, shared: getSharedTheme, save: saveTheme, remove: deleteTheme, folder: readManagedContentFolder };

export const isTransferTheme = (thing: Pick<TransferThing, 'thingtime'>): boolean =>
  thing.thingtime.length === 1 && thing.thingtime[0] === 'theme';

/** Theme tokens belong to the home-plane theme writer, not generic Thing CRUD.
 * Do not carry publication, active-theme selection or caller-supplied IDs. */
export const readTransferTheme = async (ownerId: string | undefined, id: string, deps = defaults): Promise<TransferThing | null> => {
  const theme = (ownerId ? await deps.owned(ownerId, id) : null) || await deps.shared(id);
  if (!theme) return null;
  const folderId = await deps.folder?.(ownerId, id);
  return { id: theme.id, thingtime: ['theme'], crystal: { name: theme.name, theme: theme.theme as unknown as JsonValue }, ...(folderId ? { folderId } : {}) };
};

export const validateTransferTheme = (thing: TransferThing): void => {
  if (!isTransferTheme(thing) || thing.targetId || thing.extended != null || thing.tags?.length ||
    Object.keys(thing.crystal).some(key => key !== 'name' && key !== 'theme')) {
    throw new Error('Theme transfers contain only a name, theme tokens and optional folder placement');
  }
  if (typeof thing.crystal.name !== 'string' || !thing.crystal.name.trim() || thing.crystal.name.length > 60 ||
    !thing.crystal.theme || typeof thing.crystal.theme !== 'object' || Array.isArray(thing.crystal.theme)) {
    throw new Error('A theme transfer requires a name and theme token object');
  }
};

export const createTransferTheme = async (ownerId: string, thing: TransferThing, deps = defaults) => {
  validateTransferTheme(thing);
  return deps.save(ownerId, { name: thing.crystal.name, theme: thing.crystal.theme, visibility: 'private' });
};

export const removeTransferTheme = (ownerId: string, id: string) => defaults.remove(ownerId, id);
