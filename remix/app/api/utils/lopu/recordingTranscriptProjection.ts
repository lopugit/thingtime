import { ACL_OWNER } from '~/schemas/registry';
import { isPrivateRecordingPost, isPrivateSavedRecording } from './recordingSources';

export const MAX_TRANSCRIPT_BATCH = 20;
export const parseTranscriptAttachmentIds = (value: string): string[] | null => {
	const ids = value.split(',');
	return ids.length > 0 && ids.length <= MAX_TRANSCRIPT_BATCH && ids.every((id) => /^[a-zA-Z0-9_-]{1,160}$/.test(id))
		? [...new Set(ids)] : null;
};

const privateOwned = (row: any, ownerId: string) => row?.ownerId === ownerId && !row.appId && !row.deletedAt &&
	Array.isArray(row.acl) && row.acl.length === 1 && row.acl[0] === ACL_OWNER;

export const canReadRecordingTranscript = (ownerId: string, attachment: any, parent: any) =>
	isPrivateSavedRecording(attachment, ownerId) || (
		privateOwned(attachment, ownerId) && attachment.thingtime?.includes('attachment') &&
		attachment.attachmentState === 'ready' && !attachment.attachmentLinked &&
		attachment.crystal?.mediaKind === 'audio' && attachment.moderation?.status !== 'blocked' &&
		attachment.targetId === parent?.shareId && isPrivateRecordingPost(parent, ownerId)
	);

// Use the worker's ordered, committed comment IDs, never a text-prefix search
// or its private inference scratch. Edits/deletion therefore take effect here.
export const projectRecordingTranscript = (ownerId: string, targetId: string, ids: string[], comments: Map<string, any>) => {
	if (!ids.length || ids.length > 100) return null;
	const parts: string[] = [];
	for (const id of ids) {
		const comment = comments.get(id);
		if (!privateOwned(comment, ownerId) || !comment.thingtime?.includes('comment') ||
			comment.targetId !== targetId || typeof comment.crystal?.text !== 'string') return null;
		parts.push(comment.crystal.text.replace(/^🦄 Lopu transcription(?: \(\d+\/\d+\))?\r?\n\r?\n/u, ''));
	}
	const text = parts.join('');
	return text.trim() && text.length <= 60_000 ? text : null;
};
