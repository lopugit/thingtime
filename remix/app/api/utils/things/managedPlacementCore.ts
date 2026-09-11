/** Owner-side organization only. This is not an input to generic Thing CRUD:
 * the dedicated writer must re-read both records and apply this patch with
 * a source-version fence in the same transaction. No content/ACL is copied. */
export type PlacementRecord = {
  shareId: string;
  ownerId: string;
  thingtime: string[];
  updatedAt: Date;
  folderId?: string | null;
  appId?: unknown;
  sandbox?: unknown;
  sandboxSpace?: unknown;
  targetId?: unknown;
  attachmentPurpose?: unknown;
  attachmentState?: unknown;
  attachmentImportDraft?: unknown;
  attachmentExpiresAt?: unknown;
  attachmentLinked?: unknown;
  attachmentProfileSlot?: unknown;
};

export const prepareManagedPlacement = (
  source: PlacementRecord, ownerId: string, folder: PlacementRecord | null,
  now = new Date()
): { folderId: string | null; updatedAt: Date } => {
  if (!ownerId || source.ownerId !== ownerId || source.thingtime.length !== 1 ||
    !['attachment', 'theme', 'feed-algorithm'].includes(source.thingtime[0]) ||
    source.appId != null || source.sandbox != null || source.sandboxSpace != null || source.targetId != null ||
    !(source.updatedAt instanceof Date) || !Number.isFinite(source.updatedAt.getTime()) ||
    !Number.isFinite(now.getTime())) {
    throw new Error('Only owned standalone managed content can be filed');
  }
  if (source.thingtime[0] === 'attachment' &&
    (source.attachmentPurpose !== 'recording' || source.attachmentState !== 'ready' ||
      source.attachmentImportDraft === true || source.attachmentExpiresAt != null ||
      source.attachmentLinked === true || source.attachmentProfileSlot != null)) {
    throw new Error('Only durable standalone recordings can be filed');
  }
  if (folder && (folder.ownerId !== ownerId || folder.shareId === source.shareId ||
    folder.thingtime.length !== 1 || folder.thingtime[0] !== 'folder' ||
    folder.appId != null || folder.sandbox != null || folder.sandboxSpace != null)) {
    throw new Error('Choose a folder in your own Thingtime library');
  }
  return { folderId: folder?.shareId ?? null, updatedAt: new Date(now) };
};
