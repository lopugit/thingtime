import { attachmentStore } from '../attachments/attachmentStore';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import type { TransferThing } from '../../../utils/thingTransfer/format';

export const readTransferRecording = async (ownerId: string | undefined, id: string): Promise<TransferThing | null> => {
  if (!ownerId || isCustomMongoEndpointActive()) return null;
  const doc = await attachmentStore.getOwned(ownerId, id);
  if (!doc || doc.ownerId !== ownerId || doc.thingtime.length !== 1 || doc.thingtime[0] !== 'attachment' ||
    !['recording', 'file'].includes(doc.attachmentPurpose || '') || doc.attachmentImportDraft || doc.attachmentProfileSlot ||
    doc.attachmentState !== 'ready' || doc.targetId || doc.attachmentLinked) return null;
  // The planner replaces this temporary file ID after collecting all Things,
  // so the byte entry cannot collide with another portable Thing's ID.
  const folderId = (doc as typeof doc & { folderId?: string }).folderId;
  return { id, thingtime: ['attachment'], crystal: { recordingFileId: 'pending', ...(doc.attachmentPurpose === 'file' ? { filePurpose: 'file' } : {}) }, ...(folderId ? { folderId } : {}) };
};
