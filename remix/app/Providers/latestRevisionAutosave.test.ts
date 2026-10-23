import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes this TypeScript test directly and requires the .ts extension.
import { createLatestRevisionAutosave } from './latestRevisionAutosave.ts';

type TimerTask = {
	id: number;
	at: number;
	callback: () => void;
};

class FakeTimers {
	time = 0;
	nextId = 1;
	tasks = new Map<number, TimerTask>();

	api = {
		setTimeout: (callback: () => void, delayMs: number): number => {
			const id = this.nextId++;
			this.tasks.set(id, { id, at: this.time + delayMs, callback });
			return id;
		},
		clearTimeout: (handle: unknown): void => {
			this.tasks.delete(handle as number);
		}
	};

	advanceBy(ms: number): void {
		const target = this.time + ms;
		while (true) {
			const next = [...this.tasks.values()].filter((task) => task.at <= target).sort((left, right) => left.at - right.at || left.id - right.id)[0];
			if (!next) break;
			this.time = next.at;
			this.tasks.delete(next.id);
			next.callback();
		}
		this.time = target;
	}
}

const deferred = <Value = void>() => {
	let resolve!: (value: Value | PromiseLike<Value>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
};

const flushMicrotasks = async (): Promise<void> => {
	for (let index = 0; index < 8; index++) await Promise.resolve();
};

test('defers serialization, debounces edits, and saves only the latest revision', async () => {
	const timers = new FakeTimers();
	const serialized: Array<[string, number]> = [];
	const written: Array<[string, number]> = [];
	const autosave = createLatestRevisionAutosave({
		debounceMs: 100,
		maxWaitMs: 500,
		timers: timers.api,
		serialize: (value: string, revision) => {
			serialized.push([value, revision]);
			return `saved:${value}`;
		},
		write: (value, revision) => {
			written.push([value, revision]);
		}
	});

	assert.equal(autosave.schedule('one', 1), true);
	assert.deepEqual(serialized, []);
	timers.advanceBy(90);
	assert.equal(autosave.schedule('two', 2), true);
	assert.equal(autosave.schedule('stale', 1), false);
	timers.advanceBy(99);
	assert.deepEqual(serialized, []);

	timers.advanceBy(1);
	await autosave.flush();
	assert.deepEqual(serialized, [['two', 2]]);
	assert.deepEqual(written, [['saved:two', 2]]);
	assert.deepEqual(autosave.getState(), {
		dirty: false,
		saving: false,
		disposed: false,
		latestRevision: 2,
		savedRevision: 2,
		lastError: null
	});
});

test('max-wait flushes the newest continuously debounced revision', async () => {
	const timers = new FakeTimers();
	const written: Array<[string, number]> = [];
	const autosave = createLatestRevisionAutosave({
		debounceMs: 100,
		maxWaitMs: 250,
		timers: timers.api,
		serialize: (value: string) => value,
		write: (value, revision) => {
			written.push([value, revision]);
		}
	});

	autosave.schedule('one', 1);
	timers.advanceBy(90);
	autosave.schedule('two', 2);
	timers.advanceBy(90);
	autosave.schedule('three', 3);
	timers.advanceBy(69);
	assert.deepEqual(written, []);

	timers.advanceBy(1);
	await autosave.flush();
	assert.deepEqual(written, [['three', 3]]);
	assert.equal(autosave.getState().savedRevision, 3);
});

test('allows one write in flight and drains the newest revision immediately afterward', async () => {
	const timers = new FakeTimers();
	const firstWrite = deferred<void>();
	const serializedRevisions: number[] = [];
	const writtenRevisions: number[] = [];
	let concurrentWrites = 0;
	let maxConcurrentWrites = 0;
	const autosave = createLatestRevisionAutosave({
		debounceMs: 10,
		maxWaitMs: 100,
		timers: timers.api,
		serialize: (value: string, revision) => {
			serializedRevisions.push(revision);
			return value;
		},
		write: async (_value, revision) => {
			writtenRevisions.push(revision);
			concurrentWrites++;
			maxConcurrentWrites = Math.max(maxConcurrentWrites, concurrentWrites);
			try {
				if (revision === 1) await firstWrite.promise;
			} finally {
				concurrentWrites--;
			}
		}
	});

	autosave.schedule('one', 1);
	timers.advanceBy(10);
	await flushMicrotasks();
	assert.deepEqual(writtenRevisions, [1]);
	assert.equal(autosave.getState().saving, true);

	autosave.schedule('two', 2);
	autosave.schedule('three', 3);
	timers.advanceBy(10);
	await flushMicrotasks();
	assert.deepEqual(writtenRevisions, [1]);

	firstWrite.resolve();
	await autosave.flush();
	assert.deepEqual(serializedRevisions, [1, 3]);
	assert.deepEqual(writtenRevisions, [1, 3]);
	assert.equal(maxConcurrentWrites, 1);
	assert.equal(autosave.getState().savedRevision, 3);
	assert.equal(autosave.getState().dirty, false);
});

test('flush bypasses timers and persists pending work immediately', async () => {
	const timers = new FakeTimers();
	const written: number[] = [];
	const autosave = createLatestRevisionAutosave({
		debounceMs: 1_000,
		maxWaitMs: 5_000,
		timers: timers.api,
		serialize: (value: number) => value,
		write: (_value, revision) => {
			written.push(revision);
		}
	});

	autosave.schedule(42, 1);
	assert.equal(timers.tasks.size, 2);
	await autosave.flush();
	assert.deepEqual(written, [1]);
	assert.equal(timers.tasks.size, 0);
	assert.equal(autosave.getState().dirty, false);
});

test('remains reusable after a lifecycle flush', async () => {
	const written: Array<[string, number]> = [];
	const autosave = createLatestRevisionAutosave({
		debounceMs: 1_000,
		maxWaitMs: 5_000,
		serialize: (value: string) => value,
		write: (value, revision) => {
			written.push([value, revision]);
		}
	});

	autosave.schedule('before replay cleanup', 1);
	await autosave.flush();
	autosave.schedule('after replay setup', 2);
	await autosave.flush();

	assert.deepEqual(written, [
		['before replay cleanup', 1],
		['after replay setup', 2]
	]);
	assert.equal(autosave.getState().disposed, false);
});

test('retains dirty work after a write failure, reports it, and retries on flush', async () => {
	const timers = new FakeTimers();
	const failure = new Error('disk full');
	const errors: Array<{ error: unknown; phase: string; revision: number }> = [];
	let shouldFail = true;
	const autosave = createLatestRevisionAutosave({
		debounceMs: 100,
		maxWaitMs: 500,
		timers: timers.api,
		serialize: (value: string) => value,
		write: () => {
			if (shouldFail) throw failure;
		},
		onError: (error, context) => errors.push({ error, ...context })
	});

	autosave.schedule('keep me', 7);
	await assert.rejects(autosave.flush(), /disk full/);
	assert.equal(autosave.getState().dirty, true);
	assert.equal(autosave.getState().saving, false);
	assert.equal(autosave.getState().savedRevision, null);
	assert.equal(autosave.getState().latestRevision, 7);
	assert.equal(autosave.getState().lastError, failure);
	assert.deepEqual(errors, [{ error: failure, phase: 'write', revision: 7 }]);

	shouldFail = false;
	await autosave.flush();
	assert.equal(autosave.getState().dirty, false);
	assert.equal(autosave.getState().savedRevision, 7);
	assert.equal(autosave.getState().lastError, null);
});

test('automatically drains a newer revision after an older in-flight write fails', async () => {
	const timers = new FakeTimers();
	const firstWrite = deferred<void>();
	const failure = new Error('older write failed');
	const writes: number[] = [];
	const autosave = createLatestRevisionAutosave({
		debounceMs: 10,
		maxWaitMs: 100,
		timers: timers.api,
		serialize: (value: string) => value,
		write: async (_value, revision) => {
			writes.push(revision);
			if (revision === 1) await firstWrite.promise;
		}
	});

	autosave.schedule('one', 1);
	timers.advanceBy(10);
	await flushMicrotasks();
	autosave.schedule('two', 2);
	timers.advanceBy(10);
	firstWrite.reject(failure);
	await flushMicrotasks();
	await flushMicrotasks();

	assert.deepEqual(writes, [1, 2]);
	assert.equal(autosave.getState().savedRevision, 2);
	assert.equal(autosave.getState().dirty, false);
});

test('retains dirty work and reports serializer failures before any write', async () => {
	const failure = new Error('cannot serialize');
	const errors: Array<{ phase: string; revision: number }> = [];
	let writes = 0;
	const autosave = createLatestRevisionAutosave({
		debounceMs: 100,
		maxWaitMs: 500,
		serialize: () => {
			throw failure;
		},
		write: () => {
			writes++;
		},
		onError: (_error, context) => errors.push(context)
	});

	autosave.schedule('value', 1);
	await assert.rejects(autosave.flush(), /cannot serialize/);
	assert.equal(writes, 0);
	assert.equal(autosave.getState().dirty, true);
	assert.equal(autosave.getState().lastError, failure);
	assert.deepEqual(errors, [{ phase: 'serialize', revision: 1 }]);
	autosave.dispose();
});

test('dispose cancels pending timers, retains dirty state, and ignores later schedules', async () => {
	const timers = new FakeTimers();
	let writes = 0;
	const autosave = createLatestRevisionAutosave({
		debounceMs: 100,
		maxWaitMs: 500,
		timers: timers.api,
		serialize: (value: string) => value,
		write: () => {
			writes++;
		}
	});

	autosave.schedule('pending', 1);
	autosave.dispose();
	assert.equal(timers.tasks.size, 0);
	assert.equal(autosave.schedule('ignored', 2), false);
	timers.advanceBy(1_000);
	await flushMicrotasks();
	await autosave.flush();
	assert.equal(writes, 0);
	assert.equal(autosave.getState().dirty, true);
	assert.equal(autosave.getState().disposed, true);
	assert.equal(autosave.getState().latestRevision, 1);
});
