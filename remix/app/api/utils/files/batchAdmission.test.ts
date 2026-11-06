import test from 'node:test';
import assert from 'node:assert/strict';
import { createBatchBudget, createBatchProviderAdmission, BATCH_BUDGET } from './batchAdmission';
function ledger() {
	const docs = new Map<string, any>();
	let time = 120000;
	const coll = {
		async updateOne({ key }: any, update: any) {
			if (!docs.has(key)) docs.set(key, structuredClone(update.$setOnInsert));
		},
		async findOneAndUpdate(q: any, u: any) {
			const row = docs.get(q.key);
			if (row.units > q.units.$lte || row.bytes > q.bytes.$lte) return null;
			row.units += u.$inc.units;
			row.bytes += u.$inc.bytes;
			return structuredClone(row);
		}
	};
	return {
		docs,
		advance() {
			time += 60000;
		},
		charge: createBatchBudget(
			async () => coll,
			async () => {},
			() => time
		)
	};
}
test('scalar budget admits concurrent exact ceiling without overshoot or expiry extension', async () => {
	const f = ledger();
	const answers = await Promise.all(Array.from({ length: 130 }, () => f.charge('a', 'prepare', 256, 1)));
	assert.equal(answers.filter(Boolean).length, 128);
	const row = [...f.docs.values()][0];
	assert.equal(row.units, BATCH_BUDGET.units);
	const expiry = +row.expiresAt;
	assert.equal(await f.charge('a', 'prepare', 1, 1), false);
	assert.equal(+row.expiresAt, expiry);
	assert.equal(await f.charge('b', 'prepare', 256, 1), true);
	f.advance();
	assert.equal(await f.charge('a', 'prepare', 1, 1), true);
});
test('payload admission is atomic with work and applies only to prepare', async () => {
	const f = ledger();
	for (let i = 0; i < 16; i++) assert.equal(await f.charge('a', 'prepare', 1, 32 * 1024 * 1024), true);
	const row = [...f.docs.values()][0],
		before = row.units;
	assert.equal(await f.charge('a', 'prepare', 1, 1), false);
	assert.equal(row.units, before);
	assert.equal(await f.charge('a', 'verify', 1, 32 * 1024 * 1024), true);
	assert.equal(row.bytes, BATCH_BUDGET.bytes);
});
test('provider admission bounds owner concurrency, no waiters, cancellation and failure cleanup', async () => {
	const admit = createBatchProviderAdmission(),
		signal = new AbortController().signal;
	let release!: () => void;
	const gate = new Promise<void>((r) => (release = r));
	const work = Array.from({ length: 8 }, () => admit('a', signal, Date.now() + 1000, () => gate));
	await assert.rejects(
		admit('a', signal, Date.now() + 1000, async () => {}),
		/capacity/
	);
	await admit('b', signal, Date.now() + 1000, async () => {});
	release();
	await Promise.all(work);
	await assert.rejects(
		admit('a', signal, Date.now() + 1000, async () => {
			throw Error('provider');
		}),
		/provider/
	);
	await admit('a', signal, Date.now() + 1000, async () => {});
	const cancelled = new AbortController();
	cancelled.abort();
	await assert.rejects(admit('a', cancelled.signal, Date.now() + 1000, async () => {}));
	await assert.rejects(
		admit('a', signal, 0, async () => {}),
		/deadline/
	);
});
test('provider owner cardinality is bounded with no retained idle owners', async () => {
	const admit = createBatchProviderAdmission(),
		signal = new AbortController().signal;
	let release!: () => void;
	const gate = new Promise<void>((r) => (release = r));
	const active = Array.from({ length: 64 }, (_, i) => admit(String(i), signal, Date.now() + 1000, () => gate));
	await assert.rejects(
		admit('new', signal, Date.now() + 1000, async () => {}),
		/capacity/
	);
	release();
	await Promise.all(active);
	await admit('new', signal, Date.now() + 1000, async () => {});
});

test('receipt probe has explicit bounded read cost and no payload charge', async () => {
	const f = ledger();
	assert.equal(await f.charge('owner', 'probe', 256, 32 * 1024 * 1024), true);
	const row = [...f.docs.values()][0];
	assert.equal(row.units, 9);
	assert.equal(row.bytes, 0);
});
test('concurrent upsert duplicate is recovered before guarded admission; unavailable ledger fails closed', async () => {
	const doc: any = { units: 0, bytes: 0 };
	const charge = createBatchBudget(
		async () => ({
			updateOne: async () => {
				throw Object.assign(Error('duplicate'), { code: 11000 });
			},
			findOneAndUpdate: async (q: any, u: any) => {
				assert.equal(q.units.$lte, BATCH_BUDGET.units - 2);
				doc.units += u.$inc.units;
				return doc;
			}
		}),
		async () => {},
		() => 0
	);
	assert.equal(await charge('a', 'prepare', 1, 1), true);
	assert.equal(doc.units, 2);
	const unavailable = createBatchBudget(
		async () => {
			throw Error('offline');
		},
		async () => {},
		() => 0
	);
	assert.equal(await unavailable('a', 'prepare', 1, 1), false);
});

test('empty verified/commit control charges one provider-free probe unit', async () => {
	const f = ledger();
	assert.equal(await f.charge('owner', 'probe', 0, 0), true);
	assert.equal([...f.docs.values()][0].units, 1);
	assert.equal(await f.charge('owner', 'verify', 0, 0), false);
});

test('folder metadata charges six units per member and no payload budget', async () => {
	const f = ledger();
	assert.equal(await f.charge('owner', 'folderCommit', 256, 32 * 1024 * 1024), true);
	const row = [...f.docs.values()][0];
	assert.equal(row.units, 1536);
	assert.equal(row.bytes, 0);
});
