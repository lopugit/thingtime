import { deleteTheme, getOwnedTheme, getSharedTheme, saveTheme } from '../themes/themes';
import type { JsonValue, TransferThing } from '../../../utils/thingTransfer/format';

const defaults = { owned: getOwnedTheme, shared: getSharedTheme, save: saveTheme, remove: deleteTheme };

export const isTransferTheme = (thing: Pick<TransferThing, 'thingtime'>): boolean =>
  thing.thingtime.length === 1 && thing.thingtime[0] === 'theme';

/** Theme tokens belong to the home-plane theme writer, not generic Thing CRUD.
 * Do not carry publication, active-theme selection or caller-supplied IDs. */
export const readTransferTheme = async (ownerId: string | undefined, id: string, deps = defaults): Promise<TransferThing | null> => {
  const theme = (ownerId ? await deps.owned(ownerId, id) : null) || await deps.shared(id);
  return theme ? { id: theme.id, thingtime: ['theme'], crystal: { name: theme.name, theme: theme.theme as unknown as JsonValue } } : null;
};

export const validateTransferTheme = (thing: TransferThing): void => {
  if (!isTransferTheme(thing) || thing.folderId || thing.targetId || thing.extended != null || thing.tags?.length ||
    Object.keys(thing.crystal).some(key => key !== 'name' && key !== 'theme')) {
    throw new Error('Theme transfers contain only a name and theme tokens; folder placement and extra Thing fields are not supported');
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
