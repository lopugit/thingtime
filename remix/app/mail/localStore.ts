import { emptyMailState, type MailAccount, type MailState } from './model';
export type LocalMail = {
	version: 1;
	storageRevision: number;
	state: MailState;
	credentials: Record<string, MailAccount['servers']>;
	localAccountIds: string[];
	localInboxIds: string[];
	connectorToken: string;
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
const done = (transaction: IDBTransaction) =>
	new Promise<void>((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error);
		transaction.onabort = () => reject(transaction.error || new Error('Mail changed in another tab. Reload before saving.'));
	});
const scope = (ownerId: string) => `${location.origin}:${ownerId}`;
const memo = new Map<string, Map<string, string>>();
if (typeof window !== 'undefined') window.addEventListener('thingtime:root-data-refresh', () => memo.clear());
function remember(owner: string, rows: Map<string, string>) {
	memo.clear();
	memo.set(owner, rows);
}
async function key(db: IDBDatabase, ownerId: string) {
	const candidate = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
	const tx = db.transaction('keys', 'readwrite'),
		complete = done(tx),
		store = tx.objectStore('keys');
	const existing = await result(store.get(scope(ownerId)));
	if (!existing) store.put(candidate, scope(ownerId));
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
	return rows;
}
export async function readMailLocal(ownerId: string): Promise<LocalMail> {
	const db = await database(),
		owner = scope(ownerId);
	try {
		const tx = db.transaction(['heads', 'records', 'mail']),
			complete = done(tx);
		const [head, records, legacy] = await Promise.all([
			result(tx.objectStore('heads').get(owner)),
			result(tx.objectStore('records').index('scope').getAll(owner)),
			result(tx.objectStore('mail').get(owner))
		]);
		await complete;
		if (!head && legacy) {
			const bytes = await crypto.subtle.decrypt(
				{ name: 'AES-GCM', iv: legacy.iv, additionalData: new TextEncoder().encode(owner) },
				await key(db, ownerId),
				legacy.bytes
			);
			return { ...JSON.parse(new TextDecoder().decode(bytes)), storageRevision: 0 };
		}
		const value = emptyLocalMail();
		value.storageRevision = head?.revision || 0;
		const dataKey = await key(db, ownerId),
			plain = new Map<string, string>();
		await Promise.all(
			records.map(async (record: any) => {
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
			})
		);
		remember(owner, plain);
		return value;
	} finally {
		db.close();
	}
}
export async function writeMailLocal(ownerId: string, value: LocalMail): Promise<LocalMail> {
	const db = await database(),
		owner = scope(ownerId),
		rows = rowsFor(value);
	try {
		const dataKey = await key(db, ownerId),
			previous = memo.get(owner);
		const changed = await Promise.all(
			[...rows]
				.filter(([id, text]) => previous?.get(id) !== text)
				.map(async ([id, text]) => {
					const iv = crypto.getRandomValues(new Uint8Array(12));
					const bytes = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(owner, id) }, dataKey, new TextEncoder().encode(text));
					return { scope: owner, key: id, iv, bytes };
				})
		);
		const tx = db.transaction(['records', 'heads', 'mail'], 'readwrite'),
			complete = done(tx),
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
export async function clearMailLocal(ownerId: string) {
	const db = await database(),
		owner = scope(ownerId);
	try {
		const tx = db.transaction(['mail', 'keys', 'heads', 'records'], 'readwrite'),
			complete = done(tx),
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
