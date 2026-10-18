import { rootIdentity } from '../utils/rootIdentity';
import type { WorkspaceLease, WorkspaceScope } from '../local-workspace/storage';
import type { LocalGmailDraft } from './googleModel';
import { emptyMailState, type MailAccount, type MailState } from './model';
export type LocalMail = {
	version: 1;
	storageRevision: number;
	state: MailState;
	credentials: Record<string, MailAccount['servers']>;
	localAccountIds: string[];
	localInboxIds: string[];
	connectorToken: string;
	composeDrafts: LocalGmailDraft[];
	cursors: Record<string, string | null>;
};
export const emptyLocalMail = (): LocalMail => ({
	version: 1,
	storageRevision: 0,
	state: emptyMailState(),
	credentials: {},
	localAccountIds: [],
	localInboxIds: [],
	connectorToken: '',
	composeDrafts: [],
	cursors: {}
});
// Each account, folder, message and view is a separate encrypted IndexedDB row.
// An owner-level CAS prevents stale tabs overwriting newer device settings.
// The non-exportable device key is not an XSS or OS disk-encryption boundary.
const database = () =>
	new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open('thingtime-mail-v1', 2);
		request.onupgradeneeded = () => {
			for (const name of ['keys', 'mail', 'heads']) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
			if (!request.result.objectStoreNames.contains('records'))
				request.result.createObjectStore('records', { keyPath: ['scope', 'key'] }).createIndex('scope', 'scope');
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
const result = <T>(request: IDBRequest<T>) =>
	new Promise<T>((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
export type MailStorageScope = { kind: 'anonymous' } | Pick<Extract<WorkspaceScope, { kind: 'account' }>, 'kind' | 'origin' | 'ownerId'>;
/** Mail is home-plane data. The selected API origin, not a desktop shell's
 * origin, owns its account partition. Same-origin account keys stay compatible. */
export const mailStorageKey = (scope: MailStorageScope) => {
	if (scope.kind === 'anonymous') return JSON.stringify(['mail', 'anonymous', 1]);
	if (!scope.ownerId || new URL(scope.origin).origin !== scope.origin) throw new Error('Invalid mail workspace.');
	return `${scope.origin}:${scope.ownerId}`;
};
const done = (transaction: IDBTransaction, lease: WorkspaceLease) => {
	let unsubscribe = () => {};
	const complete = new Promise<void>((resolve, reject) => {
		transaction.oncomplete = () => {
			try {
				lease.assertCurrent();
				resolve();
			} catch (error) {
				reject(error);
			}
		};
		transaction.onerror = () => reject(transaction.error);
		transaction.onabort = () => reject(transaction.error || new Error('Mail changed in another tab or closed. Reopen it before saving.'));
		const abort = () => {
			try {
				transaction.abort();
			} catch {
				/* Already finished. */
			}
		};
		unsubscribe = lease.onInvalidate(abort);
		try {
			lease.assertCurrent();
		} catch {
			abort();
		}
	});
	// A request may reject before its transaction promise is awaited.
	const settled = complete.finally(() => unsubscribe());
	void settled.catch(() => {});
	return settled;
};
async function mapRows<T, R>(rows: T[], lease: WorkspaceLease, work: (row: T) => Promise<R>): Promise<R[]> {
	const results: R[] = [];
	for (let index = 0; index < rows.length; index += 16) {
		lease.assertCurrent();
		results.push(...(await Promise.all(rows.slice(index, index + 16).map(work))));
	}
	lease.assertCurrent();
	return results;
}
const memo = new Map<string, Map<string, string>>();
rootIdentity.subscribe(() => memo.clear());
if (typeof window !== 'undefined') window.addEventListener('thingtime:root-data-refresh', () => memo.clear());
function remember(owner: string, rows: Map<string, string>) {
	memo.clear();
	memo.set(owner, rows);
}
async function key(db: IDBDatabase, owner: string, lease: WorkspaceLease) {
	const candidate = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
	lease.assertCurrent();
	const tx = db.transaction('keys', 'readwrite'),
		complete = done(tx, lease),
		store = tx.objectStore('keys');
	const existing = await result(store.get(owner));
	if (!existing) store.put(candidate, owner);
	await complete;
	return (existing || candidate) as CryptoKey;
}
const aad = (owner: string, row: string) => new TextEncoder().encode(JSON.stringify([owner, row]));
function rowsFor(value: LocalMail): Map<string, string> {
	const rows = new Map<string, string>();
	rows.set('settings', JSON.stringify({ connectorToken: value.connectorToken }));
	for (const account of value.state.accounts)
		rows.set(
			`account:${account.id}`,
			JSON.stringify({ account, credentials: value.credentials[account.id], local: value.localAccountIds.includes(account.id) })
		);
	for (const inbox of value.state.inboxes) rows.set(`inbox:${inbox.id}`, JSON.stringify({ inbox, local: value.localInboxIds.includes(inbox.id) }));
	for (const folder of value.state.folders)
		rows.set(
			`folder:${folder.id}`,
			JSON.stringify({ folder, cloudCursor: value.cursors[`${folder.id}:cloud`], localCursor: value.cursors[`${folder.id}:local`] })
		);
	for (const message of value.state.messages) rows.set(`message:${message.id}`, JSON.stringify(message));
	for (const draft of value.composeDrafts || []) rows.set(`compose:${draft.id}`, JSON.stringify(draft));
	return rows;
}
export async function readMailLocal(scope: MailStorageScope, lease: WorkspaceLease): Promise<LocalMail> {
	lease.assertCurrent();
	const db = await database(),
		owner = mailStorageKey(scope);
	try {
		lease.assertCurrent();
		const tx = db.transaction(['heads', 'records', 'mail']),
			complete = done(tx, lease);
		const [head, records, legacy] = await Promise.all([
			result(tx.objectStore('heads').get(owner)),
			result(tx.objectStore('records').index('scope').getAll(owner)),
			result(tx.objectStore('mail').get(owner))
		]);
		await complete;
		if (!head && legacy) {
			const bytes = await crypto.subtle.decrypt(
				{ name: 'AES-GCM', iv: legacy.iv, additionalData: new TextEncoder().encode(owner) },
				await key(db, owner, lease),
				legacy.bytes
			);
			lease.assertCurrent();
			return { composeDrafts: [], ...JSON.parse(new TextDecoder().decode(bytes)), storageRevision: 0 };
		}
		const value = emptyLocalMail();
		value.storageRevision = head?.revision || 0;
		const dataKey = await key(db, owner, lease),
			plain = new Map<string, string>();
		await mapRows(records, lease, async (record: any) => {
			const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: record.iv, additionalData: aad(owner, record.key) }, dataKey, record.bytes);
			const text = new TextDecoder().decode(bytes),
				row = JSON.parse(text);
			plain.set(record.key, text);
			if (record.key === 'settings') value.connectorToken = row.connectorToken;
			else if (record.key.startsWith('account:')) {
				value.state.accounts.push(row.account);
				if (row.credentials) value.credentials[row.account.id] = row.credentials;
				if (row.local) value.localAccountIds.push(row.account.id);
			} else if (record.key.startsWith('inbox:')) {
				value.state.inboxes.push(row.inbox);
				if (row.local) value.localInboxIds.push(row.inbox.id);
			} else if (record.key.startsWith('folder:')) {
				value.state.folders.push(row.folder);
				if (row.cloudCursor !== undefined) value.cursors[`${row.folder.id}:cloud`] = row.cloudCursor;
				if (row.localCursor !== undefined) value.cursors[`${row.folder.id}:local`] = row.localCursor;
			} else if (record.key.startsWith('message:')) value.state.messages.push(row);
			else if (record.key.startsWith('compose:')) value.composeDrafts.push(row);
		});
		remember(owner, plain);
		return value;
	} finally {
		db.close();
	}
}
export async function writeMailLocal(scope: MailStorageScope, value: LocalMail, lease: WorkspaceLease): Promise<LocalMail> {
	lease.assertCurrent();
	const db = await database(),
		owner = mailStorageKey(scope),
		rows = rowsFor(value);
	try {
		const dataKey = await key(db, owner, lease),
			previous = memo.get(owner);
		const changed = await mapRows(
			[...rows].filter(([id, text]) => previous?.get(id) !== text),
			lease,
			async ([id, text]) => {
				const iv = crypto.getRandomValues(new Uint8Array(12));
				const bytes = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(owner, id) }, dataKey, new TextEncoder().encode(text));
				return { scope: owner, key: id, iv, bytes };
			}
		);
		const tx = db.transaction(['records', 'heads', 'mail'], 'readwrite'),
			complete = done(tx, lease),
			store = tx.objectStore('records');
		const [head, existing] = await Promise.all([result(tx.objectStore('heads').get(owner)), result(store.index('scope').getAllKeys(owner))]);
		if ((head?.revision || 0) !== value.storageRevision) {
			tx.abort();
			await complete;
			throw new Error('Mail changed in another tab. Reload before saving.');
		}
		for (const id of existing) if (!rows.has(String((id as IDBValidKey[])[1]))) store.delete(id);
		changed.forEach((row) => store.put(row));
		tx.objectStore('heads').put({ revision: value.storageRevision + 1 }, owner);
		tx.objectStore('mail').delete(owner);
		await complete;
		remember(owner, rows);
		return { ...value, storageRevision: value.storageRevision + 1 };
	} finally {
		db.close();
	}
}
export async function clearMailLocal(scope: MailStorageScope, lease: WorkspaceLease) {
	lease.assertCurrent();
	const db = await database(),
		owner = mailStorageKey(scope);
	try {
		lease.assertCurrent();
		const tx = db.transaction(['mail', 'keys', 'heads', 'records'], 'readwrite'),
			complete = done(tx, lease),
			store = tx.objectStore('records');
		const keys = await result(store.index('scope').getAllKeys(owner));
		keys.forEach((id) => store.delete(id));
		tx.objectStore('mail').delete(owner);
		tx.objectStore('keys').delete(owner);
		tx.objectStore('heads').delete(owner);
		await complete;
		memo.delete(owner);
	} finally {
		db.close();
	}
}
