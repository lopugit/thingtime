import { randomUUID } from 'node:crypto';

import { getThingsCollection } from '../mongodb/collections';
import { thingUniqueKey, thingUniqueKeyFilter } from '../mongodb/uniqueKeys';
import { ACL_INHERIT, COLLECTION_SCHEMA_VERSIONS, UPDOWN_THINGTIME } from '~/schemas/registry';
import { assertSubspaceInteraction, UPDOWN_KEY_FIELD } from '../subspaces/gate';
import { emptyUpdownVotes, parseUpdownDirection, updownKeyOf, type PublicUpdownVotes, type UpdownDirection } from './updownCore';
import { asViewer, fail, findViewableThing, isPostThing, patSandboxOf, tokenAclEntryFor, tokenAclOf, type Fail, type ThingDoc, type Viewer } from './things';

// Up/down voting (see updownSchema in schemas/registry.ts): Reddit-style
// scoring as a SEPARATE focused reaction kind. One relational child thing per
// (user, target) — kind ['updown'], targetId = the post or comment, acl
// ['tt:inherit'] so a vote is visible exactly when its target is — deduped
// structurally through the root uniqueKeys namespace
// (`updownKey:<targetId>~<userId>`). Same direction again removes the vote;
// the other direction flips the existing doc in place; null clears. This
// util is the ONLY writer — the kind has no generic crystal sanitizer, so
// /api/v1/things refuses it. Native emoji reactions (toggleReaction) are a
// different kind and are never touched here.

export type CastUpdownResult = Fail | { ok: true; votes: PublicUpdownVotes; direction: UpdownDirection | null };

const isDuplicateKey = (err: unknown): boolean => (err as { code?: number } | null)?.code === 11000;

const isVotable = (target: ThingDoc): boolean => isPostThing(target) || (Array.isArray(target.thingtime) && target.thingtime.includes('comment'));

// Batched tally for a page/window of targets — ONE $group over the updown
// kind (never N+1), used by the subspace feed ranking.
export const updownTalliesFor = async (targetIds: readonly string[], viewerId: string | null): Promise<Map<string, PublicUpdownVotes>> => {
	const tallies = new Map<string, PublicUpdownVotes>();
	const wanted = [...new Set(targetIds.filter(Boolean))];
	if (!wanted.length) return tallies;
	const things = await getThingsCollection();
	const [rows, viewerDocs] = await Promise.all([
		things
			.aggregate([
				{ $match: { thingtime: UPDOWN_THINGTIME, targetId: { $in: wanted } } },
				{ $group: { _id: { target: '$targetId', direction: '$crystal.direction' }, count: { $sum: 1 } } }
			])
			.toArray() as Promise<any[]>,
		viewerId
			? (things
					.find({ thingtime: UPDOWN_THINGTIME, targetId: { $in: wanted }, ownerId: viewerId } as any)
					.project({ targetId: 1, 'crystal.direction': 1 })
					.toArray() as Promise<any[]>)
			: Promise.resolve([] as any[])
	]);
	for (const id of wanted) tallies.set(id, emptyUpdownVotes());
	for (const row of rows) {
		const tally = tallies.get(String(row._id?.target));
		if (!tally) continue;
		if (row._id?.direction === 'up') tally.up += Number(row.count) || 0;
		else if (row._id?.direction === 'down') tally.down += Number(row.count) || 0;
		tally.score = tally.up - tally.down;
	}
	for (const doc of viewerDocs) {
		const tally = tallies.get(String(doc.targetId));
		if (tally && (doc.crystal?.direction === 'up' || doc.crystal?.direction === 'down')) tally.viewerVote = doc.crystal.direction;
	}
	return tallies;
};

// Fresh authoritative tally for ONE target, through the same $group as the
// batched path. A popular post's vote rows are unbounded, so the tally must
// never be computed by loading every row into the process: one vote on a
// 100k-vote post would read 100k docs to answer with four numbers.
export const updownVotesOf = async (targetShareId: string, viewerId: string | null): Promise<PublicUpdownVotes> =>
	(await updownTalliesFor([targetShareId], viewerId)).get(targetShareId) || emptyUpdownVotes();

export const castUpdown = async (viewerInput: string | Viewer, shareId: unknown, directionRaw: unknown): Promise<CastUpdownResult> => {
	const viewer = asViewer(viewerInput);
	if (!viewer?.id) return fail(401, 'Unauthorized');
	const viewerId = viewer.id;

	const parsed = parseUpdownDirection(directionRaw);
	if (parsed.ok === false) return fail(400, parsed.error);
	const direction = parsed.direction;

	// visibility is re-checked on every vote — a URL-guessed private post can't
	// be voted on, and acl/inherit rules match every other interaction path
	const target = await findViewableThing(shareId, viewer);
	if (!target) return fail(404, 'Post not found');
	if (!isVotable(target)) return fail(400, 'You can only upvote or downvote posts and comments 🔼');

	// sandboxed tokens may only engage with things carrying their tt:token grant
	const sandboxTokenId = patSandboxOf(viewer);
	if (sandboxTokenId && !tokenAclOf(target).includes(tokenAclEntryFor(sandboxTokenId))) {
		return fail(403, 'This token is sandboxed — it can only touch things carrying its tt:token grant 🧸');
	}

	// subspace bans block voting on that subspace's posts and their comments
	const gate = await assertSubspaceInteraction(viewerId, target, 'vote', { roles: viewer.subspaceRoles });
	if (gate.ok === false) return gate;

	const things = await getThingsCollection();
	const key = updownKeyOf(target.shareId, viewerId);
	const keyFilter = thingUniqueKeyFilter(UPDOWN_KEY_FIELD, key);
	const now = new Date();
	const existing = (await things.findOne({ thingtime: UPDOWN_THINGTIME, ownerId: viewerId, ...keyFilter } as any)) as any as ThingDoc | null;

	if (!direction || (existing && existing.crystal?.direction === direction)) {
		// clear, or the same direction again → toggle the vote off (the react
		// util's opinion — tapping what you already did undoes it)
		if (existing) await things.deleteOne({ _id: (existing as any)._id } as any);
	} else if (existing) {
		// flip in place — direction is the only mutable field
		await things.updateOne({ _id: (existing as any)._id } as any, { $set: { 'crystal.direction': direction, updatedAt: now } });
	} else {
		try {
			await things.insertOne({
				shareId: randomUUID(),
				schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
				thingtime: [UPDOWN_THINGTIME],
				crystal: { direction, updownKey: key },
				uniqueKeys: [thingUniqueKey(UPDOWN_KEY_FIELD, key)],
				extended: null,
				ownerId: viewerId,
				acl: [ACL_INHERIT],
				targetId: target.shareId,
				tags: [],
				createdAt: now,
				updatedAt: now
			} as any);
		} catch (err) {
			if (!isDuplicateKey(err)) throw err;
			// raced our own double-tap — the unique key kept one doc; settle it
			const settled = await things.updateOne({ thingtime: UPDOWN_THINGTIME, ownerId: viewerId, ...keyFilter } as any, {
				$set: { 'crystal.direction': direction, updatedAt: now }
			});
			if (!settled.matchedCount) return fail(409, 'Your vote slot on this post is blocked — try again later');
		}
	}
	await things.updateOne({ shareId: target.shareId } as any, { $set: { updatedAt: now } });

	const votes = await updownVotesOf(target.shareId, viewerId);
	return { ok: true, votes, direction: votes.viewerVote };
};
