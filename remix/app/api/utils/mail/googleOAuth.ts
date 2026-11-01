import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ensureIndexes, getAuthOtpsCollection } from '../mongodb/collections';
import { encryptUserVaultValue, decryptUserVaultValue } from '../auth/vaultKeys';
import { getLiveSession } from '../auth/sessions';
import { verifyJwt } from '../auth/jwt';
import { resolvePublicOrigin } from '../auth/publicOrigin';
import { MailError, mailId } from '~/mail/model';
import { GMAIL_SCOPE, googleMailConfig, exchangeGoogleMail } from './google';
import { connectGoogleMailAccount } from './store';
const hash = (value: string) => createHash('sha256').update(value).digest('base64url');
const type = 'mail-google-oauth';
const seal = (owner: string, id: string, value: unknown) => encryptUserVaultValue(owner, id, 'oauth', JSON.stringify(value));
const open = async (doc: any) => JSON.parse(await decryptUserVaultValue(doc.userId, doc.flowId, 'oauth', doc.encryptedValue));
const defaults = {
	getAuthOtpsCollection,
	ensureIndexes,
	getLiveSession,
	verifyJwt,
	googleMailConfig,
	exchangeGoogleMail,
	connectGoogleMailAccount,
	seal,
	open
};
export function createGoogleMailOAuth(overrides: Partial<typeof defaults> = {}) {
	const deps = { ...defaults, ...overrides };
	async function live(ownerId: string, jti: string) {
		const session = await deps.getLiveSession(jti);
		if (!session || session.userId !== ownerId || (session.purpose && session.purpose !== 'browser'))
			throw new MailError(401, 'Sign in again before connecting Gmail.');
	}
	async function sessionId(ownerId: string, token: string) {
		const claims = await deps.verifyJwt(token);
		if (!claims || claims.sub !== ownerId) throw new MailError(401, 'Sign in again before connecting Gmail.');
		await live(ownerId, claims.jti);
		return claims.jti;
	}
	return {
		authorize: sessionId,
		async operate(ownerId: string, token: string, request: Request, body: any) {
			const jti = await sessionId(ownerId, token);
			const collection = await deps.getAuthOtpsCollection();
			const origin = resolvePublicOrigin(request).origin;
			if (body.operation === 'google-begin') {
				const config = await deps.googleMailConfig(origin);
				if (new URL(config.redirectUri).origin !== origin) throw new MailError(503, 'Google mail is configured for a different Thingtime origin.');
				const flowId = randomUUID(),
					state = randomBytes(32).toString('base64url'),
					verifier = randomBytes(32).toString('base64url');
				const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
				await deps.ensureIndexes();
				await collection.insertOne({
					type,
					flowId,
					challenge: hash(state),
					userId: ownerId,
					jti,
					origin,
					expiresAt,
					status: 'pending',
					encryptedValue: await deps.seal(ownerId, flowId, { verifier, clientId: config.clientId })
				});
				const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
				url.search = new URLSearchParams({
					client_id: config.clientId,
					redirect_uri: config.redirectUri,
					response_type: 'code',
					scope: `openid email ${GMAIL_SCOPE}`,
					state,
					code_challenge: hash(verifier),
					code_challenge_method: 'S256',
					access_type: 'offline',
					prompt: 'consent select_account'
				}).toString();
				return { flowId, authorizeUrl: url.href, expiresAt: expiresAt.toISOString() };
			}
			const flowId = mailId(body.flowId);
			const filter = { type, flowId, userId: ownerId, jti, origin, expiresAt: { $gt: new Date() } };
			const doc = await collection.findOne(filter);
			if (!doc) throw new MailError(410, 'This Google connection expired. Start again.');
			if (body.operation === 'google-cancel') {
				await collection.updateOne(
					{ ...filter, status: { $in: ['pending', 'processing', 'ready', 'failed'] } },
					{ $set: { status: 'cancelled' }, $unset: { encryptedValue: '' } }
				);
				return { status: 'cancelled' };
			}
			if (doc.status === 'complete') return { status: 'complete' };
			if (doc.status === 'failed' || doc.status === 'cancelled')
				throw new MailError(409, 'Google connection was cancelled or could not be completed. Start again.');
			if (doc.status !== 'ready' && doc.status !== 'finishing') return { status: 'pending' };
			const result = await deps.open(doc);
			if (body.operation === 'google-status') return { status: 'ready', address: result.address };
			if (body.operation !== 'google-finish' || body.address !== result.address)
				throw new MailError(409, 'Confirm the Google account shown before connecting.');
			const claim = await collection.updateOne({ ...filter, status: { $in: ['ready', 'finishing'] } }, { $set: { status: 'finishing' } });
			if (!claim.matchedCount) throw new MailError(409, 'This Google connection changed. Start again.');
			await live(ownerId, jti);
			// Deterministic id/writeId makes retries after an uncertain response idempotent.
			await deps.connectGoogleMailAccount(ownerId, flowId, result.address, result.grant);
			await collection.updateOne({ ...filter, status: 'finishing' }, { $set: { status: 'complete' }, $unset: { encryptedValue: '' } });
			return { status: 'complete' };
		},
		async callback(request: Request) {
			const url = new URL(request.url),
				state = url.searchParams.get('state');
			if (!state || !/^[A-Za-z0-9_-]{43}$/.test(state)) throw new MailError(400, 'Invalid Google connection.');
			const collection = await deps.getAuthOtpsCollection();
			const filter = { type, challenge: hash(state), origin: resolvePublicOrigin(request).origin, expiresAt: { $gt: new Date() } };
			const doc = await collection.findOne({ ...filter, status: 'pending' });
			if (!doc) throw new MailError(410, 'This Google connection expired or was already used.');
			const claim = await collection.updateOne({ ...filter, status: 'pending' }, { $set: { status: 'processing' } });
			if (!claim.matchedCount) throw new MailError(409, 'This Google connection was already used.');
			try {
				await live(doc.userId, doc.jti);
				const code = url.searchParams.get('code');
				if (url.searchParams.has('error') || !code || code.length > 8192) throw new MailError(400, 'Google connection was cancelled.');
				const config = await deps.googleMailConfig(doc.origin),
					pending = await deps.open(doc);
				if (config.clientId !== pending.clientId || new URL(config.redirectUri).origin !== doc.origin)
					throw new MailError(409, 'Google connection settings changed.');
				const result = await deps.exchangeGoogleMail(config, code, pending.verifier);
				await live(doc.userId, doc.jti);
				const saved = await collection.updateOne(
					{ ...filter, status: 'processing' },
					{ $set: { status: 'ready', encryptedValue: await deps.seal(doc.userId, doc.flowId, result) } }
				);
				if (!saved.matchedCount) throw new MailError(409, 'Google connection was cancelled.');
			} catch (error) {
				await collection.updateOne({ ...filter, status: 'processing' }, { $set: { status: 'failed' }, $unset: { encryptedValue: '' } });
				throw error;
			}
		}
	};
}
export const googleMailOAuth = createGoogleMailOAuth();
