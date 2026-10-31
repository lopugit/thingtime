import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { randomUUID } from 'node:crypto';
import { AccountAlgorithmSync } from './accountAlgorithms';
import { AccountAlgorithmSelection, type AlgorithmSelectionTransport } from './algorithmSelection';
import { WorkspaceDatabase, WorkspaceError } from './storage';
import type { AlgorithmSelectionWrite } from '../api/utils/algorithms/algorithmSelectionContract';
const version = (n: number) => 'algorithm-selection-v1:' + n.toString(16).padStart(64, '0'),
	scope = { kind: 'account', origin: 'https://selection.example', ownerId: 'owner', dataPlane: 'home' } as const;
function fixture() {
	let now = 1000;
	const db = new WorkspaceDatabase(new IDBFactory()),
		lease = { assertCurrent() {}, onInvalidate: () => () => {} };
	const algorithms = new AccountAlgorithmSync(db, scope, lease, () => now, randomUUID);
	return {
		db,
		lease,
		algorithms,
		selection: algorithms.selection,
		advance() {
			now += 100_000;
		},
		set: (id: string | null) => db.transaction(scope, 'readwrite', lease, (tx) => algorithms.selection.setIn(tx, id))
	};
}
function server() {
	let state = { algorithmId: null as string | null, version: version(1) },
		serial = 1;
	const receipts = new Map<string, any>(),
		calls: AlgorithmSelectionWrite[] = [];
	const transport: AlgorithmSelectionTransport = {
		selection: async () => ({ ...state }),
		select: async (command) => {
			calls.push({ ...command });
			if (receipts.has(command.writeId)) return receipts.get(command.writeId);
			if (state.version !== command.expectedVersion) throw new WorkspaceError('ALGORITHM_SYNC_REFUSED', 'Changed selection', 409);
			state = { algorithmId: command.algorithmId, version: version(++serial) };
			const ack = { ...command, result: { ...state } };
			receipts.set(command.writeId, ack);
			return ack;
		}
	};
	return {
		transport,
		calls,
		current: () => state,
		change(algorithmId: string | null) {
			state = { algorithmId, version: version(++serial) };
		}
	};
}
const ready = async () => true;
test('local applies and clearing finish before account selection and algorithm-creation dependencies', async () => {
	const f = fixture(),
		s = server();
	try {
		await f.selection.refresh(s.transport);
		const algorithm = (await f.algorithms.algorithms.create({ name: 'Device' })).algorithm;
		await f.algorithms.algorithms.setActive(algorithm.id);
		assert.equal((await f.algorithms.list()).activeAlgorithmId, algorithm.id);
		assert.equal(s.calls.length, 0);
		assert.equal((await f.selection.sync(s.transport, async () => false)).completed, 0);
		assert.equal(s.current().algorithmId, null);
		assert.equal((await f.selection.sync(s.transport, ready)).completed, 1);
		assert.equal(s.current().algorithmId, algorithm.id);
		await f.algorithms.algorithms.remove(algorithm.id);
		assert.equal((await f.algorithms.list()).activeAlgorithmId, null);
		assert.equal((await f.selection.status())?.desired, null);
		s.change(null); // The profile deletion transaction already cleared the remote pointer.
		await f.selection.sync(s.transport, ready);
		assert.equal((await f.selection.status())!.state, 'synced');
		assert.equal(s.current().algorithmId, null);
		assert.throws(() => new AccountAlgorithmSelection(f.db, { kind: 'anonymous' } as any, f.lease), /never synchronize/);
	} finally {
		await f.db.close();
	}
});
test('uncertain selected-algorithm writes replay before later desired choices without waiting on their dependencies', async () => {
	const f = fixture(),
		s = server();
	try {
		await f.selection.refresh(s.transport);
		await f.set('first');
		let lost = true;
		const uncertain = {
			...s.transport,
			select: async (command: AlgorithmSelectionWrite, signal: AbortSignal) => {
				const result = await s.transport.select(command, signal);
				if (lost) {
					lost = false;
					throw Error('lost response');
				}
				return result;
			}
		};
		await f.selection.sync(uncertain, ready);
		const frozen = (await f.selection.status())!.pending!.command;
		await f.set('later');
		f.advance();
		await f.selection.sync(s.transport, async () => false);
		assert.equal(s.calls[0].writeId, s.calls[1].writeId);
		assert.equal(s.current().algorithmId, 'first');
		assert.equal((await f.selection.status())!.state, 'pending');
		await f.selection.sync(s.transport, ready);
		assert.equal(s.current().algorithmId, 'later');
		assert.notEqual(s.calls[2].writeId, frozen.writeId);
	} finally {
		await f.db.close();
	}
});
test('concurrent tabs claim one selection while an apply during transmission remains pending', async () => {
	const f = fixture(),
		s = server();
	try {
		await f.selection.refresh(s.transport);
		await f.set('first');
		let enter!: () => void, release!: () => void;
		const started = new Promise<void>((r) => {
				enter = r;
			}),
			held = new Promise<void>((r) => {
				release = r;
			});
		const sending = f.selection.sync(
			{
				...s.transport,
				select: async (c, signal) => {
					enter();
					await held;
					return s.transport.select(c, signal);
				}
			},
			ready
		);
		await started;
		assert.equal((await f.selection.sync(s.transport, ready)).completed, 0);
		await f.set('later');
		release();
		await sending;
		assert.equal((await f.selection.status())!.state, 'pending');
		await f.selection.sync(s.transport, ready);
		assert.equal(s.current().algorithmId, 'later');
	} finally {
		await f.db.close();
	}
});
test('a matching account choice converges while a different choice requires fresh review', async () => {
	const f = fixture(),
		s = server();
	try {
		await f.selection.refresh(s.transport);
		await f.set('same');
		s.change('same');
		await f.selection.sync(s.transport, ready);
		assert.equal((await f.selection.status())!.state, 'synced');
		await f.set('local');
		s.change('other');
		await f.selection.sync(s.transport, ready);
		assert.equal((await f.selection.status())!.state, 'conflict');
		const review = await f.selection.inspect(s.transport);
		await f.set('newer-local');
		await assert.rejects(f.selection.resolve(review, 'remote', s.transport), /device selection changed/);
		const latest = await f.selection.inspect(s.transport);
		await f.selection.resolve(latest, 'local', s.transport);
		await f.selection.sync(s.transport, ready);
		assert.equal(s.current().algorithmId, 'newer-local');
	} finally {
		await f.db.close();
	}
});
test('refresh cannot overwrite an apply and lost remote confirmation remains retryable, never discardable', async () => {
	const f = fixture(),
		s = server();
	try {
		await f.selection.refresh(s.transport);
		const revision = (await f.selection.status())!.revision;
		await f.set('local');
		assert.equal(await f.selection.remember({ algorithmId: 'late', version: version(8) }, revision), false);
		await f.selection.sync(
			{
				...s.transport,
				select: async () => {
					throw new WorkspaceError('WORKSPACE_CHANGED', 'Confirmation retired', 409);
				}
			},
			ready
		);
		assert.equal((await f.selection.status())!.state, 'pending');
		await assert.rejects(f.selection.inspect(s.transport), /not ready/);
		assert.ok((await f.selection.status())!.pending);
		f.advance();
		await f.selection.sync(s.transport, ready);
		assert.equal(s.current().algorithmId, 'local');
	} finally {
		await f.db.close();
	}
});

