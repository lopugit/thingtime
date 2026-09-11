import { ATTACHMENT_THINGTIME } from '../attachments/attachmentCore';

// Protected kinds still cannot be created/edited through generic Thing CRUD.
// Saved themes, algorithms and completed standalone recordings also join the
// owner's content library; their dedicated writers still enforce mutations.
export const ownerLibraryMatch = (ownerId: string, excludedKinds: readonly string[]) => ({
  ownerId,
  $or: [
    { thingtime: { $nin: [...excludedKinds] } },
    { thingtime: ['theme'] },
    { thingtime: ['feed-algorithm'] },
    { thingtime: [ATTACHMENT_THINGTIME], attachmentPurpose: 'recording', attachmentState: 'ready', attachmentImportDraft: { $ne: true }, targetId: { $exists: false } }
  ]
});
