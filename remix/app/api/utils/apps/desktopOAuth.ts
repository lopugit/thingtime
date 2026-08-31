import { findUserById } from '../auth/users';
import { signJwt, verifyJwt } from '../auth/jwt';
import { createSession } from '../auth/sessions';
import { getSessionsCollection } from '../mongodb/collections';
import { appAllowsDesktopRedirect, appIsRevoked, findAppByClientId } from './apps';
import { issueAppToken } from './appTokens';
import type { AppTokenGrant } from './appTokens';
import { normalizeDesktopRedirectUri, normalizePkceVerifier, pkceVerifierMatches } from './desktopOAuthCore';
import { sessionScopes } from './scopes';
import type { AppScopeId } from './scopes';

const DESKTOP_CODE_TTL_MS = 5 * 60 * 1000;

type Fail = { ok: false; status: number; error: string };
const invalidGrant = (): Fail => ({
	ok: false,
	status: 400,
	error: 'Authorization code is invalid, expired, already used, or does not match this request'
});

export const issueDesktopAuthorizationCode = async (
	userId: string,
	input: {
		clientId: string;
		redirectUri: string;
		origin: string;
		codeChallenge: string;
		scopes: AppScopeId[];
		sharedThings?: string[];
	}
): Promise<{ code: string; expiresAt: Date }> => {
	const expiresAt = new Date(Date.now() + DESKTOP_CODE_TTL_MS);
	const session = await createSession(userId, {
		purpose: 'oauth-code',
		expiresAt,
		meta: {
			clientId: input.clientId,
			redirectUri: input.redirectUri,
			origin: input.origin,
			codeChallenge: input.codeChallenge,
			codeChallengeMethod: 'S256',
			scopes: input.scopes,
			sharedThings: input.sharedThings ?? []
		}
	});

	// The code is signed so a guessed jti is useless, while the backing session
	// makes it revocable and one-time. It cannot act as a normal account token:
	// resolveSessionUser rejects purpose `oauth-code`.
	const code = await signJwt({ sub: userId, jti: session.jti, expiresIn: '5m' });
	return { code, expiresAt };
};

export const exchangeDesktopAuthorizationCode = async (input: {
	code?: unknown;
	clientId?: unknown;
	redirectUri?: unknown;
	codeVerifier?: unknown;
}): Promise<{ ok: true; grant: AppTokenGrant } | Fail> => {
	const code = typeof input.code === 'string' && input.code.length <= 4096 ? input.code.trim() : '';
	const clientId = typeof input.clientId === 'string' ? input.clientId.trim() : '';
	const redirect = normalizeDesktopRedirectUri(input.redirectUri);
	const verifier = normalizePkceVerifier(input.codeVerifier);
	if (!code || !clientId || !redirect || !verifier) return invalidGrant();

	const claims = await verifyJwt(code);
	if (!claims) return invalidGrant();

	const sessions = await getSessionsCollection();
	const codeSession = await sessions.findOne({ jti: claims.jti });
	if (!codeSession || codeSession.purpose !== 'oauth-code' || codeSession.revokedAt) return invalidGrant();
	if (String(codeSession.userId) !== claims.sub) return invalidGrant();
	if (!codeSession.expiresAt || new Date(codeSession.expiresAt).getTime() <= Date.now()) return invalidGrant();

	const meta = codeSession.meta || {};
	if (meta.clientId !== clientId || meta.redirectUri !== redirect.uri || meta.origin !== redirect.origin) return invalidGrant();
	if (meta.codeChallengeMethod !== 'S256' || !pkceVerifierMatches(verifier, meta.codeChallenge)) return invalidGrant();

	// Re-check mutable authority at exchange time. Removing the callback origin,
	// suspending/deleting the app, or deleting the user invalidates an issued but
	// not-yet-exchanged code.
	const [app, user] = await Promise.all([findAppByClientId(clientId), findUserById(claims.sub)]);
	if (!app || appIsRevoked(app) || !appAllowsDesktopRedirect(app, redirect) || !user) return invalidGrant();

	// Consume before minting. The compare-and-set is the replay boundary: two
	// racing exchanges can both validate PKCE, but only one can flip revokedAt.
	const now = new Date();
	const consumed = await sessions.findOneAndUpdate(
		{
			jti: claims.jti,
			userId: claims.sub,
			purpose: 'oauth-code',
			revokedAt: null,
			expiresAt: { $gt: now },
			'meta.clientId': clientId,
			'meta.redirectUri': redirect.uri
		},
		{ $set: { revokedAt: now, 'meta.consumedAt': now } },
		{ returnDocument: 'before' }
	);
	if (!consumed) return invalidGrant();

	const scopes = sessionScopes(meta);
	const sharedThings = Array.isArray(meta.sharedThings) ? meta.sharedThings.filter((id: unknown): id is string => typeof id === 'string') : [];
	const grant = await issueAppToken(claims.sub, clientId, redirect.origin, scopes, sharedThings);
	return { ok: true, grant };
};
