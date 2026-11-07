import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { randomUUID } from 'node:crypto';
import { AccountThemeSync } from './accountThemes';
import { AccountThemeSelection, type ThemeSelectionTransport } from './themeSelection';
import { WorkspaceDatabase, WorkspaceError } from './storage';
import type { ThemeSelectionWrite } from '../api/utils/themes/themeSelectionContract';
const version = (n: number) => 'theme-selection-v1:' + n.toString(16).padStart(64, '0'),
	scope = { kind: 'account', origin: 'https://selection.example', ownerId: 'owner', dataPlane: 'home' } as const;
function fixture() {
	let now = 1000;
	const db = new WorkspaceDatabase(new IDBFactory()),
		lease = { assertCurrent() {}, onInvalidate: () => () => {} };
	const themes = new AccountThemeSync(db, scope, lease, () => now, randomUUID);
	return {
		db,
		lease,
		themes,
		selection: themes.selection,
		advance() {
			now += 100_000;
		},
		set: (id: string | null) => db.transaction(scope, 'readwrite', lease, (tx) => themes.selection.setIn(tx, id))
	};
}
function server() {
	let state = { themeId: null as string | null, version: version(1) },
		serial = 1;
	const receipts = new Map<string, any>(),
		calls: ThemeSelectionWrite[] = [];
	const transport: ThemeSelectionTransport = {
		selection: async () => ({ ...state }),
		select: async (command) => {
			calls.push({ ...command });
			if (receipts.has(command.writeId)) return receipts.get(command.writeId);
			if (state.version !== command.expectedVersion) throw new WorkspaceError('THEME_SYNC_REFUSED', 'Changed selection', 409);
			state = { themeId: command.themeId, version: version(++serial) };
			const ack = { ...command, result: { ...state } };
			receipts.set(command.writeId, ack);
			return ack;
		}
	};
	return {
		transport,
		calls,
		current: () => state,
		change(themeId: string | null) {
			state = { themeId, version: version(++serial) };
		}
	};
}
const ready = async () => true;
test('local applies and clearing finish before account selection and theme-creation dependencies', async () => {
	const f = fixture(),
		s = server();
	try {
		await f.selection.refresh(s.transport);
		const theme = (await f.themes.save({ name: 'Device', theme: {} })).theme;
		await f.themes.setActive(theme.id);
		assert.equal((await f.themes.list()).activeThemeId, theme.id);
		assert.equal(s.calls.length, 0);
		assert.equal((await f.selection.sync(s.transport, async () => false)).completed, 0);
		assert.equal(s.current().themeId, null);
		assert.equal((await f.selection.sync(s.transport, ready)).completed, 1);
		assert.equal(s.current().themeId, theme.id);
		await f.themes.remove(theme.id);
		assert.equal((await f.themes.list()).activeThemeId, null);
		assert.equal((await f.selection.status())?.desired, null);
		await f.selection.sync(s.transport, ready);
		assert.equal(s.current().themeId, null);
		assert.throws(() => new AccountThemeSelection(f.db, { kind: 'anonymous' } as any, f.lease), /never synchronize/);
	} finally {
		await f.db.close();
	}
});
test('uncertain selected-theme writes replay before later desired choices without waiting on their dependencies', async () => {
	const f = fixture(),
		s = server();
	try {
		await f.selection.refresh(s.transport);
		await f.set('first');
		let lost = true;
		const uncertain = {
			...s.transport,
			select: async (command: ThemeSelectionWrite, signal: AbortSignal) => {
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
		assert.equal(s.current().themeId, 'first');
		assert.equal((await f.selection.status())!.state, 'pending');
		await f.selection.sync(s.transport, ready);
		assert.equal(s.current().themeId, 'later');
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
		assert.equal(s.current().themeId, 'later');
	} finally {
		await f.db.close();
	}
});
test('current equal desired state converges but changed account choice requires exact review', async () => {
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
		assert.equal(s.current().themeId, 'newer-local');
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
		assert.equal(await f.selection.remember({ themeId: 'late', version: version(8) }, revision), false);
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
		assert.equal(s.current().themeId, 'local');
	} finally {
		await f.db.close();
	}
});
