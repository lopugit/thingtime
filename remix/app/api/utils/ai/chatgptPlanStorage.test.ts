import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { MongoChatGPTPlanStorage, type ChatGPTStorageRecord } from './chatgptPlanStorage';

function fixture() {
	let documents = new Map<string, Record<string, any>>();
	const matches = (record: Record<string, any>, filter: Record<string, any>) => Object.entries(filter).every(([key, value]) => record[key] === value);
	const collection = {
		async updateOne(filter: Record<string, any>, update: Record<string, any>, options?: Record<string, any>) {
			let record = [...documents.values()].find((value) => matches(value, filter));
			let created = false;
			if (!record && options?.upsert) {
				if (documents.has(filter.key)) throw Object.assign(new Error('duplicate'), { code: 11000 });
				record = { ...filter };
				documents.set(filter.key, record);
				created = true;
			}
			if (!record) return { matchedCount: 0 };
			if (created) Object.assign(record, update.$setOnInsert);
			Object.assign(record, update.$set);
			for (const [key, value] of Object.entries(update.$inc ?? {})) record[key] = (record[key] ?? 0) + Number(value);
			return { matchedCount: 1 };
		},
		async findOne(filter: Record<string, any>) {
			return [...documents.values()].find((value) => matches(value, filter)) ?? null;
		},
		find(filter: Record<string, any>) {
			return {
				async toArray() {
					return [...documents.values()].filter((value) => matches(value, filter));
				}
			};
		},
		async deleteOne(filter: Record<string, any>) {
			for (const [key, value] of documents) if (matches(value, filter)) documents.delete(key);
		}
	};
	const deps = {
		collection: async () => collection,
		transaction: async <T>(work: (session: unknown) => Promise<T>) => {
			const snapshot = structuredClone(documents);
			try {
				return await work({});
			} catch (error) {
				documents = snapshot;
				throw error;
			}
		}
	};
	return { deps, collection, records: () => [...documents.values()] };
}
const record: ChatGPTStorageRecord = {
	type: 'account',
	id: 'account-one',
	scope: 'hashed-owner-and-origin',
	value: { credentials: { accessToken: 'private-access', refreshToken: 'private-refresh' } }
};

test('Mongo vault encrypts per-owner rows, fences concurrent owners, and persists removals plus receipts atomically', async (t) => {
	const old = process.env.THINGTIME_USER_VAULT_KEY;
	process.env.THINGTIME_USER_VAULT_KEY = randomBytes(32).toString('base64url');
	t.after(() => {
		if (old === undefined) delete process.env.THINGTIME_USER_VAULT_KEY;
		else process.env.THINGTIME_USER_VAULT_KEY = old;
	});
	const data = fixture();
	const first = new MongoChatGPTPlanStorage(data.deps);
	assert.deepEqual(await first.load('urn:uuid:test'), []);
	await first.save([record]);
	assert.equal(JSON.stringify(data.records()).includes('private-refresh'), false);
	const competing = new MongoChatGPTPlanStorage(data.deps);
	await assert.rejects(competing.load('urn:uuid:test'), /Another runtime owns/);
	await first.close();
	const next = new MongoChatGPTPlanStorage(data.deps);
	assert.deepEqual(await next.load('urn:uuid:test'), [record]);
	await assert.rejects(first.assertAuthority(), /authority was lost/);
	await assert.rejects(first.save([record]), /authority was lost/);
	const receipt: ChatGPTStorageRecord = { type: 'outbound', id: 'recipient-one', scope: record.scope, value: { bundle: 'sealed-transfer' } };
	await next.save([receipt]);
	await next.close();
	const final = new MongoChatGPTPlanStorage(data.deps);
	assert.deepEqual(await final.load('urn:uuid:test'), [receipt]);
	await final.close();
});

test('owner-bound encrypted rows reject tampered scope and wrong vault keys', async (t) => {
	const old = process.env.THINGTIME_USER_VAULT_KEY;
	process.env.THINGTIME_USER_VAULT_KEY = randomBytes(32).toString('base64url');
	t.after(() => {
		if (old === undefined) delete process.env.THINGTIME_USER_VAULT_KEY;
		else process.env.THINGTIME_USER_VAULT_KEY = old;
	});
	const data = fixture();
	const first = new MongoChatGPTPlanStorage(data.deps);
	await first.load('urn:uuid:test');
	await first.save([record]);
	await first.close();
	const row = data.records().find((value) => value.recordType === 'account')!;
	row.scope = 'different-owner';
	const second = new MongoChatGPTPlanStorage(data.deps);
	await assert.rejects(second.load('urn:uuid:test'), /cannot be decrypted/);
	await second.close();
});

test('failed atomic move leaves the prior credential row and fencing revision unchanged', async (t) => {
	const old = process.env.THINGTIME_USER_VAULT_KEY;
	const key = randomBytes(32).toString('base64url');
	process.env.THINGTIME_USER_VAULT_KEY = key;
	t.after(() => {
		if (old === undefined) delete process.env.THINGTIME_USER_VAULT_KEY;
		else process.env.THINGTIME_USER_VAULT_KEY = old;
	});
	const data = fixture();
	const store = new MongoChatGPTPlanStorage(data.deps);
	await store.load('urn:uuid:test');
	await store.save([record]);
	process.env.THINGTIME_USER_VAULT_KEY = 'not-a-key';
	await assert.rejects(store.save([{ type: 'outbound', id: 'recipient-one', scope: record.scope, value: { ciphertext: 'sealed' } }]));
	process.env.THINGTIME_USER_VAULT_KEY = key;
	await store.assertAuthority();
	await store.close();
	const reopened = new MongoChatGPTPlanStorage(data.deps);
	assert.deepEqual(await reopened.load('urn:uuid:test'), [record]);
	await reopened.close();
});
