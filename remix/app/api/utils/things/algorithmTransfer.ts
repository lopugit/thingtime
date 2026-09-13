import { deleteAlgorithm, getOwnedAlgorithmTransfer, importAlgorithmTransfer } from '../algorithms/algorithms';
import { parseAlgorithmTransfer } from '../algorithms/algorithmTransferCore';
import type { JsonValue, TransferThing } from '../../../utils/thingTransfer/format';
import { readManagedContentFolder } from './managedPlacement';

export const isTransferAlgorithm = (thing: Pick<TransferThing, 'thingtime'>): boolean =>
  thing.thingtime.length === 1 && thing.thingtime[0] === 'feed-algorithm';

export const readTransferAlgorithm = async (ownerId: string | undefined, id: string): Promise<TransferThing | null> => {
  if (!ownerId) return null;
  const content = await getOwnedAlgorithmTransfer(ownerId, id);
  if (!content) return null;
  const folderId = await readManagedContentFolder(ownerId, id);
  return { id, thingtime: ['feed-algorithm'], crystal: content as unknown as Record<string, JsonValue>, ...(folderId ? { folderId } : {}) };
};

export const validateTransferAlgorithm = (thing: TransferThing): void => {
  if (!isTransferAlgorithm(thing) || thing.targetId || thing.extended != null || thing.tags?.length) {
    throw new Error('Algorithm transfers cannot contain child relationships or extra Thing fields');
  }
  parseAlgorithmTransfer(thing.crystal);
};

export const createTransferAlgorithm = (ownerId: string, thing: TransferThing) => {
  validateTransferAlgorithm(thing);
  return importAlgorithmTransfer(ownerId, thing.crystal);
};

export const removeTransferAlgorithm = (ownerId: string, id: string) => deleteAlgorithm(ownerId, id);
