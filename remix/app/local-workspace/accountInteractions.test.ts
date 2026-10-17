import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { AccountInteractionSync, type InteractionTransport } from './accountInteractions';
import { WorkspaceDatabase, WorkspaceError } from './storage';
import { interactionState, interactionWrite, type InteractionState, type InteractionWrite } from '../utils/interactionState';
const scope = { kind: 'account' as const, origin: 'https://example.test', ownerId: 'owner', dataPlane: 'home' },
	lease = { assertCurrent() {}, onInvalidate: () => () => {} };
const initial = (): InteractionState => ({ id: 'target', revision: null, saved: false, reactions: [], reactionCounts: { '❤️': 4 } });
function fixture() {
	const factory = new IDBFactory(),
		db = new WorkspaceDatabase(factory);
	let now = 1000;
	const service = new AccountInteractionSync(db, scope, lease, () => now);
	let remote = initial();
	const writes: InteractionWrite[] = [];
	const transport: InteractionTransport = {
		read: async () => [structuredClone(remote)],
		write: async (raw) => {
			const command = interactionWrite(raw);
			writes.push(structuredClone(command));
			if (command.expectedRevision !== remote.revision) throw new WorkspaceError('CONFLICT', 'Changed', 409);
			if (command.kind === 'save') {
				remote.saved = command.active;
				remote.savedAt = command.active ? new Date(now).toISOString() : null;
			} else {
				const tokens = new Set(remote.reactions),
					had = tokens.has(command.emoji!);
				if (command.active) tokens.add(command.emoji!);
				else tokens.delete(command.emoji!);
				remote.reactions = [...tokens];
				remote.reactionCounts![command.emoji!] = (remote.reactionCounts![command.emoji!] || 0) + Number(command.active) - Number(had);
			}
			remote.revision = randomUUID();
			return structuredClone(remote);
		}
	};
	return {
		factory,
		db,
		service,
		transport,
		writes,
		remote: () => remote,
		advance: () => {
			now += 61_000;
		}
	};
}
test('account membership commits offline, preserves others counts, is scoped, bounded and survives reopening', async () => {
	const h = fixture();
	try {
		assert.throws(() => new AccountInteractionSync(h.db, { kind: 'anonymous' }, lease), /never synchronize/);
		await h.service.remember([initial()]);
		assert.equal((await h.service.toggle('save', 'target')).saved, true);
		assert.equal((await h.service.toggle('reaction', 'target', '❤️')).reactionCounts!['❤️'], 5);
		assert.equal(h.writes.length, 0);
		assert.equal((await h.service.rows()).filter((row) => row.thingtime.includes('save')).length, 1);
		const other = new AccountInteractionSync(h.db, { ...scope, ownerId: 'other' }, lease);
		assert.deepEqual(await other.states(), []);
		await h.service.remember([{ ...initial(), revision: randomUUID(), saved: false }]);
		assert.equal((await h.service.states())[0].saved, true, 'background reads cannot erase pending intent');
		await h.db.close();
		const reopened = new WorkspaceDatabase(h.factory);
		const again = new AccountInteractionSync(reopened, scope, lease);
		assert.equal((await again.states())[0].reactions[0], '❤️');
		await reopened.close();
	} finally {
		await h.db.close();
	}
});
test('lost responses reconcile without replaying toggles and newer edits survive in-flight completion', async () => {
	const h = fixture();
	try {
		await h.service.remember([initial()]);
		await h.service.toggle('save', 'target');
		let release!: () => void, started!: () => void;
		const gate = new Promise<void>((r) => (release = r)),
			start = new Promise<void>((r) => (started = r));
		let first = true;
		const transport = {
			...h.transport,
			write: async (command: InteractionWrite) => {
				const state = await h.transport.write(command);
				if (first) {
					first = false;
					started();
					await gate;
					throw new Error('Response lost');
				}
				return state;
			}
		};
		const run = h.service.sync(transport);
		await start;
		await h.service.toggle('save', 'target');
		await h.service.toggle('reaction', 'target', '❤️');
		release();
		await run;
		assert.equal(h.remote().saved, false);
		assert.deepEqual(h.remote().reactions, ['❤️']);
		assert.equal(h.writes.length, 3);
		assert.deepEqual(
			h.writes.map((x) => x.kind),
			['save', 'save', 'reaction']
		);
		assert.equal((await h.service.status())[0].state, 'synced');
	} finally {
		await h.db.close();
	}
});
test('stale retries conflict instead of overwriting account choices; review is version fenced', async () => {
	const h = fixture();
	try {
		await h.service.remember([initial()]);
		await h.service.toggle('save', 'target');
		h.remote().revision = randomUUID();
		await h.service.sync(h.transport);
		assert.equal(h.remote().saved, false);
		assert.equal((await h.service.status())[0].state, 'conflict');
		assert.equal((await h.service.states())[0].saved, true);
		await assert.rejects(h.service.retry('target'), /Review/);
		const review = await h.service.inspect(h.transport, 'target');
		await h.service.toggle('reaction', 'target', '❤️');
		await assert.rejects(h.service.resolve(h.transport, review, 'local'), /Local interactions changed/);
		const next = await h.service.inspect(h.transport, 'target');
		h.remote().revision = randomUUID();
		await assert.rejects(h.service.resolve(h.transport, next, 'local'), /changed again/);
		const final = await h.service.inspect(h.transport, 'target');
		await h.service.resolve(h.transport, final, 'local');
		await h.service.sync(h.transport);
		assert.equal(h.remote().saved, true);
		assert.deepEqual(h.remote().reactions, ['❤️']);
	} finally {
		await h.db.close();
	}
});
test('two tabs serialize local toggles and only one tab sends a claimed command', async () => {
	const h = fixture(),
		secondDb = new WorkspaceDatabase(h.factory),
		second = new AccountInteractionSync(secondDb, scope, lease);
	try {
		await h.service.remember([initial()]);
		await Promise.all([h.service.toggle('save', 'target'), second.toggle('save', 'target')]);
		assert.equal((await h.service.states())[0].saved, false);
		await Promise.all([h.service.sync(h.transport), second.sync(h.transport)]);
		assert.equal(h.writes.length, 1);
		assert.equal(h.remote().saved, false);
		await h.service.toggle('reaction', 'target', '❤️');
		await Promise.all([h.service.sync(h.transport), second.sync(h.transport)]);
		assert.equal(h.remote().reactionCounts!['❤️'], 5);
	} finally {
		await h.db.close();
		await secondDb.close();
	}
});
test('frozen retries retain the exact revision and permanent refusals stop with visible local intent', async () => {
	const h = fixture();
	try {
		await h.service.remember([initial()]);
		await h.service.toggle('save', 'target');
		const attempted: InteractionWrite[] = [];
		const failing: InteractionTransport = {
			read: async () => {
				throw new Error('Offline');
			},
			write: async (command) => {
				attempted.push(structuredClone(command));
				throw new Error('Offline');
			}
		};
		await h.service.sync(failing);
		h.advance();
		await h.service.sync(failing);
		assert.deepEqual(attempted[0], attempted[1]);
		assert.equal((await h.service.status())[0].state, 'pending');
		h.advance();
		await h.service.sync({
			...failing,
			write: async () => {
				throw new WorkspaceError('DENIED', 'Not allowed', 403);
			}
		});
		assert.equal((await h.service.status())[0].state, 'error');
		assert.equal((await h.service.states())[0].saved, true);
		await h.service.retry('target');
		await h.service.sync(h.transport);
		assert.equal(h.remote().saved, true);
	} finally {
		await h.db.close();
	}
});
test('invalid commands and snapshots fail before storage; late identity retirement cannot commit a remote baseline', async () => {
	for (const value of [
		{ id: 'target', kind: 'save', active: true },
		{ id: 'target', kind: 'save', active: true, expectedRevision: null, ownerId: 'other' },
		{ id: 'target', kind: 'reaction', active: true, expectedRevision: null, emoji: 'not emoji' }
	])
		assert.throws(() => interactionWrite(value));
	assert.throws(() => interactionState({ ...initial(), reactionCounts: { '❤️': -1 } }));
	const h = fixture();
	let retired = false;
	const guarded = {
		assertCurrent() {
			if (retired) throw new Error('Identity retired');
		},
		onInvalidate: () => () => {}
	};
	const service = new AccountInteractionSync(h.db, scope, guarded);
	try {
		await service.toggle('save', 'target');
		await assert.rejects(
			service.sync({
				read: async () => {
					retired = true;
					return [initial()];
				},
				write: async () => {
					throw new Error('must not send');
				}
			}),
			/Identity retired/
		);
		assert.equal(h.writes.length, 0);
	} finally {
		await h.db.close();
	}
});

