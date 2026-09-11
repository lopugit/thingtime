import { ATTACHMENT_THINGTIME } from '../attachments/attachmentCore';

// Protected kinds still cannot be created/edited through generic Thing CRUD.
// Only completed standalone recordings join the owner's content library.
export const ownerLibraryMatch = (ownerId: string, excludedKinds: readonly string[]) => ({
  ownerId,
  $or: [
    { thingtime: { $nin: [...excludedKinds] } },
    { thingtime: [ATTACHMENT_THINGTIME], attachmentPurpose: 'recording', attachmentState: 'ready', attachmentImportDraft: { $ne: true }, targetId: { $exists: false } }
  ]
});
