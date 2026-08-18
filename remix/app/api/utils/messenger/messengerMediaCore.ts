import { createHash } from 'node:crypto';

const ownerScopedId = (domain: string, prefix: string, ownerId: string, requestId: string): string =>
	`${prefix}_${createHash('sha256').update(domain).update(ownerId).update('\0').update(requestId).digest('hex')}`;

export const messageIdForRequest = (ownerId: string, requestId: string): string =>
	ownerScopedId('thingtime-message-request-v1\0', 'msg', ownerId, requestId);

export const customEmojiIdForAttachment = (ownerId: string, attachmentId: string): string =>
	ownerScopedId('thingtime-custom-emoji-v1\0', 'emoji', ownerId, attachmentId);

export const normalizedMessengerRequestId = (value: unknown): string | null => {
	if (typeof value !== 'string' || value !== value.trim() || !value || value.length > 128) return null;
	return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) ? value : null;
};

export const exactStringSet = (left: readonly string[], right: readonly string[]): boolean => {
	const a = [...left].sort();
	const b = [...right].sort();
	return a.length === b.length && a.every((entry, index) => entry === b[index]);
};

export const matchesCommittedMessageRequest = (
	existing: {
		ownerId?: unknown;
		targetId?: unknown;
		crystal?: {
			text?: unknown;
			threadRootId?: unknown;
			replyToId?: unknown;
			deletedAt?: unknown;
		};
	} | null,
	expected: {
		ownerId: string;
		chatId: string;
		text: string;
		threadRootId: string | null;
		replyToId: string | null;
		attachmentIds: readonly string[];
	},
	committedAttachmentIds: readonly string[]
): boolean =>
	!!existing &&
	String(existing.ownerId) === expected.ownerId &&
	String(existing.targetId) === expected.chatId &&
	String(existing.crystal?.text || '') === expected.text &&
	(existing.crystal?.threadRootId ?? null) === expected.threadRootId &&
	(existing.crystal?.replyToId ?? null) === expected.replyToId &&
	!existing.crystal?.deletedAt &&
	exactStringSet(committedAttachmentIds, expected.attachmentIds);

export const matchesCommittedEmojiRequest = (
	existing: {
		ownerId?: unknown;
		targetId?: unknown;
		emojiAttachmentId?: unknown;
		crystal?: { name?: unknown };
	} | null,
	expected: { ownerId: string; communityId: string | null; name: string; attachmentId: string }
): boolean =>
	!!existing &&
	String(existing.ownerId) === expected.ownerId &&
	(existing.targetId ?? null) === expected.communityId &&
	existing.crystal?.name === expected.name &&
	existing.emojiAttachmentId === expected.attachmentId;
