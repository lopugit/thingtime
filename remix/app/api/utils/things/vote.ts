import { randomUUID } from 'node:crypto';

import { getThingsCollection } from '../mongodb/collections';
import { relationshipUniqueKeys } from '../messenger/shared';
import { ACL_INHERIT, COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';
import { pollShapeOfCrystal, tallyPollVotes, voteKeyOf, type PollVoteEntry, type PublicPollVotes } from './pollCore';
import { asViewer, fail, findViewableThing, patSandboxOf, tokenAclEntryFor, tokenAclOf, type Fail, type ThingDoc, type Viewer } from './things';

// Poll voting (see voteSchema in schemas/registry.ts): one relational child
// thing per (user, poll) — kind ['vote'], targetId = the poll thing, acl
// ['tt:inherit'] so a vote is visible exactly when its poll is. Deduped
// structurally by the Binary voteKey entry in the shared uniqueKeys index.
// Semantics (matching the react util's toggle opinion): voting the SAME option
// again removes the vote; voting a DIFFERENT option updates the existing doc
// in place. This util is the ONLY writer — the vote kind has no generic
// crystal sanitizer, so /api/v1/things refuses it (a client-supplied voteKey
// could squat another user's slot or escape the dedupe entirely).

export type VoteOnThingResult = Fail | { ok: true; pollVotes: PublicPollVotes };

const isDuplicateKey = (err: unknown): boolean => (err as { code?: number } | null)?.code === 11000;

export const voteOnThing = async (viewerInput: string | Viewer, shareId: unknown, optionIndexRaw: unknown): Promise<VoteOnThingResult> => {
	const viewer = asViewer(viewerInput);
	if (!viewer?.id) return fail(401, 'Unauthorized');
	const viewerId = viewer.id;

	// visibility is re-checked on every vote — a URL-guessed private poll can't
	// be voted on, and acl/inherit rules match every other interaction path
	const target = await findViewableThing(shareId, viewer);
	if (!target) return fail(404, 'Poll not found');

	const poll = pollShapeOfCrystal((target.crystal as Record<string, unknown>) || null);
	if (!poll) return fail(400, 'That thing is not a poll 🗳️');

	const optionIndex = Number(optionIndexRaw);
	if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= poll.optionCount) {
		return fail(400, `optionIndex must be an integer between 0 and ${poll.optionCount - 1}`);
	}

	// sandboxed tokens may only engage with things carrying their tt:token grant
	const sandboxTokenId = patSandboxOf(viewer);
	if (sandboxTokenId && !tokenAclOf(target).includes(tokenAclEntryFor(sandboxTokenId))) {
		return fail(403, 'This token is sandboxed — it can only touch things carrying its tt:token grant 🧸');
	}

	const things = await getThingsCollection();
	const voteKey = voteKeyOf(target.shareId, viewerId);
	const uniqueKeys = relationshipUniqueKeys('vote', { voteKey })!;
	const now = new Date();
	// Keep the indexed crystal reader for pre-backfill and custom databases.
	// The shared key enforces uniqueness; it is not a readiness claim for old rows.
	const voteFilter = { thingtime: 'vote', 'crystal.voteKey': voteKey, ownerId: viewerId, targetId: target.shareId };
	const existing = (await things.findOne(voteFilter as any)) as any as ThingDoc | null;

	try {
		if (existing && Number(existing.crystal?.optionIndex) === optionIndex) {
			// same option again → toggle the vote off (the react util's opinion)
			await things.deleteOne({ ...voteFilter, _id: (existing as any)._id });
		} else if (existing) {
			// re-vote → update in place (optionIndex is the only mutable field)
			await things.updateOne(
				{ ...voteFilter, _id: (existing as any)._id },
				{
					$set: { 'crystal.optionIndex': optionIndex, updatedAt: now },
					$addToSet: { uniqueKeys: { $each: uniqueKeys } }
				}
			);
		} else {
			try {
				await things.insertOne({
					shareId: randomUUID(),
					schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
					thingtime: ['vote'],
					crystal: { optionIndex, voteKey },
					uniqueKeys,
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
				// raced our own double-tap — the shared uniqueKeys index kept one doc;
				// settle it on the requested option
				const settled = await things.updateOne(voteFilter, {
					$set: { 'crystal.optionIndex': optionIndex, updatedAt: now },
					$addToSet: { uniqueKeys: { $each: uniqueKeys } }
				});
				// A concurrent toggle can remove the winner before this update, or
				// a conflicting legacy identity can hold the protected slot. Do not
				// claim success when the requested option could not be written.
				if (!settled.matchedCount) return fail(409, 'Your vote changed concurrently or needs reconciliation — please retry');
			}
		}
	} catch (error) {
		// Existing duplicate legacy rows must be reconciled explicitly; never
		// select or delete a winner merely to make a unique-key backfill pass.
		if (isDuplicateKey(error)) return fail(409, 'Your vote slot needs reconciliation — try again later');
		throw error;
	}
	await things.updateOne({ shareId: target.shareId } as any, { $set: { updatedAt: now } });

	// fresh authoritative tally for this poll — one query, same shape the feed
	// projection carries (pollVotes), so the card can reconcile in place
	const voteDocs = (await things
		.find({ targetId: target.shareId, thingtime: 'vote' } as any)
		.project({ 'crystal.optionIndex': 1, ownerId: 1 })
		.toArray()) as any[];
	const entries: PollVoteEntry[] = voteDocs.map((doc) => ({ userId: String(doc.ownerId), optionIndex: Number(doc.crystal?.optionIndex) }));
	return { ok: true, pollVotes: tallyPollVotes(poll.optionCount, entries, viewerId) };
};
