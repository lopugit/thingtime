import { randomUUID } from 'node:crypto';
import { encryptOwnerValue, decryptOwnerValue, ownerVaultConfigured, type EncryptedVaultValue } from '../auth/vaultCipher';

export interface ChatGPTStorageRecord {
	type: 'account' | 'recipient' | 'outbound' | 'receipt';
	id: string;
	scope: string;
	value: unknown;
}
export interface ChatGPTPlanStorage {
	load(hostId: string): Promise<ChatGPTStorageRecord[]>;
	assertAuthority(): Promise<void>;
	save(records: ChatGPTStorageRecord[]): Promise<void>;
	close(): Promise<void>;
}
const NAMESPACE = 'thingtime-chatgpt-plan:v1:';
interface Row {
	key: string;
	authority: string;
	recordType: ChatGPTStorageRecord['type'];
	recordId: string;
	scope: string;
	encrypted: EncryptedVaultValue;
}
interface MongoDependencies {
	collection: () => Promise<any>;
	transaction: <T>(callback: (session: any) => Promise<T>) => Promise<T>;
}
/** Settings already has a unique key index; each credential/receipt is an independent encrypted row. */
export class MongoChatGPTPlanStorage implements ChatGPTPlanStorage {
	private authority = '';
	private lockKey = '';
	private readonly owner = randomUUID();
	private fence = 0;
	private revision = 0;
	private loaded = false;
	private previous = new Map<string, string>();
	private readonly deps: MongoDependencies;
	constructor(deps: MongoDependencies) {
		this.deps = deps;
	}
	private rowKey(record: Pick<ChatGPTStorageRecord, 'type' | 'id'>) {
		return `${this.authority}.${record.type}.${record.id}`;
	}
	async load(hostId: string) {
		if (!ownerVaultConfigured()) throw new Error('ChatGPT database storage requires a configured Thingtime vault key.');
		this.authority = `Thingtime.ChatGPTPlan.${hostId}`;
		this.lockKey = `${this.authority}.authority`;
		const collection = await this.deps.collection();
		try {
			await collection.updateOne(
				{ key: this.lockKey },
				{ $setOnInsert: { key: this.lockKey, lockOwner: null, fence: 0, revision: 0 } },
				{ upsert: true }
			);
		} catch (error) {
			if ((error as { code?: number }).code !== 11000) throw error;
		}
		const claim = await collection.updateOne({ key: this.lockKey, lockOwner: null }, { $set: { lockOwner: this.owner }, $inc: { fence: 1 } });
		if (!claim.matchedCount)
			throw new Error('Another runtime owns these ChatGPT credentials. Release its database authority only after stopping that runtime.');
		const lock = await collection.findOne({ key: this.lockKey, lockOwner: this.owner });
		this.fence = lock.fence;
		this.revision = lock.revision;
		this.loaded = true;
		const rows: Row[] = await collection.find({ authority: this.authority }).toArray();
		const records = rows.map((row) => {
			const value = JSON.parse(decryptOwnerValue(NAMESPACE, row.scope, row.key, row.encrypted));
			const record = { type: row.recordType, id: row.recordId, scope: row.scope, value };
			if (row.key !== this.rowKey(record)) throw new Error('ChatGPT database record identity mismatch.');
			this.previous.set(row.key, JSON.stringify(record));
			return record;
		});
		return records;
	}
	async assertAuthority() {
		const lock = await (
			await this.deps.collection()
		).findOne({ key: this.lockKey, lockOwner: this.owner, fence: this.fence, revision: this.revision });
		if (!this.loaded || !lock) throw new Error('ChatGPT runtime database authority was lost. Reconnect before continuing.');
	}
	async save(records: ChatGPTStorageRecord[]) {
		const collection = await this.deps.collection();
		const next = new Map(records.map((record) => [this.rowKey(record), JSON.stringify(record)]));
		await this.deps.transaction(async (session) => {
			const fenced = await collection.updateOne(
				{ key: this.lockKey, lockOwner: this.owner, fence: this.fence, revision: this.revision },
				{ $inc: { revision: 1 } },
				{ session }
			);
			if (!fenced.matchedCount) throw new Error('ChatGPT runtime database authority was lost.');
			for (const record of records) {
				const key = this.rowKey(record);
				if (this.previous.get(key) === next.get(key)) continue;
				const row: Row = {
					key,
					authority: this.authority,
					recordType: record.type,
					recordId: record.id,
					scope: record.scope,
					encrypted: encryptOwnerValue(NAMESPACE, record.scope, key, JSON.stringify(record.value))
				};
				await collection.updateOne({ key }, { $set: row }, { upsert: true, session });
			}
			for (const key of this.previous.keys()) if (!next.has(key)) await collection.deleteOne({ key, authority: this.authority }, { session });
		});
		this.revision++;
		this.previous = next;
	}
	async close() {
		if (!this.loaded) return;
		await (await this.deps.collection()).updateOne({ key: this.lockKey, lockOwner: this.owner, fence: this.fence }, { $set: { lockOwner: null } });
		this.loaded = false;
	}
}
export function createMongoChatGPTPlanStorage(): ChatGPTPlanStorage {
	return new MongoChatGPTPlanStorage({
		collection: async () => (await import('../mongodb/collections')).getSettingsCollection(),
		transaction: async (callback) => (await import('../mongodb/collections')).withHomeMongoTransaction(callback)
	});
}
