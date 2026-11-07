import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { accountApi } from './accountApi.client';
import { bindLocalWorkspace, workspaceDatabase } from './runtime.client';
import { rootIdentity } from '../utils/rootIdentity';
import { localTimelineBackend, scopedTimelineStore } from '../timeline/localBackend.client';
import { themeContentValue } from '../timeline/themeContent';
import { algorithmContentValue } from '../timeline/algorithmContent';

test('Home History restores and exports device theme and algorithm edits while a custom plane is selected, with the current account lease', async () => {
	const saved = {
		window: globalThis.window,
		indexedDB: globalThis.indexedDB,
		fetch: globalThis.fetch,
		navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator')
	};
	const target = new EventTarget(),
		factory = new IDBFactory();
	const account = { kind: 'account', ownerId: 'theme-owner', origin: 'https://theme-history.test', dataPlane: 'custom-selected' } as const;
	const home = { ownerId: account.ownerId, apiOrigin: account.origin, dataPlane: 'home' };
	Object.assign(globalThis, {
		indexedDB: factory,
		window: {
			indexedDB: factory,
			location: { origin: account.origin },
			addEventListener: target.addEventListener.bind(target),
			removeEventListener: target.removeEventListener.bind(target),
			dispatchEvent: target.dispatchEvent.bind(target)
		}
	});
	Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
	let requests = 0;
	const remote = async () => {
		requests++;
		throw Error('Unexpected account request');
	};
	globalThis.fetch = remote;
	try {
		bindLocalWorkspace(false, rootIdentity.read().generation, account, false);
		rootIdentity.confirm(rootIdentity.read().generation);
		const selected: any = accountApi({ timeline: { exportVersion: remote, version: remote } }, { id: account.ownerId }, account.dataPlane);
		const homeApi: any = accountApi({ timeline: { exportVersion: remote, version: remote } }, { id: account.ownerId }, account.dataPlane, {
			localPlane: 'home'
		});
		const theme = (await homeApi.themes.save({ name: 'Home device edit', theme: {} })).theme;
		const store = scopedTimelineStore(home),
			[entry] = await store.forThing(theme.id);
		assert.ok(entry, 'Home History must include authored home rows, not only downloaded cache');
		assert.equal(entry.receipt, null);
		assert.equal(entry.event.after?.adapter, 'theme-content');
		assert.equal(selected.timeline.canExportLocally(home), true);
		assert.equal(selected.timeline.canChangeLocally(home), true);
		await homeApi.themes.save({ id: theme.id, name: 'Later home edit', theme: {} });
		const query = { command: 'preview-version', mode: 'restore', eventId: entry.event.id, componentMode: 'recorded' };
		const preview = await selected.timeline.version(home, query);
		const apply = {
			...query,
			command: 'apply-version',
			expectedHeadId: preview.preview.expectedHeadId,
			expectedComponents: preview.preview.components.fingerprint,
			operationId: randomUUID()
		};
		await selected.timeline.version(home, apply);
		assert.equal((await homeApi.themes.list()).themes.find((row: any) => row.id === theme.id).name, 'Home device edit');
		assert.equal(requests, 0, 'Home restore under a selected custom plane is wholly local');
		const algorithm = (await homeApi.algorithms.create({ name: 'Home algorithm' })).algorithm;
		const [algorithmEntry] = await store.forThing(algorithm.id);
		assert.equal(algorithmEntry.event.after?.adapter, 'algorithm-content');
		await homeApi.algorithms.update({ id: algorithm.id, name: 'Later algorithm edit' });
		const algorithmQuery = { command: 'preview-version', mode: 'restore', eventId: algorithmEntry.event.id, componentMode: 'recorded' };
		const algorithmPreview = await selected.timeline.version(home, algorithmQuery);
		await selected.timeline.version(home, {
			...algorithmQuery,
			command: 'apply-version',
			expectedHeadId: algorithmPreview.preview.expectedHeadId,
			expectedComponents: algorithmPreview.preview.components.fingerprint,
			operationId: randomUUID()
		});
		assert.equal((await homeApi.algorithms.list()).algorithms.find((row: any) => row.id === algorithm.id).name, 'Home algorithm');
		const algorithmExport = await selected.timeline.exportVersion(home, algorithmEntry.event.id);
		assert.equal(algorithmContentValue(algorithmExport.export.content).crystal.name, 'Home algorithm');
		assert.equal(requests, 0, 'Protected Home History writes stay local under the custom-plane lease');

		const result = await selected.timeline.exportVersion(home, entry.event.id);
		assert.equal(themeContentValue(result.export.content).crystal.name, 'Home device edit');
		assert.equal(result.export.receipt, null);
		assert.equal(requests, 0);
		for (const other of [
			{ ...home, ownerId: 'other' },
			{ ...home, apiOrigin: 'https://other.test' },
			{ ...home, dataPlane: 'custom-unselected' }
		]) {
			assert.equal(selected.timeline.canExportLocally(other), false);
			assert.equal(selected.timeline.canChangeLocally(other), false);
			assert.deepEqual(await scopedTimelineStore(other).forThing(theme.id), []);
			await assert.rejects(selected.timeline.exportVersion(other, entry.event.id), /offline/);
		}
		bindLocalWorkspace(false, rootIdentity.read().generation, { ...account, dataPlane: 'custom-next' }, false);
		await assert.rejects(store.forThing(theme.id), /workspace changed/i);
		await assert.rejects(selected.timeline.exportVersion(home, entry.event.id), /workspace changed/i);
		assert.throws(result.assertAvailable, /workspace changed/i);
		assert.equal((await scopedTimelineStore(home).forThing(theme.id)).length, 3, 'new selection can reacquire the same owner home partition');
		rootIdentity.changed();
		bindLocalWorkspace(true, rootIdentity.read().generation);
		assert.deepEqual(await scopedTimelineStore(home).forThing(theme.id), []);
		assert.equal(requests, 0);
	} finally {
		rootIdentity.changed();
		await localTimelineBackend().close();
		await workspaceDatabase().close();
		Object.assign(globalThis, { window: saved.window, indexedDB: saved.indexedDB, fetch: saved.fetch });
		if (saved.navigator) Object.defineProperty(globalThis, 'navigator', saved.navigator);
		else Reflect.deleteProperty(globalThis, 'navigator');
	}
});
