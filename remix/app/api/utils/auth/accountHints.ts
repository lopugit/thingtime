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

export type ResolvedAccountHints = {
	hints: AccountHint[];
	setCookies: string[];
	// Foreign *.thingtime.com origins whose pointers this deployment could not
	// resolve (different database) — the client federates: it asks each origin's
	// own /account-hints/resolve to vouch for its sessions. The user's browser
	// assembles the full picture; no deployment ever holds another's sessions.
	unresolvedOrigins: string[];
};

const toHintUser = (user: PublicUser): AccountHintUser => ({
	id: user.id,
	username: user.username,
	displayName: user.displayName ?? null,
	avatarUrl: user.avatarUrl ?? null
});

export const resolveAccountHints = async (request: Request): Promise<ResolvedAccountHints> => {
	const pointers = await parseAccountHintsCookie(request);
	if (!pointers.length) return { hints: [], setCookies: [], unresolvedOrigins: [] };

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
	const unresolvedOrigins: string[] = [];
	const markUnresolved = (pointer: AccountHintPointer) => {
		if (pointer.origin !== currentOrigin && !unresolvedOrigins.includes(pointer.origin)) {
			unresolvedOrigins.push(pointer.origin);
		}
	};
	let resolvedBudget = MAX_RESOLVED_ENTRIES;

	for (const pointer of pointers) {
		if (resolvedBudget <= 0) {
			// over-budget pointers are kept (not pruned) — just not resolved now
			livePointers.push(pointer);
			markUnresolved(pointer);
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
		if (!anyLive) markUnresolved(pointer);
	}

	const setCookies: string[] = [];
	if (livePointers.length !== pointers.length) {
		setCookies.push(await serializeAccountHintsCookie(request, livePointers));
	}

	const hints = [...hintsByUser.values()].sort((a, b) =>
		(b.origins[0]?.lastSeenAt || '').localeCompare(a.origins[0]?.lastSeenAt || '')
	);

	return { hints, setCookies, unresolvedOrigins };
};

// The federated half: resolve ONLY the pointers this deployment's own origin
// wrote, for a cross-origin caller (another *.thingtime.com deployment's page
// fetching with credentials — same-site, so the tt_hints cookie arrives).
// Read-only by design: no pruning, no Set-Cookie — a deployment never edits
// the shared cookie from a cross-origin response; retirement of its dead
// pointers happens on its own first-party visits.
export const resolveOwnOriginHints = async (request: Request): Promise<AccountHint[]> => {
	const pointers = await parseAccountHintsCookie(request);
	if (!pointers.length) return [];
	const currentOrigin = resolvePublicOrigin(request).origin;

	const hintsByUser = new Map<string, AccountHint>();
	let resolvedBudget = MAX_RESOLVED_ENTRIES;

	for (const pointer of pointers) {
		if (pointer.origin !== currentOrigin || resolvedBudget <= 0) continue;
		const entries = (await getLiveRosterEntries(pointer.rosterId)).slice(0, resolvedBudget);
		resolvedBudget -= entries.length;
		const resolved = await Promise.all(
			entries.map(async (entry) => ({ entry, user: await resolveSessionUser(entry.jti, entry.userId) }))
		);
		for (const { entry, user } of resolved) {
			if (!user || user.temporary) continue;
			const lastSeenAt = new Date(
				Math.max(new Date(entry.addedAt).getTime() || 0, pointer.seenAt * 1000)
			).toISOString();
			const existing = hintsByUser.get(user.id);
			if (existing) existing.origins.push({ origin: pointer.origin, lastSeenAt });
			else hintsByUser.set(user.id, { user: toHintUser(user), origins: [{ origin: pointer.origin, lastSeenAt }], alreadyHere: false });
		}
	}

	return [...hintsByUser.values()];
};
