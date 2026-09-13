import { randomUUID } from 'node:crypto';
import { Binary } from 'mongodb';
import { getHomeThingsCollection, withHomeMongoTransaction } from '../mongodb/collections';
import { thingUniqueKey, thingUniqueKeyFilter } from '../mongodb/uniqueKeys';
import { ensureLopuAccount, createLopuAccountingService } from '../lopu/accounting';
import { getStoredLopuAccessSettings } from '../settings/lopuAccess';
import { COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';
import {
	INVITE_KIND,
	INVITE_TTL_MS,
	MAX_PENDING_INVITES,
	InviteError,
	inviteAmount,
	inviteProfile,
	inviteToken,
	inviteTokenHash
} from './inviteCore';
import { normalizeInviteAvatar } from './inviteAvatar';

const accountFilter = (ownerId: string) => ({ thingtime: 'lopu-account', ...thingUniqueKeyFilter('lopuAccount', ownerId) });
const pending = { thingtime: INVITE_KIND, 'crystal.status': 'pending' };
const details = (doc: any) => JSON.parse(Buffer.from(doc.secure.buffer).toString('utf8'));
const encode = (value: unknown) => new Binary(Buffer.from(JSON.stringify(value)));
const thing = (ownerId: string, kind: string, id: string, crystal: any) => ({
	shareId: id,
	thingtime: [kind],
	schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
	ownerId,
	storageClass: 'control',
	acl: [],
	tags: [],
	extended: null,
	crystal,
	createdAt: new Date(),
	updatedAt: new Date()
});
const ledger = async (things: any, session: any, ownerId: string, id: string, amount: number, balance: number, reason: string) => {
	if (amount === 0) return;
	await things.insertOne(
		thing(ownerId, 'lopu-credit', `invite-credit-${id}`, {
			entry: amount < 0 ? 'adjust' : 'refund',
			amountMicros: amount,
			balanceAfterMicros: balance,
			reason,
			actorId: ownerId
		}),
		{ session }
	);
};
const publicInvite = (doc: any, includeAvatar = true) => ({
	id: doc.shareId,
	...doc.crystal,
	...(doc.crystal.status === 'pending' ? { ...details(doc), ...(includeAvatar ? {} : { avatarUrl: undefined }) } : {}),
	credits: doc.crystal.amountMicros / 1_000_000,
	expiresAt: new Date(doc.expiresAt).toISOString(),
	createdAt: new Date(doc.createdAt).toISOString()
});

export const closeInvite = async (id: string, ownerId: string | null, expiredOnly = false) =>
	withHomeMongoTransaction(async (session) => {
		const things = await getHomeThingsCollection();
		const doc = await things.findOne(
			{ ...pending, shareId: id, ...(ownerId ? { ownerId } : {}), ...(expiredOnly ? { expiresAt: { $lte: new Date() } } : {}) },
			{ session }
		);
		if (!doc) return;
		const account = await things.findOneAndUpdate(
			accountFilter(doc.ownerId),
			{
				$inc: { 'crystal.balanceMicros': doc.crystal.amountMicros },
				$set: { updatedAt: new Date() }
			},
			{ session, returnDocument: 'after' }
		);
		if (!account) throw new InviteError(503, 'Credit account unavailable. Please try again.');
		await ledger(
			things,
			session,
			doc.ownerId,
			`${id}-return`,
			doc.crystal.amountMicros,
			account.crystal.balanceMicros,
			'Unused invite gift returned'
		);
		await things.updateOne(
			{ shareId: id, ...pending },
			{
				$set: { 'crystal.status': expiredOnly ? 'expired' : 'cancelled', updatedAt: new Date() },
				$unset: { secure: '', uniqueKeys: '' }
			},
			{ session }
		);
	});

export const expireInvites = async (ownerId?: string) => {
	const things = await getHomeThingsCollection();
	const expired = await things
		.find({ ...pending, ...(ownerId ? { ownerId } : {}), expiresAt: { $lte: new Date() } })
		.limit(50)
		.project({ shareId: 1 })
		.toArray();
	for (const doc of expired) await closeInvite(doc.shareId, ownerId || null, true);
};
export const listInvites = async (ownerId: string) => {
	await expireInvites(ownerId);
	const things = await getHomeThingsCollection();
	// Always expose every open reservation, even after many newer closed invites.
	const [open, closed] = await Promise.all([
		things
			.find({ ...pending, ownerId })
			.sort({ createdAt: -1 })
			.limit(MAX_PENDING_INVITES)
			.toArray(),
		things
			.find({ thingtime: INVITE_KIND, ownerId, 'crystal.status': { $ne: 'pending' } })
			.sort({ createdAt: -1 })
			.limit(30)
			.toArray()
	]);
	return [...open, ...closed].map((doc) => publicInvite(doc, false));
};
export const lookupInvite = async (token: unknown) => {
	const hash = inviteTokenHash(token);
	const doc = await (await getHomeThingsCollection()).findOne({ ...pending, ...thingUniqueKeyFilter('accountInviteToken', hash) });
	if (!doc) throw new InviteError(404, 'This invite has been used, cancelled or is unavailable.');
	if (new Date(doc.expiresAt).getTime() <= Date.now()) {
		await closeInvite(doc.shareId, null, true);
		throw new InviteError(410, 'This invite has expired. Ask for a new link.');
	}
	return doc;
};
export const previewInvite = async (token: unknown) => publicInvite(await lookupInvite(token));

export const createInvite = async (ownerId: string, input: any) => {
	const profile = inviteProfile(input);
	const amountMicros = inviteAmount(input.credits);
	await expireInvites(ownerId);
	await ensureLopuAccount(ownerId);
	const avatarUrl = await normalizeInviteAvatar(input.avatarUrl);
	const token = inviteToken();
	const id = `account-invite-${randomUUID()}`;
	const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
	await withHomeMongoTransaction(async (session) => {
		const things = await getHomeThingsCollection();
		// The account write serializes concurrent creators, including zero-credit
		// invites, so neither balance nor the pending-invite cap can be raced.
		const account = await things.findOneAndUpdate(
			{
				...accountFilter(ownerId),
				'crystal.balanceMicros': { $gte: amountMicros },
				$or: [{ 'crystal.inflight': { $exists: false } }, { 'crystal.inflight': { $lte: 0 } }]
			},
			{ $inc: { 'crystal.balanceMicros': -amountMicros, 'crystal.inviteRevision': 1 }, $set: { updatedAt: new Date() } },
			{ session, returnDocument: 'after' }
		);
		if (!account)
			throw new InviteError(409, 'Not enough available credits, or a Lopu turn is still running. Try a smaller gift or wait for it to finish.');
		const count = await things.countDocuments({ ...pending, ownerId }, { session });
		if (count >= MAX_PENDING_INVITES) throw new InviteError(409, 'You already have 20 open invites. Cancel one before creating another.');
		await things.insertOne(
			{
				...thing(ownerId, INVITE_KIND, id, { status: 'pending', amountMicros }),
				expiresAt,
				secure: encode({ ...profile, avatarUrl }),
				uniqueKeys: [thingUniqueKey('accountInviteToken', inviteTokenHash(token))]
			},
			{ session }
		);
		await ledger(things, session, ownerId, `${id}-reserve`, -amountMicros, account.crystal.balanceMicros, 'Credits set aside for an invite');
	});
	return { id, token, expiresAt: expiresAt.toISOString(), credits: amountMicros / 1_000_000 };
};

export const prepareInviteSignup = async (token: unknown, input: any) => {
	const invite = await lookupInvite(token);
	const defaults = details(invite);
	const profile = inviteProfile({ username: input.username ?? defaults.username, displayName: input.displayName ?? defaults.displayName });
	const avatarUrl = input.avatarUrl === undefined ? defaults.avatarUrl : await normalizeInviteAvatar(input.avatarUrl);
	const settings = await getStoredLopuAccessSettings();
	return {
		...profile,
		avatarUrl,
		onCreated: async (user: any, session: any) => {
			const things = await getHomeThingsCollection();
			const current = await things.findOneAndUpdate(
				{ ...pending, shareId: invite.shareId, expiresAt: { $gt: new Date() } },
				{
					$set: { 'crystal.status': 'claimed', updatedAt: new Date() },
					$unset: { secure: '', uniqueKeys: '' }
				},
				{ session, returnDocument: 'before' }
			);
			if (!current) throw new InviteError(409, 'This invite is no longer available. No account was created.');
			// Reuse canonical accounting with every operation pinned to the signup
			// transaction. Invited accounts receive the gift, without minting another
			// promotional starter grant through password-only signup.
			const scoped = new Proxy(things, {
				get(target, key) {
					const method = (target as any)[key];
					if (typeof method !== 'function') return method;
					return (...args: any[]) => {
						if (['findOne', 'insertOne'].includes(String(key))) args[1] = { ...args[1], session };
						else if (['updateOne', 'findOneAndUpdate'].includes(String(key))) args[2] = { ...args[2], session };
						return method.apply(target, args);
					};
				}
			});
			const accounting = createLopuAccountingService({
				getThingsCollection: async () => scoped as any,
				getSettings: async () => ({ ...settings, starterCredits: 0 })
			});
			const userId = String(user._id);
			await accounting.ensureLopuAccount(userId);
			if (current.crystal.amountMicros > 0) {
				await accounting.grantLopuCredits(userId, {
					entry: 'grant',
					amountMicros: current.crystal.amountMicros,
					reason: 'Welcome gift from an invite',
					actorId: current.ownerId,
					ledgerId: `invite-credit-${current.shareId}-claim`
				});
			}
		}
	};
};
