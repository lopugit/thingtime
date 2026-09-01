import { randomUUID } from 'node:crypto';

import {
	generateAuthenticationOptions,
	generateRegistrationOptions,
	verifyAuthenticationResponse,
	verifyRegistrationResponse
} from '@simplewebauthn/server';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { Binary } from 'mongodb';

import { relationshipUniqueKeys } from '../messenger/shared';
import { getHomeThingsCollection as getThingsCollection } from '../mongodb/collections';
import { COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';

import { signJwt } from './jwt';
import { providerNameForAaguid } from './passkeyAaguids';
import { resolvePublicOrigin } from './publicOrigin';
import { createSession } from './sessions';
import { findUserById, toPublicUserWithStorage } from './users';
import type { PublicUser } from './users';
import {
	clearLoginChallengeCookie,
	clearRegistrationChallengeCookie,
	readLoginChallengeCookie,
	readRegistrationChallengeCookie,
	serializeLoginChallengeCookie,
	serializeRegistrationChallengeCookie
} from './webauthnChallenge';
import { PASSKEY_USER_VERIFICATION } from './webauthnPolicy';

// WebAuthn passkeys, everything-is-a-thing edition (FUNDAMENTALS §3):
//   • `passkey` things — one per registered credential, ownerId = the account
//     it signs into. Credential material (credentialId, COSE public key) lives
//     in the root `secure` BinData blob so the $** text index can never
//     tokenize it; the signature counter is the root number `secureCounter`
//     (numbers aren't text-indexed, and the hot per-login write stays a
//     targeted $set instead of a blob rewrite). Owner-facing metadata
//     (nickname, description, provider, dates, revocation) is crystal.
//     Credential-id uniqueness + the login-time lookup ride
//     uniqueKeys 'passkeyCredential:<id>' (BinData, like user email keys).
//   • `passkey-app-link` things — one per (passkey, app/origin) pair recording
//     where the passkey has been used; upserted per login via
//     crystal.linkKey, deduped through root uniqueKeys like every other
//     relationship family (bounded by distinct apps — never per-use growth).
// Both kinds are PROTECTED (registry.ts): a forged passkey doc would BE a
// working credential, so only this module writes them — always through the
// HOME things collection so a tt_mongo data-plane override can never capture
// or plant credentials.
//
// Ceremony parameters derive from the REQUEST origin: every *.thingtime.com
// deployment shares rpID 'thingtime.com', so a passkey registered on
// thingtime.com also works on previews/dev deployments (and vice versa) —
// matching the cross-deployment account-hints feature. The browser enforces
// that the page origin matches clientDataJSON, so a spoofed Host can't forge
// another origin's ceremony.

const RP_NAME = 'Thingtime';
const MAX_PASSKEYS_PER_USER = 25;
const MAX_NICKNAME_CHARS = 64;
const MAX_DESCRIPTION_CHARS = 280;

export type PasskeyFail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): PasskeyFail => ({ ok: false, status, error });

export type PublicPasskeyAppLink = {
	appKey: string;
	appName: string | null;
	firstUsedAt: string | null;
	lastUsedAt: string | null;
	usageCount: number;
};

export type PublicPasskey = {
	id: string;
	nickname: string;
	description: string | null;
	providerName: string | null;
	aaguid: string | null;
	deviceType: 'singleDevice' | 'multiDevice' | null;
	backedUp: boolean;
	transports: string[];
	createdAt: string | null;
	lastUsedAt: string | null;
	lastUsedOrigin: string | null;
	revokedAt: string | null;
	linkedApps: PublicPasskeyAppLink[];
};

// ── request-derived ceremony parameters ────────────────────────────────────

// rpID is the scope a passkey binds to. All *.thingtime.com deployments share
// 'thingtime.com'; anything else (localhost, a custom domain) scopes to its
// exact hostname. Never an eTLD like vercel.app — those hosts fall through to
// their full hostname, which WebAuthn accepts. Derived from the BROWSER-facing
// origin (x-forwarded aware) — behind the Vite dev proxy request.url is the
// nitro port, which the browser's clientDataJSON would never match.
export const deriveWebAuthnParams = (request: Request): { rpID: string; origin: string } => {
	const url = resolvePublicOrigin(request);
	const hostname = url.hostname;
	const rpID = hostname === 'thingtime.com' || hostname.endsWith('.thingtime.com') ? 'thingtime.com' : hostname;
	return { rpID, origin: url.origin };
};