test('explicit account choice drops only reviewed local intent and a late completion cannot resurrect discarded target state', async () => {
	const h = fixture();
	try {
		await h.service.remember([initial()]);
		await h.service.toggle('save', 'target');
		h.remote().revision = randomUUID();
		await h.service.sync(h.transport);
		const review = await h.service.inspect(h.transport, 'target');
		await h.service.resolve(h.transport, review, 'remote');
		assert.equal((await h.service.states())[0].saved, false);
		assert.equal((await h.service.status())[0].state, 'synced');
		await h.service.toggle('save', 'target');
		let release!: () => void, started!: () => void;
		const gate = new Promise<void>((r) => (release = r)),
			start = new Promise<void>((r) => (started = r));
		const running = h.service.sync({
			...h.transport,
			write: async (command) => {
				const result = await h.transport.write(command);
				started();
				await gate;
				return result;
			}
		});
		await start;
		await h.service.discard(['target']);
		release();
		await running;
		assert.deepEqual(await h.service.status(), []);
	} finally {
		await h.db.close();
	}
});

test('an unversioned visible projection seeds the local toggle without inventing an empty remote baseline', async () => {
	const h = fixture();
	try {
		h.remote().saved = true;
		h.remote().reactions = ['❤️'];
		h.remote().reactionCounts = { '❤️': 5 };
		h.remote().revision = randomUUID();
		await h.service.remember([{ ...initial(), saved: true, reactions: ['❤️'], reactionCounts: { '❤️': 5 } }], false);
		assert.equal((await h.service.toggle('save', 'target')).saved, false);
		assert.equal((await h.service.toggle('reaction', 'target', '❤️')).reactionCounts!['❤️'], 4);
		await h.service.sync(h.transport);
		assert.equal(h.remote().saved, false);
		assert.deepEqual(h.remote().reactions, []);
		assert.equal(h.remote().reactionCounts!['❤️'], 4);
	} finally {
		await h.db.close();
	}
});

test('older read projections cannot roll back newer reads or completed local commands', async () => {
	const h = fixture();
	try {
		await h.service.remember([initial()], true, 10);
		await h.service.remember([initial()], true, 30);
		await h.service.remember([{ ...initial(), saved: true }], false, 20);
		assert.equal((await h.service.states())[0].saved, false);
		await h.service.toggle('save', 'target');
		await h.service.sync(h.transport);
		await h.service.remember([initial()], false, 40);
		await h.service.remember([initial()], false, 1000);
		assert.equal((await h.service.states())[0].saved, true);
		const savedAt = '2026-10-16T00:00:00Z';
		await h.service.remember([{ ...initial(), saved: true, savedAt }], true, 2000);
		await h.service.remember([{ ...initial(), saved: true }], false, 3000);
		assert.equal((await h.service.states())[0].savedAt, savedAt, 'post projections retain known bookmark order');
	} finally {
		await h.db.close();
	}
});
