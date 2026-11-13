import assert from 'node:assert/strict';
import test from 'node:test';
import { awaitMongoSharedWork, budgetMongoArguments, mongoRequestOptions, withMongoRequestBudget } from './requestBudget';

test('request budget reaches actual operations and a deadline aborts supported driver work', async () => {
	await assert.rejects(withMongoRequestBudget(new AbortController().signal, 15, async () => {
		const options = mongoRequestOptions({ timeoutMS: 1000 });
		assert.ok(options.timeoutMS! <= 15);
		await new Promise((_, reject) => options.signal!.addEventListener('abort', () => reject(options.signal!.reason), { once: true }));
	}), { name: 'TimeoutError' });
});

test('disconnect stops a shared waiter without restarting or cancelling shared bootstrap', async () => {
	const controller = new AbortController();
	let finish!: (value: number) => void;
	const shared = new Promise<number>(resolve => { finish = resolve; });
	const first = withMongoRequestBudget(controller.signal, 1000, () => awaitMongoSharedWork(shared));
	controller.abort();
	await assert.rejects(first, { name: 'AbortError' });
	finish(42);
	assert.equal(await withMongoRequestBudget(new AbortController().signal, 1000, () => awaitMongoSharedWork(shared)), 42);
});

test('operation argument budgets preserve query options and remain isolated between requests', async () => {
	const unscoped = [{ key: 'test' }, { projection: { _id: 0 } }];
	assert.equal(budgetMongoArguments('findOne', unscoped), unscoped);
	await Promise.all([100, 300].map(timeoutMs => withMongoRequestBudget(new AbortController().signal, timeoutMs, async () => {
		await Promise.resolve();
		const args = budgetMongoArguments('findOne', unscoped);
		assert.deepEqual(args[1].projection, { _id: 0 });
		assert.ok(args[1].timeoutMS <= timeoutMs && args[1].timeoutMS > timeoutMs - 50);
	})));
	assert.equal((unscoped[1] as Record<string, unknown>).timeoutMS, undefined);
});

test('transactions own the remaining deadline, with no conflicting operation timeout override', async () => {
	const { mongoTransactionBudget } = await import('./requestBudget');
	assert.deepEqual(mongoTransactionBudget(), {});
	await withMongoRequestBudget(new AbortController().signal, 500, async () => {
		const transaction = mongoTransactionBudget();
		assert.ok(transaction.timeoutMS! <= 500);
		assert.equal(transaction.maxCommitTimeMS, transaction.timeoutMS);
		const session = { inTransaction: () => true };
		const args = budgetMongoArguments('updateOne', [{}, { $set: { safe: true } }, { session, timeoutMS: 900 }]);
		assert.equal(args[2].timeoutMS, undefined, 'Mongo forbids CSOT overrides inside withTransaction');
		assert.equal(args[2].session, session);
		assert.ok(args[2].signal);
	});
});

test('the first cancelled request cannot cancel shared initialization for a second live waiter', async () => {
	const { AsyncLocalStorage } = await import('node:async_hooks');
	const { startMongoSharedWork } = await import('./requestBudget');
	const authority = new AsyncLocalStorage<string>();
	const firstController = new AbortController();
	let release!: () => void;
	const bootstrapGate = new Promise<void>(resolve => { release = resolve; });
	let initialized = 0;
	let initialization: Promise<number> | null = null;
	const acquire = () => {
		mongoRequestOptions();
		return awaitMongoSharedWork(startMongoSharedWork(() => {
			initialization ??= (async () => {
				initialized++;
				assert.equal(authority.getStore(), 'admitted-gateway-owner');
				await bootstrapGate;
				// Shared driver/lease bounds remain the initializer's own; the
				// first caller's now-aborted request budget must be absent.
				assert.deepEqual(mongoRequestOptions(), {});
				assert.equal(authority.getStore(), 'admitted-gateway-owner');
				return 42;
			})();
			return initialization;
		}));
	};
	await authority.run('admitted-gateway-owner', async () => {
		const first = withMongoRequestBudget(firstController.signal, 1000, acquire);
		const firstRejected = assert.rejects(first, { name: 'AbortError' });
		const second = withMongoRequestBudget(new AbortController().signal, 1000, async () => {
			const value = await acquire();
			assert.ok(mongoRequestOptions().signal, 'The second caller retains its own budget');
			return value;
		});
		firstController.abort();
		await firstRejected;
		release();
		assert.equal(await second, 42);
		assert.equal(initialized, 1, 'Cancellation must not start a duplicate initializer');
	});
});
