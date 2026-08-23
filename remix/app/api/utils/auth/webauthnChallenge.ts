import { createCookie } from '~/api/cookies';

import { signPurposeToken, verifyPurposeToken } from './jwt';

// WebAuthn ceremony challenges ride a short-lived signed cookie instead of a
// server-side store: the options endpoint signs { challenge, rpID, … } into a
// purpose-fenced JWT (jwt.ts), the verify endpoint checks the signature + TTL
// and then EXPIRES the cookie, so a challenge can't be replayed from a browser
// that no longer holds it. Stateless by design — challenges survive serverless
// instance churn because every deployment shares the JWT key material.
//
// Registration and login use separate cookies so an in-flight "add a passkey"
// ceremony can't be consumed by a login (or vice versa), and the purpose claim
// fences both off from every other token this server signs.

const CHALLENGE_MAX_AGE_SECONDS = 60 * 10;
const CHALLENGE_TTL = '10m';

const challengeCookieOptions = {
	httpOnly: true,
	secure: process.env.NODE_ENV === 'production',
	sameSite: 'lax' as const,
	path: '/',
	maxAge: CHALLENGE_MAX_AGE_SECONDS
};

const registrationCookie = createCookie('tt_webauthn_reg', challengeCookieOptions);
const loginCookie = createCookie('tt_webauthn_auth', challengeCookieOptions);

export type RegistrationChallenge = { challenge: string; userId: string; rpID: string };
export type LoginChallenge = { challenge: string; rpID: string };

export const serializeRegistrationChallengeCookie = async (payload: RegistrationChallenge) =>
	registrationCookie.serialize(await signPurposeToken('webauthn-reg', payload, CHALLENGE_TTL));

export const readRegistrationChallengeCookie = async (request: Request): Promise<RegistrationChallenge | null> => {
	const raw = await registrationCookie.parse(request.headers.get('Cookie'));
	if (typeof raw !== 'string' || !raw) return null;
	const payload = await verifyPurposeToken(raw, 'webauthn-reg');
	if (!payload || typeof payload.challenge !== 'string' || typeof payload.userId !== 'string' || typeof payload.rpID !== 'string') {
		return null;
	}
	return { challenge: payload.challenge, userId: payload.userId, rpID: payload.rpID };
};

export const clearRegistrationChallengeCookie = () => registrationCookie.serialize('', { maxAge: 0 });

export const serializeLoginChallengeCookie = async (payload: LoginChallenge) =>
	loginCookie.serialize(await signPurposeToken('webauthn-auth', payload, CHALLENGE_TTL));

export const readLoginChallengeCookie = async (request: Request): Promise<LoginChallenge | null> => {
	const raw = await loginCookie.parse(request.headers.get('Cookie'));
	if (typeof raw !== 'string' || !raw) return null;
	const payload = await verifyPurposeToken(raw, 'webauthn-auth');
	if (!payload || typeof payload.challenge !== 'string' || typeof payload.rpID !== 'string') return null;
	return { challenge: payload.challenge, rpID: payload.rpID };
};

export const clearLoginChallengeCookie = () => loginCookie.serialize('', { maxAge: 0 });
