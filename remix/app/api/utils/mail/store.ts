import { createHash, createHmac, randomUUID } from 'node:crypto';
import { ensureIndexes, getHomeThingsCollection, withHomeMongoTransaction } from '../mongodb/collections';
import { HOME_ACCOUNTED_STORAGE_OPTIONS, insertAccountedThing, updateAccountedThing } from '../storage/accountedThings';
import { encryptUserVaultValue, decryptUserVaultValue, withUserVaultKey } from '../auth/vaultKeys';
import { openVaultValue } from '../auth/vaultEnvelope';
import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';
import {
	MailError,
	MailActionError,
	MAIL_KINDS,
	mailId,
	publicMailAccount,
	revision,
	validateMailAccount,
	validateMailInbox,
	type MailAccount,
	type MailBatch
} from '~/mail/model';
import { gmailMutation } from '~/mail/googleModel';
import { applyGoogleMailMutation, readGoogleDrafts } from './googleActions';
import { folderFor, fetchMailBatch, type MailSyncRequest } from './provider';
import { fetchGoogleMailBatch, type GoogleMailGrant, type PrivateMailAccount } from './google';
const match = (ownerId: string, kind: string, id?: string) => ({
	ownerId,
	thingtime: kind,
	mailDeleted: { $ne: true },
	...(id ? { shareId: id } : {})
});
const digest = (ownerId: string, value: unknown) =>
	withUserVaultKey(ownerId, (key) => createHmac('sha256', key.bytes).update(JSON.stringify(value)).digest('hex'));
