import { createHash } from 'node:crypto';
import { getThingsCollection } from '../mongodb/collections';
import type { ThingDoc, Viewer } from './things';

export const FOUND_POST_KIND = 'post-discovery';
export const FOUND_POST_PREFIX = 'post-discovery-';
export const foundPostViewerId = (viewer: Viewer): string | null => (viewer && !viewer.pat ? viewer.id || viewer.anonymousId || null : null);
export const foundPostId = (viewerId: string, postId: string) =>
	`${FOUND_POST_PREFIX}${createHash('sha256')
		.update(JSON.stringify([viewerId, postId]))
		.digest('hex')}`;
export const foundPostDigest = (key: string) => createHash('sha256').update(key).digest('hex');
export const foundPostGrantMatches = (post: ThingDoc, digest: unknown): boolean =>
	!!post.thingtime?.includes('post') &&
	Array.isArray(post.acl) &&
	post.acl.includes('tt:hidden') &&
	typeof post.linkKey === 'string' &&
	!!post.linkKey &&
	typeof digest === 'string' &&
	digest === foundPostDigest(post.linkKey);

export const foundPostReceiptMatches = (receipt: ThingDoc | null, post: ThingDoc, viewerId: string): boolean =>
	!!receipt &&
	receipt.shareId === foundPostId(viewerId, post.shareId) &&
	receipt.ownerId === viewerId &&
	receipt.targetId === post.shareId &&
	receipt.thingtime?.includes(FOUND_POST_KIND) &&
	foundPostGrantMatches(post, receipt.crystal?.linkKeyDigest);

export const withFoundPostGrant = async (post: ThingDoc, viewer: Viewer, lookup: (id: string) => Promise<ThingDoc | null>): Promise<Viewer> => {
	const viewerId = foundPostViewerId(viewer);
	if (!viewerId || !post.thingtime?.includes('post') || !post.acl?.includes('tt:hidden')) return viewer;
	const receipt = await lookup(foundPostId(viewerId, post.shareId));
	if (!foundPostReceiptMatches(receipt, post, viewerId)) return viewer;
	return { id: '', ...viewer, foundPosts: new Map([...(viewer?.foundPosts || []), [post.shareId, foundPostDigest(post.linkKey!)]]) };
};

export const createFoundPostStore = (getCollection = getThingsCollection) => {
	// One private, protected relationship per account/post. Only a successfully
	// opened current permalink can stamp it; no bearer secret is stored or returned.
	const rememberFoundPost = async (viewer: Viewer, post: ThingDoc, ipAddress?: string): Promise<void> => {
		const viewerId = foundPostViewerId(viewer);
		if (
			!viewerId ||
			!viewer ||
			viewerId === post.ownerId ||
			!post.thingtime?.includes('post') ||
			!post.acl?.includes('tt:hidden') ||
			!post.linkKey ||
			(!viewer.linkKeys?.has(post.linkKey) && !viewer.linkThingIds?.has(post.shareId))
		)
			return;
		const collection = await getCollection();
		const shareId = foundPostId(viewerId, post.shareId),
			now = new Date();
		const linkKeyDigest = foundPostDigest(post.linkKey);
		// Read-mostly after first discovery: avoid turning ordinary revisits into writes.
		const current = await collection.findOne({ shareId } as any);
		if (foundPostReceiptMatches(current as any, post, viewerId)) return;
		const doc = {
			shareId,
			schemaVersion: 2,
			thingtime: [FOUND_POST_KIND],
			ownerId: viewerId,
			targetId: post.shareId,
			acl: ['tt:user'],
			tags: [],
			extended: null,
			storageClass: 'control',
			storageAccountingVersion: 1,
			sizeBytes: 0,
			createdAt: now
		};
		try {
			await collection.updateOne(
				{ shareId, ownerId: viewerId, thingtime: FOUND_POST_KIND } as any,
				{
					$setOnInsert: doc,
					$set: {
						crystal: {
							authorId: post.ownerId,
							linkKeyDigest,
							...(viewer.anonymousId ? { anonymousId: viewer.anonymousId } : {}),
							...(ipAddress ? { ipAddress } : {})
						},
						updatedAt: now
					}
				} as any,
				{ upsert: true }
			);
		} catch (error: any) {
			// A concurrent first visit can win the unique shareId insert. Re-read its
			// exact receipt; never treat a collision with some other record as success.
			if (error?.code !== 11000 || !foundPostReceiptMatches((await collection.findOne({ shareId } as any)) as any, post, viewerId)) throw error;
		}
	};

	const loadFoundPostsForAuthor = async (viewerId: string, authorId: string): Promise<ReadonlyMap<string, string>> => {
		const collection = await getCollection();
		const receipts = await collection
			.find({ ownerId: viewerId, thingtime: FOUND_POST_KIND, 'crystal.authorId': authorId } as any, {
				projection: { shareId: 1, ownerId: 1, targetId: 1, thingtime: 1, crystal: 1 }
			})
			.toArray();
		if (!receipts.length) return new Map();
		const byTarget = new Map(receipts.map((receipt) => [receipt.targetId, receipt]));
		// Batch revalidate the current link generation; retired/rotated links and
		// deleted posts never remain in profile candidates or their count.
		const posts = await collection
			.find({ ownerId: authorId, shareId: { $in: [...byTarget.keys()] }, thingtime: 'post', acl: 'tt:hidden' } as any, {
				projection: { shareId: 1, ownerId: 1, thingtime: 1, acl: 1, linkKey: 1 }
			})
			.toArray();
		return new Map(
			posts
				.filter((post) => foundPostReceiptMatches(byTarget.get(post.shareId) as any, post as any, viewerId))
				.map((post) => [post.shareId, foundPostDigest(post.linkKey!)])
		);
	};

	return { rememberFoundPost, loadFoundPostsForAuthor };
};
export const { rememberFoundPost, loadFoundPostsForAuthor } = createFoundPostStore();
