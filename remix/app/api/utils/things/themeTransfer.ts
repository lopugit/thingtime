import { deleteTheme, getOwnedTheme, getSharedTheme, saveTheme } from '../themes/themes';
import type { JsonValue, TransferThing } from '../../../utils/thingTransfer/format';
import { readManagedContentFolder } from './managedPlacement';
import { validateTransferTheme } from '../../../utils/thingTransfer/theme';
export { isTransferTheme, validateTransferTheme } from '../../../utils/thingTransfer/theme';

const defaults = { owned: getOwnedTheme, shared: getSharedTheme, save: saveTheme, remove: deleteTheme, folder: readManagedContentFolder };

/** Theme tokens belong to the home-plane theme writer, not generic Thing CRUD.
 * Do not carry publication, active-theme selection or caller-supplied IDs. */
export const readTransferTheme = async (ownerId: string | undefined, id: string, deps = defaults): Promise<TransferThing | null> => {
  const theme = (ownerId ? await deps.owned(ownerId, id) : null) || await deps.shared(id);
  if (!theme) return null;
  const folderId = await deps.folder?.(ownerId, id);
  return { id: theme.id, thingtime: ['theme'], crystal: { name: theme.name, theme: theme.theme as unknown as JsonValue }, ...(folderId ? { folderId } : {}) };
};

export const createTransferTheme = async (ownerId: string, thing: TransferThing, deps = defaults) => {
  validateTransferTheme(thing);
  return deps.save(ownerId, { name: thing.crystal.name, theme: thing.crystal.theme, visibility: 'private' });
};

export const removeTransferTheme = (ownerId: string, id: string) => defaults.remove(ownerId, id);