const seal = (ownerId: string, id: string, value: unknown) => encryptUserVaultValue(ownerId, id, 'secret', JSON.stringify(value));
const open = async (ownerId: string, doc: any) => JSON.parse(await decryptUserVaultValue(ownerId, doc.shareId, 'secret', doc.crystal.encryptedValue));
const identity = (doc: any, ownerId: string, kind: string) => doc?.ownerId === ownerId && doc.thingtime?.length === 1 && doc.thingtime[0] === kind;
function document(ownerId: string, kind: string, id: string, encryptedValue: unknown, extra: Record<string, unknown> = {}) {
	const now = new Date();
	return {
		shareId: id,
		ownerId,
		thingtime: [kind],
		schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
		acl: [ACL_OWNER],
		crystal: { encryptedValue },
		extended: null,
		tags: [],
		targetId: null,
		createdAt: now,
		updatedAt: now,
		...extra
	};
}
async function getRecord(ownerId: string, kind: string, id: unknown) {
	const doc = await (await getHomeThingsCollection()).findOne(match(ownerId, kind, mailId(id)));
	if (!doc) throw new MailError(404, 'Mail record not found.');
	return doc;
}
/** One bounded indexed page; private payloads are decrypted in a single key scope. */
export async function listMail(ownerId: string, kind: string, cursor?: string | null) {
	if (!(MAIL_KINDS as readonly string[]).includes(kind)) throw new MailError(400, 'Choose a mail record type.');
	let after = {};
	if (cursor) {
		try {
			if (cursor.length > 400 || !/^[a-zA-Z0-9_-]+$/.test(cursor)) throw new Error();
			const value = JSON.parse(Buffer.from(cursor, 'base64url').toString());
			if (value.kind !== kind || typeof value.date !== 'string' || new Date(value.date).toISOString() !== value.date) throw new Error();
			mailId(value.id);
			after = { $or: [{ createdAt: { $lt: new Date(value.date) } }, { createdAt: new Date(value.date), shareId: { $gt: value.id } }] };
		} catch {
			throw new MailError(400, 'Invalid mail cursor.');
		}
	}
	const docs = await (
		await getHomeThingsCollection()
	)
		.find({ ...match(ownerId, kind), ...after })
		.sort({ createdAt: -1, shareId: 1 })
		.limit(51)
		.toArray();
	const page = docs.slice(0, 50);
	const records = page.length
		? await withUserVaultKey(ownerId, (key) =>
				page.map((doc) => {
					const value = JSON.parse(openVaultValue(ownerId, key, doc.shareId, 'secret', doc.crystal.encryptedValue));
					return kind === 'mail-account' ? publicMailAccount(value) : value;
				})
		  )
		: [];
	const last = page.at(-1);
	return {
		records,
		nextCursor:
			docs.length > 50
				? Buffer.from(JSON.stringify({ kind, date: new Date(last!.createdAt).toISOString(), id: last!.shareId })).toString('base64url')
				: null
	};
}
async function saveRecord(ownerId: string, kind: 'mail-account' | 'mail-inbox', raw: any, writeId: unknown, googleGrant?: GoogleMailGrant) {
	mailId(writeId);
	const value = kind === 'mail-account' ? validateMailAccount(raw) : validateMailInbox(raw);
	const things = await getHomeThingsCollection();
	const existing = await things.findOne({ shareId: value.id });
	if (existing && !identity(existing, ownerId, kind)) throw new MailError(404, 'Mail record not found.');
	if (existing?.mailDeleted) throw new MailError(410, 'This mail record was removed. Create a new one.');
	if (kind === 'mail-account') {
		const account = value as PrivateMailAccount;
		// Local-only credentials must never be submitted here. Cloud disabled
		// accounts retain only settings; disabling removes the encrypted password.
		if (!account.sync.cloud && Object.values(account.servers).some((server) => server?.password))
			throw new MailError(400, 'Local-only passwords must stay on this device.');
		const previous: PrivateMailAccount | null = existing ? await open(ownerId, existing) : null;
		if (previous && (previous.provider !== account.provider || (previous.provider === 'gmail' && previous.address !== account.address)))
			throw new MailError(409, 'Connect a new account to change its Google identity.');
		if (account.provider === 'gmail') {
			if (!previous?.googleGrant && !googleGrant) throw new MailError(403, 'Connect this account with Google first.');
			account.googleGrant = previous?.googleGrant || googleGrant;
		}
		for (const protocol of ['imap', 'pop3'] as const) {
			const server = account.servers[protocol];
			if (!server) continue;
			const old = previous?.servers[protocol];
			if (
				account.sync.cloud &&
				!server.password &&
				old &&
				old.host === server.host &&
				old.username === server.username &&
				old.port === server.port &&
				old.security === server.security
			)
				server.password = old.password;
			if (account.sync.cloud && !server.password) throw new MailError(400, 'Enter a password for each cloud mail server.');
			if (!account.sync.cloud) delete server.password;
		}
	}
	const requestDigest = await digest(ownerId, raw);
	const encryptedValue = await seal(ownerId, value.id, { ...value, revision: value.revision + 1 });
	await ensureIndexes();
	return withHomeMongoTransaction(async (session) => {
		const previous = await things.findOne({ shareId: value.id }, { session });
		if (previous && !identity(previous, ownerId, kind)) throw new MailError(404, 'Mail record not found.');
		if (previous?.mailDeleted) throw new MailError(410, 'This mail record was removed.');
		if (previous?.mailWriteId === writeId) {
			if (previous.mailWriteDigest !== requestDigest) throw new MailError(409, 'This save id has already been used.');
			return kind === 'mail-account'
				? publicMailAccount({ ...(value as MailAccount), revision: previous.mailRevision })
				: { ...value, revision: previous.mailRevision };
		}
		if ((previous?.mailRevision ?? 0) !== value.revision) throw new MailError(409, 'These settings changed elsewhere. Reload before saving.');
		// Proxy memberships must reference owned folders; no mailbox writes occur.
		if (kind === 'mail-inbox') {
			const ids = (value as ReturnType<typeof validateMailInbox>).folderIds;
			const count = await things.countDocuments({ ...match(ownerId, 'mail-folder'), shareId: { $in: ids } }, { session });
			if (count !== ids.length) throw new MailError(400, 'Choose folders from your own connected accounts.');
		}
		const metadata = { mailRevision: value.revision + 1, mailWriteId: writeId, mailWriteDigest: requestDigest };
		if (previous)
			await updateAccountedThing(
				things,
				{ ...match(ownerId, kind, value.id), mailRevision: value.revision },
				{ $set: { crystal: { encryptedValue }, ...metadata, updatedAt: new Date() } },
				{ session, ...HOME_ACCOUNTED_STORAGE_OPTIONS }
			);
		else
			await insertAccountedThing(things, document(ownerId, kind, value.id, encryptedValue, metadata), { session, ...HOME_ACCOUNTED_STORAGE_OPTIONS });
		const result = { ...value, revision: value.revision + 1 };
		return kind === 'mail-account' ? publicMailAccount(result as MailAccount) : result;
	});
}
/** Server-only OAuth completion: callers cannot submit or replace a grant through save-account. */
export const connectGoogleMailAccount = (ownerId: string, id: string, address: string, grant: GoogleMailGrant) =>
	saveRecord(
		ownerId,
		'mail-account',
		{ id, name: address, address, provider: 'gmail', revision: 0, servers: {}, sync: { cloud: false, local: true, transport: 'relay' } },
		id,
		grant
	);