test('built-in choices need no upload and mutated acknowledgments cannot complete selection', async () => {
	const f = fixture(),
		s = server();
	try {
		await f.selection.refresh(s.transport);
		await f.algorithms.algorithms.setActive('hot');
		assert.equal((await f.selection.sync(s.transport, async () => false)).completed, 1);
		assert.equal(s.current().algorithmId, 'hot');
		await f.set('later');
		await f.selection.sync(
			{
				...s.transport,
				select: async (command) => {
					command.writeId = 'forged';
					return { ...command, result: { algorithmId: command.algorithmId, version: version(9) } };
				}
			},
			ready
		);
		assert.equal((await f.selection.status())!.state, 'pending');
		assert.notEqual((await f.selection.status())!.pending!.command.writeId, 'forged');
		f.advance();
		await f.selection.sync(s.transport, ready);
		assert.equal(s.current().algorithmId, 'later');
	} finally {
		await f.db.close();
	}
});
test('a remote selection read preserves a local choice whose profile has not been uploaded', async () => {
	const f = fixture(),
		s = server();
	try {
		const row = (await f.algorithms.algorithms.create({ name: 'Pending' })).algorithm;
		await f.algorithms.algorithms.setActive(row.id);
		await f.selection.refresh(s.transport);
		assert.equal((await f.algorithms.list()).activeAlgorithmId, row.id);
		assert.equal((await f.selection.sync(s.transport, async () => false)).completed, 0);
		assert.equal((await f.selection.status())!.desired, row.id);
	} finally {
		await f.db.close();
	}
});

test('a vanished remote profile remains available for an unsynchronized device choice', async () => {
	const f = fixture(),
		s = server();
	try {
		const id = randomUUID(),
			stamp = new Date().toISOString();
		await f.algorithms.remember(
			[
				{
					id,
					version: 'algorithm-state-v1:' + 'a'.repeat(64),
					content: { name: 'Retained', emoji: '🧠', weights: { types: {}, tags: {}, authors: {} }, eventCount: 0, lastTrainedAt: null },
					description: '',
					parentId: null,
					shared: false,
					listed: false,
					folderId: null,
					legacy: false,
					createdAt: stamp,
					updatedAt: stamp
				}
			],
			await f.algorithms.beginRead()
		);
		await f.selection.refresh(s.transport);
		await f.algorithms.algorithms.setActive(id);
		await f.algorithms.remember([], await f.algorithms.beginRead());
		const list = await f.algorithms.list();
		assert.equal(list.activeAlgorithmId, id);
		assert.equal(list.algorithms[0].id, id);
		assert.equal((await f.algorithms.status())[0].state, 'conflict');
	} finally {
		await f.db.close();
	}
});
