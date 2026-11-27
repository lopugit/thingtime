import type { PublicThing } from './things';
import { DEVICE_CONTROL_THINGTIME, MESSENGER_THINGTIME, PROTECTED_THINGTIME, SUBSPACE_THINGTIME } from '~/schemas/registry';
import { ownerLibraryMatch } from './ownerLibraryQuery';

// Dedicated writers protect these content kinds from generic edits. A library
// placement change does not edit their content or confer their read authority.
export const LIBRARY_ARCHIVE_PRESENTATION_KINDS = ['chat', 'chat-section', 'chat-message', 'community', 'subspace', 'mail-message', 'notification'] as const;
const contentKinds = new Set<string>(LIBRARY_ARCHIVE_PRESENTATION_KINDS);
const excludedKinds = [...new Set<string>([...PROTECTED_THINGTIME, ...MESSENGER_THINGTIME, ...SUBSPACE_THINGTIME,
  ...DEVICE_CONTROL_THINGTIME, 'reaction', 'save', 'vote', 'updown'])].filter(kind => !contentKinds.has(kind));

type LibraryDocument = {
  shareId: string; ownerId?: string; thingtime?: string[]; appId?: unknown; sandbox?: unknown; sandboxSpace?: unknown;
  targetId?: unknown; crystal?: Record<string, any>; creationCheckpoint?: { phase?: string }; moderation?: { status?: string };
  attachmentState?: string; attachmentExpiresAt?: unknown; attachmentImportDraft?: boolean;
  archiveVersion?: number; archiveDeleting?: boolean; archiveRootId?: string;
};
export const libraryArchiveMatch = (ownerId: string) => ({ $and: [
  { ownerId, $or: [ownerLibraryMatch(ownerId, excludedKinds, true),
    { thingtime: ['attachment'], attachmentState: 'ready', attachmentExpiresAt: null, attachmentImportDraft: { $ne: true } }] },
  { appId: null, sandbox: null, sandboxSpace: null, thingtime: { $exists: true },
    'moderation.status': { $ne: 'blocked' }, 'creationCheckpoint.phase': { $nin: ['planning', 'restoring'] } }
] });

export const eligibleLibraryArchive = (doc: LibraryDocument): boolean => {
  const kinds = doc.thingtime;
  if (!Array.isArray(kinds) || !kinds.length || doc.appId || doc.sandboxSpace || doc.sandbox ||
      doc.moderation?.status === 'blocked' || ['planning', 'restoring'].includes(doc.creationCheckpoint?.phase || '')) return false;
  if (!kinds.some(kind => excludedKinds.includes(kind))) return true;
  if (kinds.length !== 1) return false;
  switch (kinds[0]) {
    case 'theme': case 'feed-algorithm': return true;
    case 'file': return doc.crystal?.trashed === false;
    case 'custom-emoji': return doc.targetId == null;
    case 'chat-archive': return doc.archiveVersion === 1 && !doc.archiveDeleting && doc.targetId == null && doc.archiveRootId === doc.shareId;
    case 'attachment': return doc.attachmentState === 'ready' && doc.attachmentExpiresAt == null && doc.attachmentImportDraft !== true;
    default: return false;
  }
};

export const libraryArchiveNeedsMinimalPresentation = (doc: { thingtime?: string[] }) =>
  !!doc.thingtime?.some(kind => contentKinds.has(kind));
export const libraryArchiveTitle = (kinds: readonly string[]) => {
  if (kinds.includes('chat-message') || kinds.includes('mail-message')) return 'Archived message';
  if (kinds.includes('notification')) return 'Archived notification';
  if (kinds.includes('subspace')) return 'Archived subspace';
  if (kinds.includes('community')) return 'Archived community';
  if (kinds.includes('chat-section')) return 'Archived chat section';
  return 'Archived chat';
};

// Construct a fresh allowlisted card. Never spread the dedicated source
// projection, which may contain private bodies, participants or media bindings.
export const minimalLibraryArchivePresentation = (item: { id: string; thingtime: string[]; author: PublicThing['author']; createdAt: string; updatedAt: string }): PublicThing => ({
  id: item.id, thingtime: item.thingtime, author: item.author,
  visibility: 'private' as const, acl: ['tt:user'], targetId: null, folderId: null,
  libraryArchived: true as const, libraryArchiveEligible: true as const, libraryArchivePresentation: 'metadata' as const,
  crystal: { name: libraryArchiveTitle(item.thingtime) }, extended: null, geo: null, tags: [],
  createdAt: item.createdAt, updatedAt: item.updatedAt
});
