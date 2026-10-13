import { getHomeThingsCollection, ensureIndexes, withHomeMongoTransaction } from '../mongodb/collections';
import { insertAccountedThing, updateAccountedThing, HOME_ACCOUNTED_STORAGE_OPTIONS } from '../storage/accountedThings';
import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';
import { draftConflict, validateDraftContent, validDraftId, type AccountDraft, type DraftContent, DRAFT_SURFACES } from '~/drafts/draftCore';
import { chronoCursorClause, parseChronoCursor, getThing, withFriendIds, viewerOf } from '../things/things';
import { bindDraftAttachments, releaseDraftAttachments, draftAttachmentMetadata } from './media';
import { copySharedAttachment, deleteAttachment } from '../attachments/attachments';
import { postDraftFromPost, remapPostDraftAttachments } from '~/drafts/postDraft';

export class DraftError extends Error {
	constructor(public status: number, message: string) {
		super(message);
	}
}
const match = (ownerId: string, id?: string) => ({ ownerId, thingtime: 'draft', ...(id ? { shareId: id } : {}) });
const active = (doc: any) => doc && !doc.draftDeleted;
const project = (doc: any): AccountDraft => ({
	id: doc.shareId,
	...doc.crystal,
	mode: doc.draftMode,
	revision: doc.draftRevision,
	createdAt: new Date(doc.createdAt).toISOString(),
	updatedAt: new Date(doc.updatedAt).toISOString()
});
export async function getDraft(ownerId: string, id: string) {
	if (!validDraftId(id)) throw new DraftError(400, 'Invalid draft id');
	const doc = await (await getHomeThingsCollection()).findOne(match(ownerId, id));
	if (!active(doc)) throw new DraftError(404, 'Draft not found');
	return project(doc);
}
export async function listDrafts(ownerId: string, input: { context?: string | null; surface?: string | null; cursor?: string | null }) {
	if ((input.context && input.context.length > 300) || (input.surface && !DRAFT_SURFACES.includes(input.surface as any)))
		throw new DraftError(400, 'Invalid draft filter');
	const cursor = parseChronoCursor(input.cursor);
	const filter = {
		...match(ownerId),
		draftDeleted: { $ne: true },
		...(input.context ? { 'crystal.context': input.context } : {}),
		...(input.surface ? { 'crystal.surface': input.surface } : {}),
		...(cursor ? chronoCursorClause(cursor) : {})
	};
	const docs = await (await getHomeThingsCollection())
		.find(filter)
		.sort({ createdAt: -1, shareId: 1 })
		.limit(31)
		.project({ 'crystal.snapshot': 0, 'crystal.attachmentIds': 0 })
		.toArray();
	const page = docs.slice(0, 30),
		last = page[page.length - 1];
	return { drafts: page.map(project), nextCursor: docs.length > 30 && last ? `${new Date(last.createdAt).getTime()}_${last.shareId}` : null };
}
export async function saveDraft(
	ownerId: string,
	input: any,
	mode: 'draft' | 'template' = 'draft',
	source?: { kind: 'template' | 'post' | 'draft'; id: string }
) {
	if (!validDraftId(input?.id) || !validDraftId(input?.writeId)) throw new DraftError(400, 'A draft id and write id are required');
	let content: DraftContent;
	try {
		content = validateDraftContent(input.content);
	} catch (error) {
		throw new DraftError(400, (error as Error).message);
	}
	await ensureIndexes();
	const things = await getHomeThingsCollection();
	return withHomeMongoTransaction(async (session) => {
		const previous = await things.findOne({ shareId: input.id }, { session });
		if (previous && (previous.ownerId !== ownerId || previous.thingtime?.length !== 1 || previous.thingtime[0] !== 'draft'))
			throw new DraftError(404, 'Draft not found');
		if (previous?.draftDeleted) throw new DraftError(410, 'This draft was already discarded or published');
		if (previous && previous.draftMode !== mode) throw new DraftError(409, 'Templates are reusable; start a new draft to edit one');
		const decision = draftConflict(previous?.draftRevision ?? 0, input.revision, previous?.draftWriteId, input.writeId);
		if (decision === 'conflict') throw new DraftError(409, 'This draft changed elsewhere. Your local edits are still available.');
		if (decision === 'retry') return project(previous);
		const now = new Date();
		const doc = {
			...previous,
			shareId: input.id,
			ownerId,
			schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
			thingtime: ['draft'],
			acl: [ACL_OWNER],
			crystal: content,
			extended: null,
			tags: [],
			targetId: null,
			draftMode: mode,
			...(source ? { draftSource: source } : {}),
			draftRevision: (previous?.draftRevision ?? 0) + 1,
			draftWriteId: input.writeId,
			createdAt: previous?.createdAt ?? now,
			updatedAt: now
		};
		await bindDraftAttachments(ownerId, input.id, content.attachmentIds, session, content.surface === 'comment' ? 'comment' : 'post');
		await releaseDraftAttachments(ownerId, input.id, content.attachmentIds, session);
		if (previous) {
			const result = await updateAccountedThing(
				things,
				{ ...match(ownerId, input.id), draftRevision: previous.draftRevision },
				{ $set: { crystal: content, draftRevision: doc.draftRevision, draftWriteId: input.writeId, updatedAt: now } },
				{ session, ...HOME_ACCOUNTED_STORAGE_OPTIONS }
			);
			if (result.matchedCount !== 1) throw new DraftError(409, 'Draft changed while saving');
		} else await insertAccountedThing(things, doc, { session, ...HOME_ACCOUNTED_STORAGE_OPTIONS });
		return project(doc);
	});
}
export async function discardDraft(ownerId: string, id: string, revision: unknown) {
	if (!validDraftId(id)) throw new DraftError(400, 'Invalid draft id');
	const things = await getHomeThingsCollection();
	await withHomeMongoTransaction(async (session) => {
		const doc = await things.findOne(match(ownerId, id), { session });
		if (!doc) throw new DraftError(404, 'Draft not found');
		if (doc.draftDeleted) return;
		if (doc.draftRevision !== revision) throw new DraftError(409, 'Draft changed elsewhere; refresh before discarding');
		await releaseDraftAttachments(ownerId, id, [], session);
		// Keep an empty tombstone: delayed autosaves must never resurrect a posted draft.
		await updateAccountedThing(
			things,
			match(ownerId, id),
			{ $set: { crystal: {}, draftDeleted: true, draftRevision: doc.draftRevision + 1, updatedAt: new Date() } },
			{ session, ...HOME_ACCOUNTED_STORAGE_OPTIONS }
		);
	});
}
async function copyDraftMedia(
	ownerId: string,
	source: DraftContent,
	signal?: AbortSignal,
	viewer: Parameters<typeof copySharedAttachment>[0] = { id: ownerId }
) {
	const ids: string[] = [],
		replacements = new Map<string, string>();
	try {
		for (const id of source.attachmentIds) {
			const copied = await copySharedAttachment(viewer, id, signal, source.surface === 'comment' ? 'comment' : 'post');
			if (copied.ok === false) throw new DraftError(copied.status, copied.error);
			ids.push(copied.id);
			replacements.set(id, copied.id);
		}
		return { ...source, attachmentIds: ids, snapshot: remapPostDraftAttachments(source.snapshot, replacements) };
	} catch (error) {
		await Promise.allSettled(ids.map((id) => deleteAttachment(ownerId, { id })));
		throw error;
	}
}
export async function instantiateTemplate(ownerId: string, input: any, signal?: AbortSignal) {
	// Stable destination identity makes response-loss retries return the same copy.
	if (!validDraftId(input.id) || !validDraftId(input.sourceId)) throw new DraftError(400, 'Valid source and new draft ids are required');
	const existing = await (await getHomeThingsCollection()).findOne(match(ownerId, input.id));
	if (active(existing)) {
		if (existing.draftSource?.kind !== 'template' || existing.draftSource?.id !== input.sourceId)
			throw new DraftError(409, 'Draft id is already in use');
		return project(existing);
	}
	const source = await getDraft(ownerId, input.sourceId);
	if (source.mode !== 'template') throw new DraftError(400, 'Select a template');
	const content = await copyDraftMedia(ownerId, source, signal);
	try {
		return await saveDraft(ownerId, { id: input.id, writeId: input.id, revision: 0, content }, 'draft', { kind: 'template', id: input.sourceId });
	} catch (error) {
		await Promise.allSettled(content.attachmentIds.map((id) => deleteAttachment(ownerId, { id })));
		throw error;
	}
}
export async function templateFromPost(user: { id: string; username: string }, input: any, signal?: AbortSignal) {
	if (!validDraftId(input.id) || !validDraftId(input.postId) || (input.name !== undefined && typeof input.name !== 'string'))
		throw new DraftError(400, 'Valid template and post ids are required');
	const existing = await (await getHomeThingsCollection()).findOne(match(user.id, input.id));
	if (active(existing)) {
		if (existing.draftSource?.kind !== 'post' || existing.draftSource?.id !== input.postId)
			throw new DraftError(409, 'Template id is already in use');
		return project(existing);
	}
	const viewer = await withFriendIds(viewerOf(user));
	const result = await getThing(viewer, input.postId);
	if (!result.ok || !result.post) throw new DraftError(404, 'Post not found');
	const post = result.post;
	const content = await copyDraftMedia(
		user.id,
		{
			name: (input.name || post.title || post.text || 'Post template').slice(0, 160),
			surface: 'post',
			context: 'post:new:',
			snapshot: JSON.stringify(postDraftFromPost(post as any)),
			attachmentIds: (post.attachments || []).map((file) => file.id)
		},
		signal,
		viewer
	);
	try {
		return await saveDraft(user.id, { id: input.id, writeId: input.id, revision: 0, content }, 'template', { kind: 'post', id: input.postId });
	} catch (error) {
		await Promise.allSettled(content.attachmentIds.map((id) => deleteAttachment(user.id, { id })));
		throw error;
	}
}
export { draftAttachmentMetadata };

/** Preserve conflicting local edits as an independent draft, including its files. */
export async function recoverDraft(ownerId: string, input: any, signal?: AbortSignal) {
	if (!validDraftId(input.id) || !validDraftId(input.sourceId)) throw new DraftError(400, 'Valid draft ids are required');
	const things = await getHomeThingsCollection();
	const existing = await things.findOne(match(ownerId, input.id));
	if (active(existing)) {
		if (existing.draftSource?.kind !== 'draft' || existing.draftSource?.id !== input.sourceId)
			throw new DraftError(409, 'Draft id is already in use');
		return project(existing);
	}
	if (!(await things.findOne(match(ownerId, input.sourceId)))) throw new DraftError(404, 'Original draft not found');
	let checked: DraftContent;
	try {
		checked = validateDraftContent(input.content);
	} catch (error) {
		throw new DraftError(400, (error as Error).message);
	}
	const content = await copyDraftMedia(ownerId, checked, signal);
	try {
		return await saveDraft(ownerId, { id: input.id, writeId: input.id, revision: 0, content }, 'draft', { kind: 'draft', id: input.sourceId });
	} catch (error) {
		await Promise.allSettled(content.attachmentIds.map((id) => deleteAttachment(ownerId, { id })));
		throw error;
	}
}
