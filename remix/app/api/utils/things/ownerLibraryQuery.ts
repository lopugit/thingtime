import { ATTACHMENT_THINGTIME } from '../attachments/attachmentCore';

// Protected kinds still cannot be created/edited through generic Thing CRUD.
// Saved themes, algorithms and completed standalone recordings also join the
// owner's content library; their dedicated writers still enforce mutations.
export const ownerLibraryMatch = (ownerId: string, excludedKinds: readonly string[], includeArchives = false) => ({
  ownerId,
  $or: [
    { thingtime: { $nin: [...excludedKinds] } },
    { thingtime: ['theme'] },
    { thingtime: ['feed-algorithm'] },
    { thingtime: ['custom-emoji'], targetId: null },
    ...(includeArchives ? [{ thingtime: ['chat-archive'], archiveVersion: 1, archiveDeleting: { $in: [null, false] },
      targetId: null, appId: null, sandbox: null, sandboxSpace: null,
      $expr: { $eq: ['$archiveRootId', '$shareId'] } }] : []),
    { thingtime: [ATTACHMENT_THINGTIME], attachmentPurpose: 'recording', attachmentState: 'ready', attachmentImportDraft: { $ne: true }, targetId: { $exists: false } }
  ]
});
