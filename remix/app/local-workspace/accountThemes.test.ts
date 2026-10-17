import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { randomUUID } from 'node:crypto';
import { AccountThemeSync, parseAccountThemeSnapshot, type AccountThemeTransport, type AccountThemeSnapshot } from './accountThemes';
import { WorkspaceDatabase, WorkspaceError, type WorkspaceScope } from './storage';
import { LocalThemes } from './themes';
import { LocalThings } from './things';
import { normalizeSavedTheme } from '../theme/savedTheme';
import type { ThemeWrite, ThemeWriteAcknowledgment } from '../api/utils/themes/themeSyncContract';
const scope = { kind: 'account', origin: 'https://fixture.example', ownerId: 'owner', dataPlane: 'home' } as const;
const version = (n: number) => 'theme-state-v1:' + n.toString(16).padStart(64, '0');
const saved = (id: string = randomUUID(), n = 1): AccountThemeSnapshot => ({
	id,
	name: 'Peach',
	theme: (normalizeSavedTheme({ name: 'Peach', theme: { colors: { accent: '#bb8866' } } }) as any).theme,
	visibility: 'private',
	folderId: null,
	version: version(n),
	createdAt: '2026-10-17T00:00:00.000Z',
	updatedAt: '2026-10-17T00:00:00.000Z'
});
function fixture() {
	let now = 1000,
		live = true;
	const callbacks = new Set<() => void>();
	const db = new WorkspaceDatabase(new IDBFactory());
	const lease = {
		assertCurrent() {
			if (!live) throw new WorkspaceError('WORKSPACE_CHANGED', 'Changed account', 409);
		},
		onInvalidate(cb: () => void) {
			callbacks.add(cb);
			return () => {
				callbacks.delete(cb);
			};
		}
	};
	return {
		db,
		lease,
		sync: new AccountThemeSync(db, scope, lease, () => now, randomUUID),
		advance() {
			now += 100_000;
		},
		retire() {
			live = false;
			callbacks.forEach((cb) => cb());
		}
	};
}
function server(initial: AccountThemeSnapshot[] = []) {
	let serial = initial.length + 1;
	const rows = new Map(initial.map((row) => [row.id, row])),
		receipts = new Map<string, { body: string; ack: ThemeWriteAcknowledgment }>(),
		calls: ThemeWrite[] = [];
	const transport: AccountThemeTransport = {
		snapshot: async () => [...rows.values()],
		write: async (command) => {
			calls.push(structuredClone(command));
			const prior = receipts.get(command.writeId);
			if (prior) {
				assert.equal(prior.body, JSON.stringify(command));
				return prior.ack;
			}
			const before = rows.get(command.id);
			if ((before?.version ?? null) !== command.expectedVersion) throw new WorkspaceError('CONFLICT', 'Changed theme', 409);
			const resultVersion = command.action === 'save' ? version(++serial) : null;
			if (command.action === 'save')
				rows.set(command.id, {
					...saved(command.id),
					name: command.name,
					theme: command.theme as any,
					visibility: command.visibility,
					version: resultVersion!
				});
			else rows.delete(command.id);
			const ack = { id: command.id, writeId: command.writeId, action: command.action, expectedVersion: command.expectedVersion, resultVersion };
			receipts.set(command.writeId, { body: JSON.stringify(command), ack });
			return ack;
		}
	};
	return { rows, calls, transport };
}

test('account themes reuse local validation and export without remote authority or anonymous adoption', async () => {
	const f = fixture();
	try {
		const anon = new LocalThemes(f.db, f.lease),
			a = (await anon.save({ name: 'Anonymous', theme: {} })).theme;
		const first = (await f.sync.save({ name: 'Account', theme: { colors: { accent: '#bb8866' } }, visibility: 'private' })).theme;
		assert.ok(!first.id.startsWith('local-'));
		assert.equal(first.syncState, 'pending');
		assert.equal((await f.sync.list()).themes.length, 1);
		assert.equal((await anon.list()).themes[0].id, a.id);
		await f.sync.setActive(first.id);
		assert.equal((await f.sync.list()).activeThemeId, first.id);
		const things = new LocalThings(f.db, scope, f.lease);
		await assert.rejects(things.update({ id: first.id, crystal: { name: 'Bypass' } }), /dedicated/);
		const archive = await things.export([first.id]);
		const json = JSON.stringify(archive.manifest);
		assert.ok(!json.includes('baseVersion') && !json.includes('visibility'));
		await assert.rejects(f.sync.save({ id: first.id, name: 'Bad', theme: {}, visibility: 'invalid' }), /visibility/);
		assert.equal((await f.sync.list()).themes[0].name, 'Account');
		await f.sync.remove(first.id);
		assert.equal((await f.sync.status()).length, 0);
		assert.equal((await f.sync.list()).activeThemeId, null);
		assert.throws(() => new AccountThemeSync(f.db, { kind: 'anonymous' } as any, f.lease), /never synchronize/);
	} finally {
		await f.db.close();
	}
});

