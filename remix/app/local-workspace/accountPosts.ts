import type { PublicPost, PostComment } from '../components/Feed/feedTypes';
import { snapshotTransferValue } from '../utils/thingTransfer/value';
import { interactionState, type InteractionState } from '../utils/interactionState';
import { searchLocalThings } from './structuredSearch';
import { WorkspaceError, workspaceScopeKey, type WorkspaceDatabase, type WorkspaceLease, type WorkspaceScope } from './storage';

const COLLECTION = 'account-post-projections';
type CachedPost = { post: PublicPost | null; at: number; deniedAt?: number };
const prunePost = (post: any, denied: (id: string) => boolean): any => ({
	...post,
	comments: (post.comments || []).filter((row: any) => !denied(row.id)).map((row: any) => prunePost(row, denied)),
	...('shareOf' in post ? { shareOf: post.shareOf && !denied(post.shareOf.id) ? prunePost(post.shareOf, denied) : null } : {}),
	...(post.linkedThings ? { linkedThings: post.linkedThings.map((row: any) => (denied(row.id) ? { ...row, thing: null } : row)) } : {})
});
const fields = [
	'id',
	'type',
	'thingtime',
	'acl',
	'visibility',
	'text',
	'richText',
	'images',
	'attachments',
	'attachmentsTruncated',
	'mediaLayout',
	'listing',
	'thing',
	'tags',
	'reactionCounts',
	'viewerReactions',
	'votes',
	'title',
	'subspace',
	'flair',
	'authorFlair',
	'subspaceMod',
	'commentCount',
	'repliesLoaded',
	'commentCounts',
	'shareCount',
	'isShare',
	'viewCount',
	'viewStats',
	'pollVotes',
	'viewerSaved',
	'extended',
	'feedFilterMatches',
	'createdAt',
	'targetId'
] as const;
const authorFields = ['id', 'username', 'displayName', 'temporary', 'avatarUrl', 'external', 'externalUrl'] as const;
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const pick = (value: Record<string, any>, keys: readonly string[]) =>
	Object.fromEntries(keys.filter((key) => value[key] !== undefined).map((key) => [key, value[key]]));
/** A retained server read is display data only. Never cache hidden-link bearer
 * keys, revealed values, or arbitrary server envelope fields as authority. */
export function accountPostProjection(input: unknown): PublicPost {
	let count = 0;
	const project = (raw: unknown, depth = 0): any => {
		if (
			!object(raw) ||
			typeof raw.id !== 'string' ||
			!raw.id ||
			raw.id.length > 200 ||
			typeof raw.text !== 'string' ||
			!Array.isArray(raw.thingtime) ||
			!raw.thingtime.includes('post') ||
			!Number.isFinite(Date.parse(raw.createdAt)) ||
			depth > 8 ||
			++count > 250
		)
			throw new WorkspaceError('INVALID_POST_CACHE', 'Invalid account post snapshot.', 502);
		const value = pick(raw, fields);
		value.attachments = Array.isArray(raw.attachments)
			? raw.attachments.map((file) => {
					if (!object(file)) throw new WorkspaceError('INVALID_POST_CACHE', 'Invalid attachment metadata.', 502);
					return pick(file, [
						'id',
						'name',
						'size',
						'contentType',
						'mediaKind',
						'filenamePreview',
						'title',
						'description',
						'detectedContentType',
						'nsfw',
						'url',
						'pending'
					]);
			  })
			: [];
		value.author = object(raw.author) ? pick(raw.author, authorFields) : null;
		value.comments = Array.isArray(raw.comments) ? raw.comments.map((child) => project(child, depth + 1)) : [];
		value.shareOf = raw.shareOf ? project(raw.shareOf, depth + 1) : null;
		// Stable file metadata retains the existing authenticated byte resolver.
		// Linked content never carries grants or hidden-link tokens from its envelope.
		if (Array.isArray(raw.linkedThings))
			value.linkedThings = raw.linkedThings.map((reference) => {
				if (!object(reference)) throw new WorkspaceError('INVALID_POST_CACHE', 'Invalid linked Thing snapshot.', 502);
				const linked = object(reference.thing)
					? pick(reference.thing, [
							'id',
							'thingtime',
							'crystal',
							'extended',
							'tags',
							'folderId',
							'targetId',
							'createdAt',
							'updatedAt',
							'acl',
							'visibility'
					  ])
					: null;
				if (linked) linked.author = object(reference.thing.author) ? pick(reference.thing.author, authorFields) : null;
				return { ...pick(reference, ['id', 'mode']), thing: linked };
			});
		return value;
	};
	return snapshotTransferValue(project(input)) as unknown as PublicPost;
}
export function overlayAccountPost<T extends PublicPost | PostComment>(post: T, states: ReadonlyMap<string, InteractionState>): T {
	const state = states.get(post.id);
	return {
		...post,
		...(state ? { viewerSaved: state.saved, viewerReactions: state.reactions, reactionCounts: state.reactionCounts || {} } : {}),
		comments: (post.comments || []).map((child) => overlayAccountPost(child, states)),
		...('shareOf' in post ? { shareOf: post.shareOf ? overlayAccountPost(post.shareOf, states) : null } : {})
	};
}
/** Account/origin/data-plane scoped read-only snapshots. They are never added
 * to owned Things, exported as owned content, or used to authorize a write. */
