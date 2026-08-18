export type PostAttachmentRequest =
	| { ok: true; present: false }
	| { ok: true; present: true; attachmentIds: readonly unknown[] }
	| { ok: false; status: 400; error: string };

const hasOwn = (value: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(value, key);

// `attachmentIds` is a server feature flag on the generic things body, not a
// generic Thing field. This helper deliberately covers only generic/legacy
// post creation; the dedicated comment and Messenger routes apply their own
// purpose-bound attachment contracts. Shares, upserts and updates stay closed.
export const postAttachmentRequest = (method: string, body: unknown, isUnified: boolean): PostAttachmentRequest => {
	if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: true, present: false };
	const input = body as Record<string, unknown>;
	if (!hasOwn(input, 'attachmentIds')) return { ok: true, present: false };

	if (method.toUpperCase() !== 'POST') {
		return { ok: false, status: 400, error: 'Attachments may only be added when creating a post' };
	}
	if (!Array.isArray(input.attachmentIds)) {
		return { ok: false, status: 400, error: 'attachmentIds must be a list' };
	}
	if (isUnified) {
		const thingtime = input.thingtime;
		const topLevelPost =
			Array.isArray(thingtime) && thingtime.length === 1 && thingtime[0] === 'post' && (input.targetId === undefined || input.targetId === null);
		if (!topLevelPost) {
			return { ok: false, status: 400, error: 'Attachments are available only on top-level posts' };
		}
	}
	return { ok: true, present: true, attachmentIds: input.attachmentIds };
};

export const bodyHasAttachmentIds = (body: unknown): boolean =>
	!!body && typeof body === 'object' && !Array.isArray(body) && Object.prototype.hasOwnProperty.call(body, 'attachmentIds');

export const attachmentPostActorAllowed = (actorKind: string, accountKind: string): boolean => actorKind === 'user' && accountKind === 'user';

export const postBodyWithoutAttachmentIds = (body: Record<string, unknown>): Record<string, unknown> => {
	const result = { ...body };
	delete result.attachmentIds;
	return result;
};