test('complete snapshots are scoped, validated atomically and fenced against local or newer reads', async () => {
	const f = fixture(),
		remote = saved(),
		s = server([remote]);
	try {
		await f.sync.refresh(s.transport);
		const before = (await f.sync.list()).themes[0];
		const stale = await f.sync.beginRead();
		await f.sync.save({ id: remote.id, name: 'Device edit', theme: before.theme, expectedUpdatedAt: before.updatedAt });
		assert.equal(await f.sync.remember([], stale), false);
		assert.equal((await f.sync.list()).themes[0].name, 'Device edit');
		const older = await f.sync.beginRead(),
			newer = await f.sync.beginRead();
		assert.equal(await f.sync.remember([remote], older), false);
		await f.sync.remember([remote], newer);
		assert.equal((await f.sync.list()).themes[0].name, 'Device edit');
		await assert.rejects(f.sync.remember([remote, remote], await f.sync.beginRead()), /Invalid/);
		const other = new AccountThemeSync(f.db, { ...scope, ownerId: 'other' }, f.lease);
		assert.deepEqual((await other.list()).themes, []);
		for (const bad of [null, {}, [{ ...remote, version: 'wrong' }], [{ ...remote, id: 'timeline-forged' }], ...[undefined, '', '../folder', 4, {}].map(folderId => [{...remote, folderId}])])
			assert.throws(() => parseAccountThemeSnapshot(bad));
	} finally {
		await f.db.close();
	}
});

test('lost create replies retain an immutable command while later local changes queue independently', async () => {
	const f = fixture(),
		s = server();
	try {
		const row = (await f.sync.save({ name: 'First', theme: {} })).theme;
		let lost = true;
		const transport = {
			...s.transport,
			write: async (command: ThemeWrite, signal: AbortSignal) => {
				const ack = await s.transport.write(command, signal);
				if (lost) {
					lost = false;
					throw Error('lost reply');
				}
				return ack;
			}
		};
		await f.sync.sync(transport);
		const frozen = (await f.sync.status())[0].pending!.command;
		await f.sync.save({ id: row.id, name: 'Second', theme: {} });
		assert.deepEqual((await f.sync.status())[0].pending!.command, frozen);
		f.advance();
		await f.sync.sync(transport);
		assert.equal(s.calls[0].writeId, s.calls[1].writeId);
		assert.notEqual(s.calls[2].writeId, frozen.writeId);
		assert.equal(s.rows.get(row.id)?.name, 'Second');
		assert.equal((await f.sync.status())[0].state, 'synced');
		assert.equal((await f.sync.list()).themes[0].name, 'Second');
	} finally {
		await f.db.close();
	}
});

test('delete following an uncertain create replays creation then deletion without resurrection', async () => {
	const f = fixture(),
		s = server();
	try {
		const row = (await f.sync.save({ name: 'Remove later', theme: {} })).theme;
		await f.sync.sync({
			...s.transport,
			write: async (c, signal) => {
				await s.transport.write(c, signal);
				throw Error('lost');
			}
		});
		await f.sync.remove(row.id);
		assert.equal((await f.sync.list()).themes.length, 0);
		assert.equal((await f.sync.status())[0].pending?.command.action, 'save');
		f.advance();
		await f.sync.sync(s.transport);
		assert.equal(s.rows.size, 0);
		assert.equal((await f.sync.status())[0].state, 'synced');
		assert.equal((await f.sync.status())[0].deleted, true);
		assert.deepEqual(
			s.calls.map((x) => x.action),
			['save', 'save', 'delete']
		);
	} finally {
		await f.db.close();
	}
});

test('concurrent tabs claim one frozen write and edits during transmission survive its acknowledgment', async () => {
	const f = fixture(),
		s = server();
	try {
		const other = new AccountThemeSync(f.db, scope, f.lease, () => 1000, randomUUID);
		const row = (await f.sync.save({ name: 'Initial', theme: {} })).theme;
		let release!: () => void, started!: () => void;
		const barrier = new Promise<void>((r) => {
				release = r;
			}),
			entered = new Promise<void>((r) => {
				started = r;
			});
		const transport = {
			...s.transport,
			write: async (c: ThemeWrite, signal: AbortSignal) => {
				started();
				await barrier;
				return s.transport.write(c, signal);
			}
		};
		const pass = f.sync.sync(transport, undefined, 1);
		await entered;
		assert.equal((await other.sync(s.transport)).completed, 0);
		await other.save({ id: row.id, name: 'While sending', theme: {} });
		release();
		await pass;
		assert.equal((await f.sync.status())[0].state, 'pending');
		await other.sync(s.transport);
		assert.equal(s.rows.get(row.id)?.name, 'While sending');
		assert.equal((await f.sync.status())[0].state, 'synced');
	} finally {
		await f.db.close();
	}
});