export const saveMailAccount = (ownerId: string, input: any) => saveRecord(ownerId, 'mail-account', input.account, input.writeId);
export const saveMailInbox = (ownerId: string, input: any) => saveRecord(ownerId, 'mail-inbox', input.inbox, input.writeId);
export async function deleteMailRecord(ownerId: string, kind: unknown, id: unknown, expectedRevision: unknown) {
	if (kind !== 'mail-account' && kind !== 'mail-inbox') throw new MailError(400, 'Select an account or proxy inbox.');
	mailId(id);
	revision(expectedRevision);
	const things = await getHomeThingsCollection();
	await withHomeMongoTransaction(async (session) => {
		const doc = await things.findOne({ ownerId, thingtime: kind, shareId: id }, { session });
		if (!doc) throw new MailError(404, 'Mail record not found.');
		if (doc.mailDeleted) return;
		if (doc.mailRevision !== expectedRevision) throw new MailError(409, 'These settings changed. Reload before removing.');
		await updateAccountedThing(
			things,
			{ _id: doc._id },
			{
				$set: { crystal: {}, mailDeleted: true, mailRevision: Number(expectedRevision) + 1, updatedAt: new Date() },
				$unset: { mailWriteId: '', mailWriteDigest: '' }
			},
			{ session, ...HOME_ACCOUNTED_STORAGE_OPTIONS }
		);
	});
	// Child cleanup is bounded, retryable and goes through accounted mutations.
	// The account tombstone prevents a concurrent sync from adding new children.
	if (kind === 'mail-account') {
		while (true) {
			const children = await things
				.find({ ownerId, parentId: id, thingtime: { $in: ['mail-message', 'mail-folder'] }, mailDeleted: { $ne: true } }, { projection: { _id: 1 } })
				.limit(50)
				.toArray();
			if (!children.length) break;
			for (const child of children)
				await updateAccountedThing(
					things,
					{ _id: child._id, ownerId },
					{ $set: { crystal: {}, mailDeleted: true, updatedAt: new Date() } },
					HOME_ACCOUNTED_STORAGE_OPTIONS
				);
		}
	}
}
const fetchAccountBatch = (account: PrivateMailAccount, request: MailSyncRequest, signal?: AbortSignal) =>
	account.provider === 'gmail' ? fetchGoogleMailBatch(account, request, signal) : fetchMailBatch(account, request, signal);
