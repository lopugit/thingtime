import { createHash } from 'node:crypto';
import { createCookie } from '~/api/cookies';
import { signPurposeToken, verifyPurposeToken } from './jwt';

const MAX_AGE = 60 * 10;
const MAX_PENDING = 3;
type Ceremony = 'reg' | 'auth';
const purpose = (kind: Ceremony) => (kind === 'reg' ? 'webauthn-reg' : 'webauthn-auth');
const prefix = (kind: Ceremony) => `tt_webauthn_${kind}`;
const cookie = (name: string) =>
	createCookie(name, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: MAX_AGE });

// Read the assertion's challenge only to select a signed cookie. It is NEVER
// trusted as an expected challenge until the cookie signature is verified.
export const responseChallenge = (response: any): string | null => {
	try {
		const encoded = response?.response?.clientDataJSON;
		if (typeof encoded !== 'string' || encoded.length > 8192) return null;
		const value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')).challenge;
		return typeof value === 'string' && /^[A-Za-z0-9_-]{16,256}$/.test(value) ? value : null;
	} catch {
		return null;
	}
};
export const challengeCookieName = (kind: Ceremony, challenge: string) =>
	`${prefix(kind)}_${createHash('sha256').update(challenge).digest('hex').slice(0, 24)}`;
export type LoginChallenge = { challenge: string; rpID: string; origin?: string; cookieName?: string };
export type RegistrationChallenge = LoginChallenge & { userId: string };

// Independent cookies prevent one tab, autofill or a repeated click replacing
// another request's expected challenge. Keep at most three per ceremony kind.
const serializeChallenge = async (kind: Ceremony, payload: LoginChallenge, request: Request): Promise<string[]> => {
	const name = challengeCookieName(kind, payload.challenge);
	const names = (request.headers.get('Cookie') || '')
		.split(';')
		.map((part) => part.trim().split('=')[0])
		.filter((key) => new RegExp(`^${prefix(kind)}_[a-f0-9]{24}$`).test(key) && key !== name);
	const stale = names.slice(0, Math.max(0, names.length - MAX_PENDING + 1));
	return [
		...(await Promise.all(stale.map((key) => cookie(key).serialize('', { maxAge: 0 })))),
		await cookie(name).serialize(await signPurposeToken(purpose(kind), payload, '10m'))
	];
};
const readChallenge = async (kind: Ceremony, request: Request, response: unknown): Promise<LoginChallenge | null> => {
	const challenge = responseChallenge(response);
	if (!challenge) return null;
	// A bounded rollout fallback accepts existing in-flight legacy cookies.
	for (const name of [challengeCookieName(kind, challenge), prefix(kind)]) {
		try {
			const raw = await cookie(name).parse(request.headers.get('Cookie'));
			if (typeof raw !== 'string' || !raw) continue;
			const payload = await verifyPurposeToken(raw, purpose(kind));
			if (!payload || payload.challenge !== challenge || typeof payload.rpID !== 'string') continue;
			if (kind === 'reg' && typeof payload.userId !== 'string') continue;
			if (payload.origin !== undefined && typeof payload.origin !== 'string') continue;
			return { ...payload, cookieName: name } as LoginChallenge;
		} catch {
			/* Malformed cookie is an expired ceremony, never a 500. */
		}
	}
	return null;
};
export const serializeRegistrationChallengeCookie = (payload: RegistrationChallenge, request: Request) => serializeChallenge('reg', payload, request);
export const serializeLoginChallengeCookie = (payload: LoginChallenge, request: Request) => serializeChallenge('auth', payload, request);
export const readRegistrationChallengeCookie = (request: Request, response: unknown) =>
	readChallenge('reg', request, response) as Promise<RegistrationChallenge | null>;
export const readLoginChallengeCookie = (request: Request, response: unknown) => readChallenge('auth', request, response);
export const clearRegistrationChallengeCookie = (challenge: RegistrationChallenge) =>
	cookie(challenge.cookieName || prefix('reg')).serialize('', { maxAge: 0 });
export const clearLoginChallengeCookie = (challenge: LoginChallenge) => cookie(challenge.cookieName || prefix('auth')).serialize('', { maxAge: 0 });
