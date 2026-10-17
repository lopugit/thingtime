import { createHmac, randomUUID } from 'node:crypto';
import { ensureIndexes, getHomeThingsCollection, withHomeMongoTransaction } from '../mongodb/collections';
import { HOME_ACCOUNTED_STORAGE_OPTIONS, insertAccountedThing, updateAccountedThing } from '../storage/accountedThings';
import { encryptUserVaultValue, decryptUserVaultValue, withUserVaultKey } from '../auth/vaultKeys';
import { openVaultValue } from '../auth/vaultEnvelope';
import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';
import {
	MailError,
	MAIL_KINDS,
	mailId,
	publicMailAccount,
	revision,
	validateMailAccount,
	validateMailInbox,
	type MailAccount,
	type MailBatch
} from '~/mail/model';
import { fetchMailBatch, type MailSyncRequest } from './provider';
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
async function saveRecord(ownerId: string, kind: 'mail-account' | 'mail-inbox', raw: any, writeId: unknown) {
	mailId(writeId);
	const value = kind === 'mail-account' ? validateMailAccount(raw) : validateMailInbox(raw);
	const things = await getHomeThingsCollection();
	const existing = await things.findOne({ shareId: value.id });
	if (existing && !identity(existing, ownerId, kind)) throw new MailError(404, 'Mail record not found.');
	if (existing?.mailDeleted) throw new MailError(410, 'This mail record was removed. Create a new one.');
	if (kind === 'mail-account') {
		const account = value as MailAccount;
		// Local-only credentials must never be submitted here. Cloud disabled
		// accounts retain only settings; disabling removes the encrypted password.
		if (!account.sync.cloud && Object.values(account.servers).some((server) => server?.password))
			throw new MailError(400, 'Local-only passwords must stay on this device.');
		const previous: MailAccount | null = existing ? await open(ownerId, existing) : null;
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
export async function syncMailAccount(
	ownerId: string,
	id: unknown,
	request: MailSyncRequest,
	signal?: AbortSignal,
	fetchBatch = fetchMailBatch
): Promise<MailBatch> {
	const doc = await getRecord(ownerId, 'mail-account', id);
	const account: MailAccount = await open(ownerId, doc);
	if (!account.sync.cloud) throw new MailError(403, 'Cloud sync is turned off for this account.');
	const batch = await fetchBatch(account, request, signal);
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
				{ ...match(ownerId, 'mail-account', account.id), mailRevision: doc.mailRevision },
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
					{ $set: { crystal: { encryptedValue }, mailDeleted: false, updatedAt: new Date() } },
					{ session, ...HOME_ACCOUNTED_STORAGE_OPTIONS }
				);
			else
				await insertAccountedThing(things, document(ownerId, kind, value.id, encryptedValue, { parentId: account.id }), {
					session,
					...HOME_ACCOUNTED_STORAGE_OPTIONS
				});
		});
	}
	return batch;
}