// ── secure blob + unique keys ──────────────────────────────────────────────

type PasskeySecure = {
	credentialId?: string; // base64url, as the browser reports it
	publicKey?: string; // base64url COSE key bytes
};

const packPasskeySecure = (payload: PasskeySecure) => new Binary(Buffer.from(JSON.stringify(payload), 'utf8'));
const unpackPasskeySecure = (value: any): PasskeySecure => {
	if (!value?.buffer) return {};
	try {
		return JSON.parse(
			Buffer.from(value.buffer, value.byteOffset || 0, value.length ?? value.byteLength).toString('utf8')
		) as PasskeySecure;
	} catch {
		return {};
	}
};

// BinData for the same reason user email/username keys are: uniqueKeys as
// plain strings would tokenize into the $** text index.
const passkeyCredentialKey = (credentialId: string) => new Binary(Buffer.from(`passkeyCredential:${credentialId}`, 'utf8'));

const passkeyLinkKey = (passkeyId: string, appKey: string) => `${passkeyId}:${appKey}`;

// ── projections ────────────────────────────────────────────────────────────

const iso = (value: any): string | null => {
	if (!value) return null;
	const date = value instanceof Date ? value : new Date(value);
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const toPublicPasskey = (doc: any, links: any[] = []): PublicPasskey => ({
	id: doc.shareId,
	nickname: doc.crystal?.nickname || doc.crystal?.providerName || 'Passkey',
	description: doc.crystal?.description ?? null,
	providerName: doc.crystal?.providerName ?? null,
	aaguid: doc.crystal?.aaguid ?? null,
	deviceType: doc.crystal?.deviceType === 'singleDevice' || doc.crystal?.deviceType === 'multiDevice' ? doc.crystal.deviceType : null,
	backedUp: doc.crystal?.backedUp === true,
	transports: Array.isArray(doc.crystal?.transports) ? doc.crystal.transports.filter((t: unknown) => typeof t === 'string') : [],
	createdAt: iso(doc.createdAt),
	lastUsedAt: doc.crystal?.lastUsedAt ?? null,
	lastUsedOrigin: doc.crystal?.lastUsedOrigin ?? null,
	revokedAt: doc.crystal?.revokedAt ?? null,
	linkedApps: links
		.map((link) => ({
			appKey: String(link.crystal?.appKey || ''),
			appName: link.crystal?.appName ?? null,
			firstUsedAt: link.crystal?.firstUsedAt ?? null,
			lastUsedAt: link.crystal?.lastUsedAt ?? null,
			usageCount: Number(link.crystal?.usageCount) || 0
		}))
		.filter((link) => link.appKey)
		.sort((a, b) => (b.lastUsedAt || '').localeCompare(a.lastUsedAt || ''))
});

const boundedTrimmed = (value: unknown, max: number): string | null => {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
};

// ── doc lookups ────────────────────────────────────────────────────────────

const findPasskeyDocsForUser = async (userId: string): Promise<any[]> => {
	const things = await getThingsCollection();
	return things
		.find({ thingtime: 'passkey', ownerId: String(userId) } as any)
		.sort({ createdAt: -1 })
		.toArray();
};

const findPasskeyByCredentialId = async (credentialId: string): Promise<any | null> => {
	const things = await getThingsCollection();
	return things.findOne({ thingtime: 'passkey', uniqueKeys: passkeyCredentialKey(credentialId) } as any);
};

const findOwnedPasskey = async (userId: string, passkeyId: string): Promise<any | null> => {
	if (typeof passkeyId !== 'string' || !passkeyId.trim()) return null;
	const things = await getThingsCollection();
	return things.findOne({ thingtime: 'passkey', shareId: passkeyId.trim(), ownerId: String(userId) } as any);
};

// ── list / manage ──────────────────────────────────────────────────────────

// One query per kind (FUNDAMENTALS §3): passkeys + all their app links, links
// grouped in memory onto their passkey.
export const listPasskeys = async (userId: string): Promise<PublicPasskey[]> => {
	const things = await getThingsCollection();
	const [docs, links] = await Promise.all([
		findPasskeyDocsForUser(userId),
		things.find({ thingtime: 'passkey-app-link', ownerId: String(userId) } as any).toArray()
	]);
	const linksByPasskey = new Map<string, any[]>();
	for (const link of links) {
		const key = String(link.targetId || '');
		if (!linksByPasskey.has(key)) linksByPasskey.set(key, []);
		linksByPasskey.get(key)!.push(link);
	}
	return docs.map((doc) => toPublicPasskey(doc, linksByPasskey.get(doc.shareId) || []));
};

export type PasskeyUpdateInput = { nickname?: unknown; description?: unknown };

export const updatePasskey = async (
	userId: string,
	passkeyId: string,
	input: PasskeyUpdateInput
): Promise<PasskeyFail | { ok: true; passkey: PublicPasskey }> => {
	const doc = await findOwnedPasskey(userId, passkeyId);
	if (!doc) return fail(404, 'Passkey not found');

	const sets: Record<string, unknown> = { updatedAt: new Date() };
	if (input.nickname !== undefined) {
		const nickname = boundedTrimmed(input.nickname, MAX_NICKNAME_CHARS);
		if (!nickname) return fail(400, 'Nickname cannot be empty');
		sets['crystal.nickname'] = nickname;
	}
	if (input.description !== undefined) {
		// empty string clears the description
		sets['crystal.description'] = boundedTrimmed(input.description, MAX_DESCRIPTION_CHARS);
	}

	const things = await getThingsCollection();
	await things.updateOne({ shareId: doc.shareId, thingtime: 'passkey', ownerId: String(userId) } as any, { $set: sets } as any);
	const updated = await findOwnedPasskey(userId, passkeyId);
	return { ok: true, passkey: toPublicPasskey(updated || doc) };
};

// Revocation is immediate and permanent for the credential: login-time lookup
// rejects revoked docs before any signature check. The record stays for the
// owner's audit trail until they delete it.
export const revokePasskey = async (userId: string, passkeyId: string): Promise<PasskeyFail | { ok: true; passkey: PublicPasskey }> => {
	const doc = await findOwnedPasskey(userId, passkeyId);
	if (!doc) return fail(404, 'Passkey not found');
	if (doc.crystal?.revokedAt) return fail(409, 'This passkey is already revoked');

	const things = await getThingsCollection();
	await things.updateOne(
		{ shareId: doc.shareId, thingtime: 'passkey', ownerId: String(userId) } as any,
		{ $set: { 'crystal.revokedAt': new Date().toISOString(), updatedAt: new Date() } } as any
	);
	const updated = await findOwnedPasskey(userId, passkeyId);
	return { ok: true, passkey: toPublicPasskey(updated || doc) };
};

// Deleting requires prior revocation (two deliberate steps between "working
// credential" and "gone"), and deletes the passkey's app links with it.
export const deletePasskey = async (userId: string, passkeyId: string): Promise<PasskeyFail | { ok: true }> => {
	const doc = await findOwnedPasskey(userId, passkeyId);
	if (!doc) return fail(404, 'Passkey not found');
	if (!doc.crystal?.revokedAt) return fail(409, 'Revoke this passkey before deleting it');

	const things = await getThingsCollection();
	await things.deleteOne({ shareId: doc.shareId, thingtime: 'passkey', ownerId: String(userId) } as any);
	await things.deleteMany({ thingtime: 'passkey-app-link', targetId: doc.shareId, ownerId: String(userId) } as any);
	return { ok: true };
};

// ── registration ceremony ──────────────────────────────────────────────────

export const startPasskeyRegistration = async (
	user: PublicUser,
	request: Request
): Promise<PasskeyFail | { ok: true; options: Awaited<ReturnType<typeof generateRegistrationOptions>>; setCookies: string[] }> => {
	const existing = await findPasskeyDocsForUser(user.id);
	if (existing.length >= MAX_PASSKEYS_PER_USER) {
		return fail(409, `You already have ${MAX_PASSKEYS_PER_USER} passkeys — delete one first`);
	}

	const { rpID } = deriveWebAuthnParams(request);
	// Exclude every current credential (revoked included) so the platform sheet
	// refuses to double-register the same authenticator; deleting a passkey
	// frees its authenticator for re-registration.
	const excludeCredentials = existing
		.map((doc) => {
			const secure = unpackPasskeySecure(doc.secure);
			return secure.credentialId
				? {
						id: secure.credentialId,
						transports: (Array.isArray(doc.crystal?.transports) ? doc.crystal.transports : []) as any
					}
				: null;
		})
		.filter((entry): entry is { id: string; transports: any } => entry !== null);

	// residentKey 'required' → every Thingtime passkey is discoverable, which
	// is what makes usernameless login + the browser's conditional-UI autofill
	// (iCloud Keychain / 1Password popups) work everywhere.
	const options = await generateRegistrationOptions({
		rpName: RP_NAME,
		rpID,
		userID: new TextEncoder().encode(String(user.id)),
		userName: user.username,
		userDisplayName: user.displayName || user.username,
		attestationType: 'none',
		excludeCredentials,
		authenticatorSelection: { residentKey: 'required', userVerification: PASSKEY_USER_VERIFICATION }
	});

	return { ok: true, options, setCookies: [await serializeRegistrationChallengeCookie({ challenge: options.challenge, userId: String(user.id), rpID })] };
};

export type FinishPasskeyRegistrationInput = {
	user: PublicUser;
	request: Request;
	response: RegistrationResponseJSON;
	nickname?: unknown;
	description?: unknown;
};

export const finishPasskeyRegistration = async ({
	user,
	request,
	response,
	nickname,
	description
}: FinishPasskeyRegistrationInput): Promise<PasskeyFail | { ok: true; passkey: PublicPasskey; setCookies: string[] }> => {
	const challenge = await readRegistrationChallengeCookie(request);
	if (!challenge || challenge.userId !== String(user.id)) {
		return fail(400, 'This passkey setup expired — start again');
	}

	const { rpID, origin } = deriveWebAuthnParams(request);
	if (challenge.rpID !== rpID) return fail(400, 'This passkey setup expired — start again');

	let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
	try {
		verification = await verifyRegistrationResponse({
			response,
			expectedChallenge: challenge.challenge,
			expectedOrigin: origin,
			expectedRPID: rpID,
			requireUserVerification: true
		});
	} catch {
		return fail(400, 'The passkey could not be verified — try again');
	}
	if (!verification.verified || !verification.registrationInfo) {
		return fail(400, 'The passkey could not be verified — try again');
	}

	const info = verification.registrationInfo;
	const credential = info.credential;
	const providerName = providerNameForAaguid(info.aaguid);
	const now = new Date();

	const doc = {
		shareId: randomUUID(),
		schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
		thingtime: ['passkey'],
		crystal: {
			nickname: boundedTrimmed(nickname, MAX_NICKNAME_CHARS) || providerName || 'Passkey',
			description: boundedTrimmed(description, MAX_DESCRIPTION_CHARS),
			providerName,
			aaguid: info.aaguid || null,
			deviceType: info.credentialDeviceType,
			backedUp: info.credentialBackedUp,
			transports: Array.isArray(credential.transports) ? credential.transports : [],
			lastUsedAt: null,
			lastUsedOrigin: null,
			revokedAt: null
		},
		extended: null,
		ownerId: String(user.id),
		acl: ['tt:user'],
		targetId: null,
		tags: [],
		secure: packPasskeySecure({
			credentialId: credential.id,
			publicKey: Buffer.from(credential.publicKey).toString('base64url')
		}),
		secureCounter: credential.counter,
		uniqueKeys: [passkeyCredentialKey(credential.id)],
		createdAt: now,
		updatedAt: now
	};

	const things = await getThingsCollection();
	try {
		await things.insertOne(doc as any);
	} catch (err: any) {
		// the multikey unique index caught a duplicate credential id
		if (err?.code === 11000) return fail(409, 'This passkey is already registered');
		throw err;
	}

	return { ok: true, passkey: toPublicPasskey(doc), setCookies: [await clearRegistrationChallengeCookie()] };
};

// ── login ceremony ─────────────────────────────────────────────────────────

export const startPasskeyLogin = async (
	request: Request
): Promise<{ ok: true; options: Awaited<ReturnType<typeof generateAuthenticationOptions>>; setCookies: string[] }> => {
	const { rpID } = deriveWebAuthnParams(request);
	// Empty allowCredentials: discoverable credentials only. The authenticator
	// lists whatever passkeys it holds for this rpID — no username needed, no
	// account enumeration surface.
	const options = await generateAuthenticationOptions({ rpID, userVerification: PASSKEY_USER_VERIFICATION, allowCredentials: [] });
	return { ok: true, options, setCookies: [await serializeLoginChallengeCookie({ challenge: options.challenge, rpID })] };
};

export type PasskeyLoginResult =
	| PasskeyFail
	| { ok: true; user: PublicUser; jwt: string; jti: string; passkeyId: string; setCookies: string[] };

export type FinishPasskeyLoginInput = {
	request: Request;
	response: AuthenticationResponseJSON;
	// Optional SSO/app context recorded onto the passkey's linked apps.
	appContext?: { clientId: string; appName: string | null } | null;
};

export const finishPasskeyLogin = async ({ request, response, appContext }: FinishPasskeyLoginInput): Promise<PasskeyLoginResult> => {
	const challenge = await readLoginChallengeCookie(request);
	if (!challenge) return fail(400, 'This login attempt expired — try again');

	const { rpID, origin } = deriveWebAuthnParams(request);
	if (challenge.rpID !== rpID) return fail(400, 'This login attempt expired — try again');

	const credentialId = typeof response?.id === 'string' ? response.id : '';
	if (!credentialId) return fail(400, 'Malformed passkey response');

	// Generic error for unknown/revoked so credential ids can't be probed.
	const doc = await findPasskeyByCredentialId(credentialId);
	if (!doc) return fail(401, 'This passkey is not registered here');
	if (doc.crystal?.revokedAt) return fail(401, 'This passkey is not registered here');

	const secure = unpackPasskeySecure(doc.secure);
	if (!secure.publicKey || secure.credentialId !== credentialId) return fail(401, 'This passkey is not registered here');

	// Discoverable credentials report the userHandle they were minted with;
	// when present it must match the doc's owner (defense-in-depth against a
	// mixed-up credential row).
	const userHandle = response?.response?.userHandle;
	if (typeof userHandle === 'string' && userHandle) {
		const decoded = Buffer.from(userHandle, 'base64url').toString('utf8');
		if (decoded !== String(doc.ownerId)) return fail(401, 'This passkey is not registered here');
	}

	const user = await findUserById(String(doc.ownerId));
	if (!user) return fail(401, 'This passkey is not registered here');

	let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
	try {
		verification = await verifyAuthenticationResponse({
			response,
			expectedChallenge: challenge.challenge,
			expectedOrigin: origin,
			expectedRPID: rpID,
			credential: {
				id: credentialId,
				publicKey: new Uint8Array(Buffer.from(secure.publicKey, 'base64url')),
				counter: typeof doc.secureCounter === 'number' ? doc.secureCounter : 0,
				transports: Array.isArray(doc.crystal?.transports) ? doc.crystal.transports : undefined
			},
			requireUserVerification: true
		});
	} catch {
		return fail(401, 'The passkey could not be verified — try again');
	}
	if (!verification.verified) return fail(401, 'The passkey could not be verified — try again');

	const nowIso = new Date().toISOString();
	const things = await getThingsCollection();
	await things.updateOne({ shareId: doc.shareId, thingtime: 'passkey' } as any, {
		$set: {
			secureCounter: verification.authenticationInfo.newCounter,
			'crystal.lastUsedAt': nowIso,
			'crystal.lastUsedOrigin': origin,
			updatedAt: new Date()
		}
	} as any);

	// Record where this passkey just authenticated (origin always; app when the
	// login rode an SSO/app flow). Best-effort — a link hiccup must not fail a
	// verified login.
	await recordPasskeyAppLinks(doc, origin, appContext ?? null).catch(() => {});

	// A passkey is possession + user verification on the authenticator, so it
	// deliberately bypasses email-OTP 2FA (industry standard: the passkey IS
	// the second factor). Session purpose stays 'browser' so every session
	// surface (roster, revocation, resolveSessionUser) treats it identically.
	const session = await createSession(String(user._id), { meta: { method: 'passkey', passkeyId: doc.shareId } });
	const jwt = await signJwt({ sub: String(user._id), jti: session.jti });

	return {
		ok: true,
		user: await toPublicUserWithStorage(user),
		jwt,
		jti: session.jti,
		passkeyId: doc.shareId,
		setCookies: [await clearLoginChallengeCookie()]
	};
};

// ── app links ──────────────────────────────────────────────────────────────

const upsertPasskeyAppLink = async (passkeyDoc: any, appKey: string, appName: string | null) => {
	const things = await getThingsCollection();
	const linkKey = passkeyLinkKey(passkeyDoc.shareId, appKey);
	const nowIso = new Date().toISOString();
	const now = new Date();

	// Dedupe AND lookup ride the server-only root uniqueKeys namespace (the
	// relationship convention in messenger/shared.ts) — never the
	// user-writable crystal path, which a free-form data thing could squat.
	// Stamped through the shared helper so this writer can't drift from the
	// family, and matched on the same value so the read is served by the
	// uniqueKeys index — this kind needs no crystal-path index of its own.
	const uniqueKeys = relationshipUniqueKeys('passkey-app-link', { linkKey });

	const updateExisting = () =>
		things.updateOne(
			// legacy rows (written before the retirement) carry no stamp, so the
			// crystal path stays in the filter as a fallback until the backfill
			// migration stamps them
			{
				thingtime: 'passkey-app-link',
				...(uniqueKeys ? { $or: [{ uniqueKeys: uniqueKeys[0] }, { 'crystal.linkKey': linkKey }] } : { 'crystal.linkKey': linkKey })
			} as any,
			{
				$set: { 'crystal.lastUsedAt': nowIso, ...(appName ? { 'crystal.appName': appName } : {}), updatedAt: now },
				$inc: { 'crystal.usageCount': 1 }
			} as any
		);

	const updated = await updateExisting();
	if (updated.matchedCount > 0) return;

	try {
		await things.insertOne({
			shareId: randomUUID(),
			schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
			thingtime: ['passkey-app-link'],
			crystal: { linkKey, appKey, appName, firstUsedAt: nowIso, lastUsedAt: nowIso, usageCount: 1 },
			...(uniqueKeys ? { uniqueKeys } : {}),
			extended: null,
			ownerId: String(passkeyDoc.ownerId),
			acl: ['tt:user'],
			targetId: passkeyDoc.shareId,
			tags: [],
			createdAt: now,
			updatedAt: now
		} as any);
	} catch (err: any) {
		// a concurrent login inserted the link first — fold this use into it
		if (err?.code === 11000) {
			await updateExisting();
			return;
		}
		throw err;
	}
};

const recordPasskeyAppLinks = async (
	passkeyDoc: any,
	origin: string,
	appContext: { clientId: string; appName: string | null } | null
) => {
	let originHost = origin;
	try {
		originHost = new URL(origin).host;
	} catch {
		// keep the raw origin as the display name
	}
	await upsertPasskeyAppLink(passkeyDoc, `origin:${origin}`, originHost);
	if (appContext && typeof appContext.clientId === 'string' && appContext.clientId.startsWith('ttapp_')) {
		await upsertPasskeyAppLink(passkeyDoc, `app:${appContext.clientId}`, appContext.appName);
	}
};
