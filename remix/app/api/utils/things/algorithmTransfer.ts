import { deleteAlgorithm, getOwnedAlgorithmTransfer, importAlgorithmTransfer } from '../algorithms/algorithms';
import { validateTransferAlgorithm } from '../../../utils/thingTransfer/algorithm';
export { isTransferAlgorithm, validateTransferAlgorithm } from '../../../utils/thingTransfer/algorithm';
import type { JsonValue, TransferThing } from '../../../utils/thingTransfer/format';
import { readManagedContentFolder } from './managedPlacement';

export const readTransferAlgorithm = async (ownerId: string | undefined, id: string): Promise<TransferThing | null> => {
  if (!ownerId) return null;
  const content = await getOwnedAlgorithmTransfer(ownerId, id);
  if (!content) return null;
  const folderId = await readManagedContentFolder(ownerId, id);
  return { id, thingtime: ['feed-algorithm'], crystal: content as unknown as Record<string, JsonValue>, ...(folderId ? { folderId } : {}) };
};

export const createTransferAlgorithm = (ownerId: string, thing: TransferThing) => {
  validateTransferAlgorithm(thing);
  return importAlgorithmTransfer(ownerId, thing.crystal);
};

export const removeTransferAlgorithm = (ownerId: string, id: string) => deleteAlgorithm(ownerId, id);