export class AccountPostCache {
	constructor(private db: WorkspaceDatabase, private scope: WorkspaceScope, private lease: WorkspaceLease) {
		if (scope.kind !== 'account') throw new WorkspaceError('ACCOUNT_REQUIRED', 'Account snapshots require their original workspace.', 403);
	}
	async remember(posts: unknown[], startedAt = Date.now()) {
		if (!Array.isArray(posts) || posts.length > 50 || !Number.isFinite(startedAt))
			throw new WorkspaceError('INVALID_POST_CACHE', 'Invalid post snapshot page.', 502);
		const values = posts.map(accountPostProjection);
		return this.db.transaction(this.scope, 'readwrite', this.lease, async (tx) => {
			let changed = false;
			const retained = new Map((await tx.list<CachedPost>(COLLECTION)).map((row) => [row.id, row.value]));
			const denied = (id: string) => (retained.get(id)?.deniedAt ?? -Infinity) >= startedAt;
			for (const value of values) {
				const old = retained.get(value.id);
				if ((old && old.at > startedAt) || denied(value.id)) continue;
				const post = prunePost(value, denied);
				if (old && JSON.stringify(old.post) === JSON.stringify(post)) {
					if (startedAt > old.at) await tx.put(COLLECTION, post.id, { ...old, at: startedAt });
					continue;
				}
				await tx.put(COLLECTION, post.id, { post, at: startedAt, ...(old?.deniedAt !== undefined ? { deniedAt: old.deniedAt } : {}) });
				changed = true;
			}
			return changed;
		});
	}
	async get(id: string) {
		return this.db.transaction(this.scope, 'readonly', this.lease, async (tx) => (await tx.get<{ post: PublicPost }>(COLLECTION, id))?.post || null);
	}
	async forget(id: string, at = Date.now()) {
		return this.db.transaction(this.scope, 'readwrite', this.lease, async (tx) => {
			let changed = false;
			const prior = await tx.get<CachedPost>(COLLECTION, id);
			// Keep a bounded, scoped refusal watermark even for a missing entry.
			// Requests already in flight cannot resurrect it or its nested copies.
			await tx.put(COLLECTION, id, { post: null, at: Math.max(at, prior?.at || 0), deniedAt: at });
			changed = !!prior?.post;
			for (const row of await tx.list<CachedPost>(COLLECTION)) {
				if (!row.value.post) continue;
				const post = prunePost(row.value.post, (target) => target === id);
				if (JSON.stringify(post) !== JSON.stringify(row.value.post)) {
					await tx.put(COLLECTION, row.id, { ...row.value, post });
					changed = true;
				}
			}
			return changed;
		});
	}
	async saved(states: InteractionState[], args: { cursor?: string; limit?: number } = {}) {
		const membership = new Map(
			states.map((state) => {
				const checked = interactionState(state);
				return [checked.id, checked] as const;
			})
		);
		const posts = await this.db.transaction(this.scope, 'readonly', this.lease, async (tx) =>
			(await tx.list<CachedPost>(COLLECTION))
				.map((row) => row.value.post)
				.filter((post): post is PublicPost => !!post && !!membership.get(post.id)?.saved)
		);
		const byId = new Map(posts.map((post) => [post.id, post]));
		const rows = posts.map((post) => ({
			id: post.id,
			thingtime: ['post'],
			crystal: { text: post.text },
			createdAt: membership.get(post.id)?.savedAt || post.createdAt,
			updatedAt: post.createdAt,
			revision: 0
		}));
		const page = await searchLocalThings(rows, { ...args, sort: 'newest' }, `${workspaceScopeKey(this.scope)}:saved-posts`);
		return {
			ok: true,
			posts: page.things.map((row) => overlayAccountPost(byId.get(row.id)!, membership)),
			nextCursor: page.nextCursor,
			incomplete: true,
			localWorkspace: true
		};
	}
}