test('stale remote writes require exact review and never erase newer local edits', async () => {
	const f = fixture(),
		remote = saved(),
		s = server([remote]);
	try {
		await f.sync.refresh(s.transport);
		await f.sync.save({ id: remote.id, name: 'Local edit', theme: {} });
		s.rows.set(remote.id, { ...remote, name: 'Remote edit', version: version(9) });
		await f.sync.sync(s.transport);
		assert.equal((await f.sync.status())[0].state, 'conflict');
		await assert.rejects(f.sync.retry(remote.id), /Review/);
		const review = await f.sync.inspect(remote.id, s.transport);
		await f.sync.save({ id: remote.id, name: 'Newer local', theme: {} });
		await assert.rejects(f.sync.resolve(review, 'remote', s.transport), /Device theme changed/);
		const fresh = await f.sync.inspect(remote.id, s.transport);
		s.rows.set(remote.id, { ...remote, name: 'Newer account', version: version(10) });
		await assert.rejects(f.sync.resolve(fresh, 'local', s.transport), /Account theme changed again/);
		const latest = await f.sync.inspect(remote.id, s.transport);
		await f.sync.resolve(latest, 'local', s.transport);
		await f.sync.sync(s.transport);
		assert.equal(s.rows.get(remote.id)?.name, 'Newer local');
		assert.equal((await f.sync.status())[0].state, 'synced');
	} finally {
		await f.db.close();
	}
});

test('unknown outcomes cannot be reviewed away and retired identities cannot retain late snapshots', async () => {
	const f = fixture(),
		s = server();
	try {
		const row = (await f.sync.save({ name: 'Uncertain', theme: {} })).theme;
		await f.sync.sync({
			...s.transport,
			write: async () => {
				throw Error('network');
			}
		});
		await assert.rejects(f.sync.inspect(row.id, s.transport), /not ready/);
		let release!: (value: AccountThemeSnapshot[]) => void;
		let started!: () => void;
		const entered = new Promise<void>(resolve => { started = resolve; });
		const delayed = f.sync.refresh({
			...s.transport,
			snapshot: () =>
				new Promise((resolve) => {
					release = resolve;
					started();
				})
		});
		await entered;
		f.retire();
		release([saved()]);
		await assert.rejects(delayed, /Changed account/);
		const live = { assertCurrent() {}, onInvalidate: () => () => {} };
		const stored = new AccountThemeSync(f.db, scope, live);
		assert.equal((await stored.list()).themes.length, 1);
		assert.equal((await stored.list()).themes[0].id, row.id);
	} finally {
		await f.db.close();
	}
});

test('reviewed copies keep the account original and remap a deleted source to an independent private theme', async () => {
	const f = fixture(),
		remote = saved(),
		s = server([remote]);
	try {
		await f.sync.refresh(s.transport);
		await f.sync.save({ id: remote.id, name: 'Device variant', theme: {} });
		await f.sync.setActive(remote.id);
		s.rows.set(remote.id, { ...remote, name: 'Account original', version: version(20) });
		await f.sync.sync(s.transport);
		const review = await f.sync.inspect(remote.id, s.transport),
			choice = await f.sync.resolve(review, 'copy', s.transport);
		assert.ok(choice.copyId);
		assert.equal((await f.sync.list()).activeThemeId, choice.copyId);
 assert.equal((await f.sync.selection.status())?.desired, choice.copyId);
		await f.sync.sync(s.transport);
		assert.equal(s.rows.get(remote.id)?.name, 'Account original');
		assert.equal(s.rows.get(choice.copyId!)?.visibility, 'private');
		assert.match(s.rows.get(choice.copyId!)?.name ?? '', /Device variant/);
		const copy = (await f.sync.list()).themes.find((x) => x.id === choice.copyId)!;
		await f.sync.save({ id: copy.id, name: 'Deleted source variant', theme: {} });
		s.rows.delete(copy.id);
		await f.sync.sync(s.transport);
		const deletion = await f.sync.inspect(copy.id, s.transport),
			kept = await f.sync.resolve(deletion, 'local', s.transport);
		assert.notEqual(kept.copyId, copy.id);
		await f.sync.sync(s.transport);
		assert.ok(!s.rows.has(copy.id));
		assert.ok(s.rows.has(kept.copyId!));
	} finally {
		await f.db.close();
	}
});

test('workspace quota failure rolls back theme content and its queued operation together', async () => {
	const f = fixture();
	try {
		await f.db.transaction(scope, 'readwrite', f.lease, async (tx) => {
			for (let i = 0; i < 64; i++) await tx.put('fixture-padding', String(i), 'x'.repeat(1024 * 1024 - 16));
		});
		await assert.rejects(f.sync.save({ name: 'Full workspace', theme: {} }), /full/);
		assert.equal((await f.sync.status()).length, 0);
		assert.equal((await f.sync.list()).themes.length, 0);
	} finally {
		await f.db.close();
	}
});
