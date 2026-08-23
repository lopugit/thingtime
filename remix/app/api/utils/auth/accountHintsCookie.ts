import { createCookie } from '~/api/cookies';

import { resolvePublicOrigin } from './publicOrigin';

// Cross-deployment auto-login hints. Every successful sign-in appends this
// browser's { rosterId, origin } pointer to a cookie scoped to the REGISTRABLE
// domain (`Domain=.thingtime.com`), so any *.thingtime.com deployment —
// production, dev, previews — can see which OTHER deployments this browser is
// signed in on and offer those accounts on its own login screen.
//
// The cookie carries POINTERS ONLY, never identities or credentials: the
// account list is resolved live server-side (accountHints.ts) through the same
// rosters + resolveSessionUser path as the account switcher, so a hint exists
// exactly while its session is live, and logging out elsewhere makes the
// suggestion disappear here. Selecting a suggestion still requires that
// account's password or passkey — a hint never mints a session.
//
// This deliberately does NOT weaken the roster ownership gate (accounts.ts):
// hint pointers are readable without owning the roster, but they only ever
// yield public profile hints (username/avatar), never jtis, tokens, or a way
// to fold a foreign session into the local roster. A planted pointer (cookie
// fixation requires running code on a *.thingtime.com host) could only make
// the ATTACKER's accounts appear as suggestions — which still demand the
// attacker's credentials to use.
//
// On non-thingtime hosts (localhost, custom domains) the cookie stays
// host-only: localhost dev still shares hints across worktree ports (cookies
// ignore ports), everything else degrades to per-origin hints.

const MAX_HINT_POINTERS = 8;
const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30;

const hintsCookie = createCookie('tt_hints', {
	httpOnly: true,
	secure: process.env.NODE_ENV === 'production',
	sameSite: 'lax',
	path: '/',
	maxAge: THIRTY_DAYS_SECONDS
});

export type AccountHintPointer = {
	rosterId: string;
	origin: string;
	// epoch seconds of the last sign-in that refreshed this pointer
	seenAt: number;
};

// Compact on-the-wire shape (cookie budget): { r, o, t }.
type WirePointer = { r: string; o: string; t: number };

export const hintCookieDomainForRequest = (request: Request): string | undefined => {
	const hostname = resolvePublicOrigin(request).hostname;
	if (hostname === 'thingtime.com' || hostname.endsWith('.thingtime.com')) return '.thingtime.com';
	return undefined;
};

const isValidOrigin = (value: unknown): value is string => {
	if (typeof value !== 'string' || !value || value.length > 128) return false;
	try {
		return new URL(value).origin === value;
	} catch {
		return false;
	}
};

// Tampered/unknown shapes collapse to [] — never throw.
export const parseAccountHintsCookie = async (request: Request): Promise<AccountHintPointer[]> => {
	const value = await hintsCookie.parse(request.headers.get('Cookie'));
	if (!Array.isArray(value)) return [];
	const pointers: AccountHintPointer[] = [];
	for (const entry of value.slice(0, MAX_HINT_POINTERS)) {
		const wire = entry as WirePointer;
		if (typeof wire?.r !== 'string' || !wire.r || wire.r.length > 64) continue;
		if (!isValidOrigin(wire?.o)) continue;
		const seenAt = Number(wire?.t);
		if (!Number.isFinite(seenAt) || seenAt <= 0) continue;
		pointers.push({ rosterId: wire.r, origin: wire.o, seenAt: Math.floor(seenAt) });
	}
	return pointers;
};

export const serializeAccountHintsCookie = async (request: Request, pointers: AccountHintPointer[]): Promise<string> => {
	const domain = hintCookieDomainForRequest(request);
	if (!pointers.length) return hintsCookie.serialize('', { maxAge: 0, ...(domain ? { domain } : {}) });
	const wire: WirePointer[] = pointers
		.slice(0, MAX_HINT_POINTERS)
		.map(({ rosterId, origin, seenAt }) => ({ r: rosterId, o: origin, t: seenAt }));
	return hintsCookie.serialize(wire, domain ? { domain } : {});
};

// Record "this browser just signed into a roster on this origin": the fresh
// pointer replaces any prior pointer for the same roster OR the same origin
// (one live roster per origin per browser) and goes first, newest-first.
export const appendAccountHintPointer = async (request: Request, rosterId: string): Promise<string> => {
	const origin = resolvePublicOrigin(request).origin;
	const existing = await parseAccountHintsCookie(request);
	const pointers: AccountHintPointer[] = [
		{ rosterId, origin, seenAt: Math.floor(Date.now() / 1000) },
		...existing.filter((pointer) => pointer.rosterId !== rosterId && pointer.origin !== origin)
	];
	return serializeAccountHintsCookie(request, pointers);
};
