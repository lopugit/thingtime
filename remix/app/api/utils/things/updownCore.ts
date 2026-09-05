// Pure up/down vote helpers shared by the updown util (things/updown.ts), the
// read-path aggregation (things/things.ts) and the subspace feed ranking
// (subspaces/subspaces.ts). Dependency-free (no things.ts imports) so every
// side can use them without an import cycle — the pollCore pattern.
//
// Up/down votes are a SEPARATE, deliberately limited reaction kind: exactly
// one of 'up' | 'down' per (user, target). They never touch the open-vocabulary
// emoji reactions, which keep their multi-token semantics untouched.

export type UpdownDirection = 'up' | 'down';

// One vote per (target, user), enforced structurally through the root
// uniqueKeys namespace (`updownKey:<targetId>~<userId>`).
export const updownKeyOf = (targetShareId: string, userId: string): string => `${targetShareId}~${userId}`;

export type UpdownEntry = { userId: string; direction: UpdownDirection };

// The public projection carried on posts and comments and returned by the
// updown endpoint: raw up/down counts, the net score, and the viewer's own
// vote (null = hasn't voted).
export type PublicUpdownVotes = { up: number; down: number; score: number; viewerVote: UpdownDirection | null };

export const emptyUpdownVotes = (): PublicUpdownVotes => ({ up: 0, down: 0, score: 0, viewerVote: null });

export const isUpdownDirection = (value: unknown): value is UpdownDirection => value === 'up' || value === 'down';

// Body parsing for the endpoint: 'up' | 'down' vote, null/'none'/'' clears.
export const parseUpdownDirection = (value: unknown): { ok: true; direction: UpdownDirection | null } | { ok: false; error: string } => {
	if (value === null || value === undefined || value === '' || value === 'none' || value === 'clear') return { ok: true, direction: null };
	if (isUpdownDirection(value)) return { ok: true, direction: value };
	return { ok: false, error: 'direction must be "up", "down", or null to clear your vote' };
};

// Tally a target's vote entries. Malformed directions (a doc edited outside
// the endpoint) are ignored rather than crashing the projection.
export const tallyUpdown = (entries: readonly UpdownEntry[], viewerId: string | null): PublicUpdownVotes => {
	const votes = emptyUpdownVotes();
	for (const entry of entries) {
		if (!isUpdownDirection(entry.direction)) continue;
		if (entry.direction === 'up') votes.up += 1;
		else votes.down += 1;
		if (viewerId && entry.userId === viewerId) votes.viewerVote = entry.direction;
	}
	votes.score = votes.up - votes.down;
	return votes;
};

// ---------------------------------------------------------------------------
// Ranking math for subspace feeds — Reddit's classic formulas, kept pure so
// the sort orders are unit-testable and deterministic for a fixed dataset +
// timestamp (the same promise the ranked home feed makes).

// Reddit's hot epoch (2005-12-08 07:46:43 UTC). Only the RELATIVE value
// matters; the constant keeps numbers in a familiar range.
export const HOT_EPOCH_MS = Date.UTC(2005, 11, 8, 7, 46, 43);
const HOT_HALF_LIFE_SECONDS = 45000; // ~12.5h per order of magnitude of score

export const hotScore = (score: number, createdAtMs: number, epochMs: number = HOT_EPOCH_MS): number => {
	const order = Math.log10(Math.max(Math.abs(score), 1));
	const sign = score > 0 ? 1 : score < 0 ? -1 : 0;
	const seconds = (createdAtMs - epochMs) / 1000;
	return sign * order + seconds / HOT_HALF_LIFE_SECONDS;
};

// Reddit's controversy: needs BOTH ups and downs; magnitude to the power of
// the up/down balance (1 = perfectly split).
export const controversyScore = (up: number, down: number): number => {
	if (up <= 0 || down <= 0) return 0;
	const magnitude = up + down;
	const balance = up > down ? down / up : up / down;
	return Math.pow(magnitude, balance);
};

// Rising: recent posts gaining score fast — Hacker-News-style gravity over
// the post's age in hours. Only non-negative score counts (a sinking post
// never "rises"), +1 so brand-new posts with no votes still order by age.
export const risingScore = (score: number, createdAtMs: number, nowMs: number): number => {
	const ageHours = Math.max(0, (nowMs - createdAtMs) / 3_600_000);
	return (Math.max(score, 0) + 1) / Math.pow(ageHours + 2, 1.5);
};
