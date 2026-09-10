import { ACL_OWNER } from '~/schemas/registry';

const isOwnedPrivateSource = (source: any, ownerId: string) =>
	!!source && source.ownerId === ownerId && !source.appId && !source.deletedAt &&
	Array.isArray(source.acl) && source.acl.length === 1 && source.acl[0] === ACL_OWNER;

export const isPrivateRecordingPost = (source: any, ownerId: string) =>
	isOwnedPrivateSource(source, ownerId) && Array.isArray(source.thingtime) &&
	source.thingtime.includes('post') && !source.thingtime.includes('comment') &&
	Array.isArray(source.tags) && source.tags.includes('apple-watch') && /^watch-upload-/.test(source.shareId);

// Only canonical completed standalone recordings qualify. Draft, bound, linked,
// app-scoped and shared attachments must not become a second authorization path.
export const isPrivateSavedRecording = (source: any, ownerId: string) =>
	isOwnedPrivateSource(source, ownerId) && Array.isArray(source.thingtime) &&
	source.thingtime.length === 1 && source.thingtime[0] === 'attachment' &&
	source.attachmentPurpose === 'recording' && source.attachmentState === 'ready' &&
	source.targetId === undefined && !source.attachmentLinked &&
	source.crystal?.mediaKind === 'audio' && source.moderation?.status !== 'blocked';
