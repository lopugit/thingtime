import { getLiveRosterEntries, resolveRoster } from './accounts';
import {
	parseAccountHintsCookie,
	serializeAccountHintsCookie,
	type AccountHintPointer
} from './accountHintsCookie';
import { resolveSessionUser } from './getCurrentUser';
import { resolvePublicOrigin } from './publicOrigin';
import type { PublicUser } from './users';

// Resolve the tt_hints pointers into live account suggestions. Everything is
// re-verified through the same chokepoints the account switcher uses —
// getLiveRosterEntries + resolveSessionUser — so a suggestion exists exactly
// while its session on the other deployment is live: log out there and it
// vanishes here. Dead pointers (roster reaped, every session revoked) are
// pruned and the cookie rewritten.

const MAX_RESOLVED_ENTRIES = 24;

// Deliberately slimmer than PublicUser: hints render a "continue as" list for
// a browser that is NOT signed in here, so only what the list paints ships —
// no email, no storage, no settings surface.
export type AccountHintUser = {
	id: string;
	username: string;
	displayName: string | null;
	avatarUrl: string | null;
};

export type AccountHint = {
	user: AccountHintUser;
	// Deployments this browser has a live session for this account on,
	// newest sign-in first.
	origins: Array<{ origin: string; lastSeenAt: string }>;
	// Already in THIS origin's switcher roster (only possible while signed in
	// here) — the popup skips these.
	alreadyHere: boolean;
};

export type ResolvedAccountHints = { hints: AccountHint[]; setCookies: string[] };

const toHintUser = (user: PublicUser): AccountHintUser => ({
	id: user.id,
	username: user.username,
	displayName: user.displayName ?? null,
	avatarUrl: user.avatarUrl ?? null
});

export const resolveAccountHints = async (request: Request): Promise<ResolvedAccountHints> => {
	const pointers = await parseAccountHintsCookie(request);
	if (!pointers.length) return { hints: [], setCookies: [] };

	// Local roster (empty when signed out — the popup's usual state).
	const localRoster = await resolveRoster(request);
	const localUserIds = new Set(localRoster.accounts.map((account) => account.userId));

	// Per-environment authority: this deployment may PRUNE only pointers its
	// own origin wrote. A pointer from another *.thingtime.com deployment that
	// doesn't resolve here is indistinguishable between "session ended" and
	// "that environment runs a different database" (branch-scoped DBs), so it
	// is kept — not displayed (only verified-live accounts ever render), just
	// left for its own deployment to vouch for or retire. The cookie's
	// newest-first cap keeps genuinely dead foreign pointers from accumulating.
	const currentOrigin = resolvePublicOrigin(request).origin;

	const livePointers: AccountHintPointer[] = [];
	const hintsByUser = new Map<string, AccountHint>();
	let resolvedBudget = MAX_RESOLVED_ENTRIES;

	for (const pointer of pointers) {
		if (resolvedBudget <= 0) {
			// over-budget pointers are kept (not pruned) — just not resolved now
			livePointers.push(pointer);
			continue;
		}
		const entries = (await getLiveRosterEntries(pointer.rosterId)).slice(0, resolvedBudget);
		resolvedBudget -= entries.length;

		const resolved = await Promise.all(
			entries.map(async (entry) => ({ entry, user: await resolveSessionUser(entry.jti, entry.userId) }))
		);

		let anyLive = false;
		for (const { entry, user } of resolved) {
			if (!user) continue;
			// temporary scratch accounts are per-origin and passwordless — a
			// cross-deployment "continue as" could never complete for them
			if (user.temporary) continue;
			anyLive = true;
			const lastSeenAt = new Date(
				Math.max(new Date(entry.addedAt).getTime() || 0, pointer.seenAt * 1000)
			).toISOString();
			const existing = hintsByUser.get(user.id);
			if (existing) {
				existing.origins.push({ origin: pointer.origin, lastSeenAt });
			} else {
				hintsByUser.set(user.id, {
					user: toHintUser(user),
					origins: [{ origin: pointer.origin, lastSeenAt }],
					alreadyHere: localUserIds.has(user.id)
				});
			}
		}
		if (anyLive || pointer.origin !== currentOrigin) livePointers.push(pointer);
	}

	const setCookies: string[] = [];
	if (livePointers.length !== pointers.length) {
		setCookies.push(await serializeAccountHintsCookie(request, livePointers));
	}

	const hints = [...hintsByUser.values()].sort((a, b) =>
		(b.origins[0]?.lastSeenAt || '').localeCompare(a.origins[0]?.lastSeenAt || '')
	);

	return { hints, setCookies };
};
