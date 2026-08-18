// Pure poll helpers shared by the vote util (things/vote.ts) and the read-path
// aggregation (things/things.ts). Kept dependency-free (no things.ts imports)
// so both sides can use them without an import cycle — the aclChainCore /
// quotaCore pattern.

// A poll is any thing whose crystal (or, for posts, crystal.thing) carries a
// string `question` plus an options array with at least 2 entries — the same
// structural match the client's PollRenderer uses, so what renders as a poll
// IS what can be voted on. Options may be plain strings or { label } records.
export const MIN_POLL_OPTIONS = 2;
// UI compose bound; votes accept any index inside the poll's real option list
// so structurally-authored polls (data things) with more options still work.
export const MAX_POLL_COMPOSER_OPTIONS = 6;

const pollOptionsOf = (record: unknown): unknown[] | null => {
	if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
	const candidate = record as Record<string, unknown>;
	if (typeof candidate.question !== 'string' || !candidate.question.trim()) return null;
	if (!Array.isArray(candidate.options) || candidate.options.length < MIN_POLL_OPTIONS) return null;
	return candidate.options;
};

export type PollShape = { question: string; optionCount: number };

// The poll shape of a crystal, or null when the thing is not a poll. Posts
// carry the poll under crystal.thing (type 'thingtime'); free-form data things
// may carry question/options at the crystal root.
export const pollShapeOfCrystal = (crystal: Record<string, unknown> | null | undefined): PollShape | null => {
	if (!crystal) return null;
	const options = pollOptionsOf(crystal.thing) ?? pollOptionsOf(crystal);
	if (!options) return null;
	const source = (pollOptionsOf(crystal.thing) ? (crystal.thing as Record<string, unknown>) : crystal) as Record<string, unknown>;
	return { question: String(source.question).trim(), optionCount: options.length };
};

// One vote per (poll, user), enforced structurally by the
// things_vote_key_unique partial index over crystal.voteKey.
export const voteKeyOf = (pollShareId: string, userId: string): string => `${pollShareId}~${userId}`;

export type PollVoteEntry = { userId: string; optionIndex: number };

// The public vote projection carried on poll posts and returned by the vote
// endpoint: per-option counts (index-aligned with the poll's options), the
// total, and the viewer's own option (null = hasn't voted).
export type PublicPollVotes = { counts: number[]; totalVotes: number; viewerVote: number | null };

// Tally a poll's vote entries into the public projection. Votes pointing past
// the current option list (the poll was edited after they landed) are ignored
// rather than crashing the projection.
export const tallyPollVotes = (optionCount: number, entries: readonly PollVoteEntry[], viewerId: string | null): PublicPollVotes => {
	const counts = new Array<number>(Math.max(0, optionCount)).fill(0);
	let totalVotes = 0;
	let viewerVote: number | null = null;
	for (const entry of entries) {
		if (!Number.isInteger(entry.optionIndex) || entry.optionIndex < 0 || entry.optionIndex >= counts.length) continue;
		counts[entry.optionIndex] += 1;
		totalVotes += 1;
		if (viewerId && entry.userId === viewerId) viewerVote = entry.optionIndex;
	}
	return { counts, totalVotes, viewerVote };
};
