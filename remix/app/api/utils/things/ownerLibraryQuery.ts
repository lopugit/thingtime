import { ATTACHMENT_THINGTIME } from '../attachments/attachmentCore';

// Protected kinds still cannot be created/edited through generic Thing CRUD.
// Saved themes, algorithms and completed standalone recordings also join the
// owner's content library; their dedicated writers still enforce mutations.
export const ownerLibraryMatch = (ownerId: string, excludedKinds: readonly string[], includeArchives = false, requiredKinds?: readonly string[]) => {
  const ordinary = { thingtime: { $nin: [...excludedKinds] } };
  const managed = [
    { thingtime: ['theme'] },
    { thingtime: ['file'], 'crystal.trashed': false },
    { thingtime: ['feed-algorithm'] },
    { thingtime: ['custom-emoji'], targetId: null },
    ...(includeArchives ? [{ thingtime: ['chat-archive'], archiveVersion: 1, archiveDeleting: { $in: [null, false] },
      targetId: null, appId: null, sandbox: null, sandboxSpace: null,
      $expr: { $eq: ['$archiveRootId', '$shareId'] } }] : []),
    { thingtime: [ATTACHMENT_THINGTIME], attachmentPurpose: { $in: ['recording', 'file'] }, attachmentState: 'ready', attachmentExpiresAt: null, attachmentImportDraft: { $ne: true }, targetId: { $exists: false } }
  ];
  // The caller still applies its required-kind predicate. A managed exception
  // with an exact singleton kind cannot satisfy an unrelated required kind.
  // Pruning those impossible OR branches avoids repeated Mongo plan exploration;
  // keep the ordinary mixed-kind exclusion and every remaining exception guard.
  const possible = requiredKinds?.length ? managed.filter(branch => branch.thingtime.some(kind => requiredKinds.includes(kind))) : managed;
  return possible.length ? { ownerId, $or: [ordinary, ...possible] } : { ownerId, ...ordinary };
};

/** Root containment is structural; explicit folders and searches retain scope. */
export const ownerLibraryRootMatch = () => ({
  folderId: { $in: [null] }, parentId: { $in: [null] }, targetId: { $in: [null] }, 'crystal.parentId': { $in: [null] },
  thingtime: { $nin: ['file-sync', ATTACHMENT_THINGTIME] }
});
