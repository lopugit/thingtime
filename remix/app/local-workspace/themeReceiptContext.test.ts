import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { randomUUID } from 'node:crypto';
import { AccountThemeSync, type AccountThemeTransport } from './accountThemes';
import { type ThemeSelectionTransport } from './themeSelection';
import { WorkspaceDatabase } from './storage';
const scope = { kind: 'account', ownerId: 'owner', origin: 'https://receipt.example', dataPlane: 'custom-' + 'a'.repeat(64) } as const;
const original = 'custom-' + 'b'.repeat(64);
const lease = { assertCurrent() {}, onInvalidate: () => () => {} };

test('theme retry retains original receipt plane and immutable command after later local editing', async () => {
	for (const restoredPlane of [undefined, original, 'home']) {
		const db = new WorkspaceDatabase(new IDBFactory());
		let now = 1000;
		const themes = new AccountThemeSync(db, scope, lease, () => now, randomUUID);
		const calls: { command: unknown; plane: unknown }[] = [];
		const transport: AccountThemeTransport = {
			snapshot: async () => [],
			write: async (command, _signal, plane) => {
				calls.push({ command, plane });
				throw Error('Lost response');
			}
		};
		try {
			const theme = (await themes.save({ name: 'First', theme: {} })).theme;
			await themes.sync(transport);
			assert.equal(calls[0].plane, 'home');
			const frozen = (await themes.status())[0].pending!.command;
			await db.transaction(scope, 'readwrite', lease, async (tx) => {
				const state = await tx.get<any>('account-theme-sync', theme.id);
				if (restoredPlane === undefined) delete state.pending.receiptPlane;
				else state.pending.receiptPlane = restoredPlane;
				await tx.put('account-theme-sync', theme.id, state);
			});
			await themes.save({ id: theme.id, name: 'Later local edit', theme: {} });
			now += 100_000;
			await themes.sync(transport);
			assert.equal(calls.length, 2);
			assert.deepEqual(calls[1].command, frozen);
			assert.equal(calls[1].plane, restoredPlane ?? scope.dataPlane);
			assert.equal((await themes.list()).themes[0].name, 'Later local edit');
			assert.deepEqual((await themes.status())[0].pending!.command, frozen);
		} finally {
			await db.close();
		}
	}
});

test('selection retry preserves legacy receipt plane while later choice completes locally', async () => {
	for (const restoredPlane of [undefined, original, 'home']) {
		const db = new WorkspaceDatabase(new IDBFactory());
		let now = 1000;
		const themes = new AccountThemeSync(db, scope, lease, () => now, randomUUID),
			selection = themes.selection;
		const calls: { command: unknown; plane: unknown }[] = [];
		const transport: ThemeSelectionTransport = {
			selection: async () => ({ themeId: null, version: 'theme-selection-v1:' + 'a'.repeat(64) }),
			select: async (command, _signal, plane) => {
				calls.push({ command, plane });
				throw Error('Lost response');
			}
		};
		const set = (id: string) => db.transaction(scope, 'readwrite', lease, (tx) => selection.setIn(tx, id));
		try {
			await selection.refresh(transport);
			await set('first');
			await selection.sync(transport, async () => true);
			assert.equal(calls[0].plane, 'home');
			const frozen = (await selection.status())!.pending!.command;
			await db.transaction(scope, 'readwrite', lease, async (tx) => {
				const state = await tx.get<any>('settings', 'account-theme-selection');
				if (restoredPlane === undefined) delete state.pending.receiptPlane;
				else state.pending.receiptPlane = restoredPlane;
				await tx.put('settings', 'account-theme-selection', state);
			});
			await set('later');
			now += 100_000;
			await selection.sync(transport, async () => false);
			assert.equal(calls.length, 2);
			assert.deepEqual(calls[1].command, frozen);
			assert.equal(calls[1].plane, restoredPlane ?? scope.dataPlane);
			assert.equal((await selection.status())!.desired, 'later');
		} finally {
			await db.close();
		}
	}
});
