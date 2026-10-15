import { localInteractionState } from './interactions';
import { toAttachmentPublicMetadata } from '../api/utils/attachments/attachmentCore';
import type { PublicPost } from '../components/Feed/feedTypes';
import { buildThingCreateRequestPayload } from '../hooks/thingsRequestPayload';
import { isLocalAttachment, type LocalAttachment } from './attachments';
import { localThingProjection, type LocalThing, type ThingWrite } from './things';

/** Same legacy-post -> canonical Thing mapping used by the ordinary create
 * transport. Schema validation and attachment binding happen in LocalThings. */
export function localPostInput(input: Record<string, unknown>): ThingWrite & { shareId?: string; attachmentIds?: unknown } {
 const payload = buildThingCreateRequestPayload(input);
 const crystal = Array.isArray(payload.thingtime) ? payload.crystal : Object.fromEntries(
  ['type', 'text', 'richText', 'images', 'listing', 'thing', 'mediaLayout', 'title', 'subspaceId', 'flairId'].filter(key => payload[key] !== undefined).map(key => [key, payload[key]])
 );
 return { thingtime: payload.thingtime || ['post'], crystal, tags: payload.tags, shareId: payload.shareId as string | undefined,
  attachmentIds: payload.attachmentIds, folderId: payload.folderId as string | undefined, targetId: payload.targetId as string | undefined };
}
export function localTargetIndex(all: LocalThing[]) {
 const indexed = new Map<string, LocalThing[]>();
 for (const child of all) if (child.targetId) { const list = indexed.get(child.targetId) || []; list.push(child); indexed.set(child.targetId, list); }
 return indexed;
}
/** Client projection only: local identity is a workspace label, never a server
 * author or ACL grant. The persisted/exported Thing remains canonical content. */
export function localPostProjection(row: LocalThing, all: LocalThing[], owner: string, includeComments = false, byTarget?: ReadonlyMap<string, LocalThing[]>): PublicPost & { localOnly: true; targetId: string | null; repliesLoaded?: false } {
 const { crystal } = row, base = localThingProjection(row, owner);
 byTarget ??= localTargetIndex(all);
 const related = byTarget.get(row.id) || [];
 const children = related.filter(child => child.thingtime.includes('comment')).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
 const attachments = related.filter(isLocalAttachment)
  .sort((a, b) => (a as LocalAttachment).localAttachment.order - (b as LocalAttachment).localAttachment.order)
  .flatMap(file => { const metadata = toAttachmentPublicMetadata(file.id, file.crystal); return metadata ? [metadata] : []; });
 return { ...localInteractionState(row, related, owner), id: row.id, thingtime: row.thingtime, author: base.author, acl: base.acl, visibility: 'private', localOnly: true,
  type: (crystal.type || 'text') as PublicPost['type'], text: String(crystal.text || ''), richText: (crystal.richText || null) as PublicPost['richText'],
  images: (crystal.images || []) as string[], attachments, mediaLayout: (crystal.mediaLayout || null) as PublicPost['mediaLayout'],
  listing: (crystal.listing || null) as PublicPost['listing'], thing: (crystal.thing || null) as PublicPost['thing'], tags: base.tags,
  title: typeof crystal.title === 'string' ? crystal.title : null, targetId: row.targetId || null, createdAt: row.createdAt,
  commentCount: children.length,
  comments: includeComments ? children.map(child => localPostProjection(child, all, owner, false, byTarget)) : [], ...(includeComments ? {} : { repliesLoaded: false as const }), shareCount: 0, isShare: false, shareOf: null } as PublicPost & { localOnly: true; targetId: string | null; repliesLoaded?: false };
}