export async function syncMailAccount(
	ownerId: string,
	id: unknown,
	request: MailSyncRequest,
	signal?: AbortSignal,
	fetchBatch = fetchAccountBatch,
	deviceOnly = false
): Promise<MailBatch> {
	const doc = await getRecord(ownerId, 'mail-account', id);
	const account: PrivateMailAccount = await open(ownerId, doc);
	if (doc.mailMutationLeaseUntil && new Date(doc.mailMutationLeaseUntil).getTime() > Date.now())
		throw new MailError(409, 'A Gmail action is still running. Sync again shortly.');
	if (deviceOnly && (account.provider !== 'gmail' || !account.sync.local)) throw new MailError(403, 'Device Gmail sync is disabled.');
	if (!deviceOnly && !account.sync.cloud) throw new MailError(403, 'Cloud sync is turned off for this account.');
	const batch = await fetchBatch(account, request, signal);
	if (deviceOnly) {
		const current = await getRecord(ownerId, 'mail-account', id);
		if (current.mailRevision !== doc.mailRevision || current.mailContentRevision !== doc.mailContentRevision)
			throw new MailError(409, 'The email account changed while syncing.');
		return batch;
	}
	const records = [
		...batch.folders.map((value) => ({ kind: 'mail-folder', value })),
		...batch.messages.map((value) => ({ kind: 'mail-message', value }))
	];
	for (const { kind, value } of records) {
		const encryptedValue = await seal(ownerId, value.id, value);
		const things = await getHomeThingsCollection();
		await withHomeMongoTransaction(async (session) => {
			// A write on the parent serializes sync against edits/removal. Merely
			// reading the parent in a snapshot would allow stale inserts after delete.
			const fence = await updateAccountedThing(
				things,
				{
					...match(ownerId, 'mail-account', account.id),
					mailRevision: doc.mailRevision,
					mailContentRevision: doc.mailContentRevision ?? { $exists: false }
				},
				{ $set: { mailSyncFence: randomUUID() } },
				{ session, ...HOME_ACCOUNTED_STORAGE_OPTIONS }
			);
			if (!fence.matchedCount) throw new MailError(409, 'The email account changed while syncing.');
			const previous = await things.findOne({ shareId: value.id }, { session });
			if (previous && (!identity(previous, ownerId, kind) || previous.parentId !== account.id)) throw new MailError(409, 'Mail identity conflict.');
			if (previous)
				await updateAccountedThing(
					things,
					{ _id: previous._id },
					{
						$set: {
							crystal: { encryptedValue },
							mailDeleted: false,
							updatedAt: new Date(),
							...(kind === 'mail-message' ? { mailRemoteId: (value as any).remoteId } : {})
						}
					},
					{ session, ...HOME_ACCOUNTED_STORAGE_OPTIONS }
				);
			else
				await insertAccountedThing(
					things,
					document(ownerId, kind, value.id, encryptedValue, {
						parentId: account.id,
						...(kind === 'mail-message' ? { mailRemoteId: (value as any).remoteId } : {})
					}),
					{
						session,
						...HOME_ACCOUNTED_STORAGE_OPTIONS
					}
				);
		});
	}
	return batch;
}

/** Reads never reveal the saved grant. */
export async function googleMailDrafts(ownerId: string, input: any, signal?: AbortSignal) {
	const doc = await getRecord(ownerId, 'mail-account', input.id);
	const account = await open(ownerId, doc);
	const result = await readGoogleDrafts(account, input, signal);
	const current = await getRecord(ownerId, 'mail-account', input.id);
	if (current.mailRevision !== doc.mailRevision) throw new MailError(409, 'The email account changed.');
	return result;
}
/** Durable admission before provider I/O. Uncertain outcomes never auto-resend. */
export async function googleMailAction(ownerId: string, input: any, signal?: AbortSignal, apply = applyGoogleMailMutation) {
	const id = mailId(input.id),
		writeId = mailId(input.writeId),
		mutation = gmailMutation(input.mutation);
	const expectedRevision = revision(input.revision),
		requestDigest = await digest(ownerId, { id, mutation });
	const operationId =
		'mailop_' +
		createHash('sha256')
			.update(JSON.stringify([ownerId, id, writeId]))
			.digest('hex');
	const things = await getHomeThingsCollection();
	const doc = await getRecord(ownerId, 'mail-account', id),
		account: PrivateMailAccount = await open(ownerId, doc);
	if (account.provider !== 'gmail') throw new MailError(400, 'This action requires a Gmail connection.');
	const admitted = await withHomeMongoTransaction(async (session) => {
		const prior = await things.findOne({ shareId: operationId }, { session });
		if (prior) {
			if (!identity(prior, ownerId, 'mail-operation') || prior.parentId !== id || prior.mailWriteDigest !== requestDigest)
				throw new MailError(409, 'This operation id was already used for a different action.');
			return prior;
		}
		const fence = await updateAccountedThing(
			things,
			{
				...match(ownerId, 'mail-account', id),
				mailRevision: expectedRevision,
				$or: [{ mailMutationLeaseUntil: { $exists: false } }, { mailMutationLeaseUntil: { $lt: new Date() } }]
			},
			{
				$set: { mailMutationLease: operationId, mailMutationLeaseUntil: new Date(Date.now() + 60000), mailSyncFence: randomUUID() },
				$inc: { mailContentRevision: 1 }
			},
			{ session, ...HOME_ACCOUNTED_STORAGE_OPTIONS }
		);
		if (!fence.matchedCount)
			throw new MailActionError(409, 'The account changed or another Gmail action is still running. Try again shortly.', 'not-applied');
		await insertAccountedThing(
			things,
			document(ownerId, 'mail-operation', operationId, await seal(ownerId, operationId, { status: 'pending' }), {
				parentId: id,
				mailWriteDigest: requestDigest,
				mailOperationStatus: 'pending'
			}),
			{ session, ...HOME_ACCOUNTED_STORAGE_OPTIONS }
		);
		return null;
	});
	if (admitted) {
		if (admitted.mailOperationStatus === 'complete') return (await open(ownerId, admitted)).result;
		if (admitted.mailOperationStatus === 'failed') {
			const error = await open(ownerId, admitted);
			throw new MailActionError(error.status, error.error, 'not-applied');
		}
		throw new MailError(
			409,
			'This action may already have reached Gmail. Check Gmail before starting another action; it will not be repeated automatically.'
		);
	}
	// Once admitted, cancelling the HTTP request does not retry the provider call.
	// A crash or lost provider response deliberately leaves an uncertain receipt.
	try {
		const deadline = AbortSignal.timeout(45000);
		const result = await apply(account, mutation, operationId, signal ? AbortSignal.any([signal, deadline]) : deadline);
		if ('remoteId' in result && result.remoteId && 'labelIds' in result) {
			const folderIds = new Set(result.labelIds!.map((label) => folderFor(id, 'gmail', label).id));
			const rows = await things
				.find({ ...match(ownerId, 'mail-message'), parentId: id, mailRemoteId: result.remoteId })
				.limit(1001)
				.toArray();
			if (rows.length > 1000) throw new MailError(503, 'Gmail changed, but the saved cache needs refreshing.');
			for (const row of rows) {
				const message = await open(ownerId, row);
				await withHomeMongoTransaction(async (session) => {
					const fence = await updateAccountedThing(
						things,
						{ ...match(ownerId, 'mail-account', id), mailRevision: expectedRevision, mailMutationLease: operationId },
						{ $set: { mailSyncFence: randomUUID(), mailMutationLeaseUntil: new Date(Date.now() + 60000) } },
						{ session, ...HOME_ACCOUNTED_STORAGE_OPTIONS }
					);
					if (!fence.matchedCount) return;
					const keep = folderIds.has(message.folderId);
					await updateAccountedThing(
						things,
						{ _id: row._id, mailDeleted: { $ne: true } },
						{
							$set: {
								updatedAt: new Date(),
								...(keep
									? { crystal: { encryptedValue: await seal(ownerId, row.shareId, { ...message, unread: result.unread }) } }
									: { crystal: {}, mailDeleted: true })
							}
						},
						{ session, ...HOME_ACCOUNTED_STORAGE_OPTIONS }
					);
				});
			}
		}
		await updateAccountedThing(
			things,
			{ ...match(ownerId, 'mail-operation', operationId), mailOperationStatus: 'pending' },
			{
				$set: {
					crystal: { encryptedValue: await seal(ownerId, operationId, { status: 'complete', result }) },
					mailOperationStatus: 'complete',
					updatedAt: new Date()
				}
			},
			HOME_ACCOUNTED_STORAGE_OPTIONS
		);
		return result;
	} catch (error) {
		if (error instanceof MailActionError && error.actionOutcome === 'not-applied') {
			await updateAccountedThing(
				things,
				{ ...match(ownerId, 'mail-operation', operationId), mailOperationStatus: 'pending' },
				{
					$set: {
						mailOperationStatus: 'failed',
						crystal: { encryptedValue: await seal(ownerId, operationId, { status: error.status, error: error.message }) }
					}
				},
				HOME_ACCOUNTED_STORAGE_OPTIONS
			);
		}
		throw error;
	} finally {
		await updateAccountedThing(
			things,
			{ ...match(ownerId, 'mail-account', id), mailMutationLease: operationId },
			{ $unset: { mailMutationLease: '', mailMutationLeaseUntil: '' } },
			HOME_ACCOUNTED_STORAGE_OPTIONS
		);
	}
}
