import assert from 'node:assert/strict';
import test from 'node:test';
import { parseThemeWrite } from '../api/utils/themes/themeSyncContract';
import { accountThemeTransport } from './themeTransport.client';
import { bindLocalWorkspace, accountWorkspaceLease } from './runtime.client';
import { rootIdentity } from '../utils/rootIdentity';
const signal = () => new AbortController().signal;

test('theme transport rejects missing capability, offline authority, partial catalogues and stale identities', async () => {
	const origin = 'https://theme-transport.example',
		scope = { kind: 'account', ownerId: 'owner', origin, dataPlane: 'home' } as const;
	const previous = { window: globalThis.window, fetch: globalThis.fetch },
		calls: { url: string; init: RequestInit }[] = [],
		events: string[] = [];
	let capability = '1.0.0',
		response = Response.json({ ok: true, ownerId: 'owner', dataPlane: 'home', storagePlane: 'home', complete: true, themes: [] }),
		after: (() => void) | undefined;
	Object.assign(globalThis, {
		window: {
			location: { origin },
			dispatchEvent: (event: Event) => {
				events.push(event.type);
				return true;
			}
		},
		fetch: async (url: string, init: RequestInit) => {
			if (url.includes('capabilities'))
				return Response.json({
					schemaVersion: 1,
					origin,
					features: { 'api.themes-sync': { version: capability }, 'api.mongodb-endpoint': { version: '1.1.0' } }
				});
			calls.push({ url, init });
			after?.();
			return response;
		}
	});
	const bind = (confirmed = true) => {
		rootIdentity.confirm(rootIdentity.read().generation);
		bindLocalWorkspace(false, rootIdentity.read().generation, scope, confirmed);
		return accountThemeTransport(scope, accountWorkspaceLease(scope));
	};
	try {
		await assert.rejects(bind(false).snapshot(signal()), /offline/);
		assert.equal(calls.length, 0);
		await assert.rejects(bind().snapshot(signal()));
		assert.equal(calls.length, 0);
		capability = '1.0.1';
		await assert.rejects(bind().selection(signal()));
		assert.equal(calls.length, 0, '1.0.1 cannot authorize selection operations');
		capability = '1.1.0';
		await assert.rejects(bind().snapshot(signal()));
		assert.equal(calls.length, 0, 'snapshots require the complete folder-placement contract');
		capability = '1.2.0';
		assert.deepEqual(await bind().snapshot(signal()), []);
		assert.equal(calls[0].url, '/api/v1/themes/sync');
		assert.equal(calls[0].init.credentials, 'same-origin');
		assert.equal(calls[0].init.redirect, 'error');
		assert.equal(calls[0].init.cache, 'no-store');
		assert.deepEqual(JSON.parse(String(calls[0].init.body)), { operation: 'snapshot', expectedOwnerId: 'owner' });
		assert.equal((calls[0].init.headers as any)['X-Thingtime-Expected-Data-Plane'], 'home');
		const command = parseThemeWrite({
			action: 'save',
			id: '123e4567-e89b-42d3-a456-426614174000',
			writeId: 'fixture-write',
			expectedVersion: null,
			name: 'Peach',
			theme: {},
			visibility: 'private'
		});
		const acknowledgment = {
			id: command.id,
			writeId: command.writeId,
			action: 'save',
			expectedVersion: null,
			resultVersion: 'theme-state-v1:' + 'a'.repeat(64)
		};
		response = Response.json({ ok: true, ownerId: 'owner', dataPlane: 'home', storagePlane: 'home', acknowledgment });
		assert.deepEqual(await bind().write(command, signal()), acknowledgment);
		assert.deepEqual(JSON.parse(String(calls.at(-1)!.init.body)), { operation: 'write', expectedOwnerId: 'owner', command });
		const beforePlacement = calls.length;
		if (command.action !== 'save') throw new Error('Expected a save fixture');
		await assert.rejects(bind().write({ ...command, folderId: null }, signal()), /incompatible/);
		assert.equal(calls.length, beforePlacement, '1.2.0 cannot silently drop imported folder placement');
		capability = '1.3.0';
		response = Response.json({ ok: true, ownerId: 'owner', dataPlane: 'home', storagePlane: 'home', acknowledgment });
		assert.deepEqual(await bind().write({ ...command, folderId: null }, signal()), acknowledgment);

		const selection = { themeId: null, version: 'theme-selection-v1:' + 'a'.repeat(64) };
		response = Response.json({ ok: true, ownerId: 'owner', dataPlane: 'home', storagePlane: 'home', selection });
		assert.deepEqual(await bind().selection(signal()), selection);
		assert.deepEqual(JSON.parse(String(calls.at(-1)!.init.body)), { operation: 'selection', expectedOwnerId: 'owner' });
		const selectionCommand = { themeId: null, expectedVersion: selection.version, writeId: 'select-1' };
		const selectionReceipt = { ...selectionCommand, result: selection };
		response = Response.json({ ok: true, ownerId: 'owner', dataPlane: 'home', storagePlane: 'home', acknowledgment: selectionReceipt });
		assert.deepEqual(await bind().select(selectionCommand, signal()), selectionReceipt);
		assert.deepEqual(JSON.parse(String(calls.at(-1)!.init.body)), { operation: 'select', expectedOwnerId: 'owner', command: selectionCommand });

		capability = '1.2.0';
		response = Response.json({ ok: true, ownerId: 'owner', dataPlane: 'home', storagePlane: 'home', complete: false, themes: [] });
		await assert.rejects(bind().snapshot(signal()), /incomplete/);
		response = Response.json({ ok: true, ownerId: 'owner', dataPlane: 'home', complete: true, themes: [] });
		await assert.rejects(bind().snapshot(signal()), /storage confirmation/);
		response = new Response('private outage details', { status: 503 });
		await assert.rejects(bind().snapshot(signal()), (e: any) => e.status === 503 && !e.message.includes('private outage'));
		response = Response.json({ ok: true, ownerId: 'other', dataPlane: 'home', storagePlane: 'home', complete: true, themes: [] });
		await assert.rejects(bind().snapshot(signal()), /confirmation changed/);
		assert.ok(events.includes('thingtime:root-data-refresh'));
		response = Response.json({ ok: true, ownerId: 'owner', dataPlane: 'home', storagePlane: 'home', complete: true, themes: [] });
		const transport = bind();
		after = () => bindLocalWorkspace(false, rootIdentity.read().generation, scope, false);
		await assert.rejects(transport.snapshot(signal()), /confirmation changed|offline/);
		assert.equal(calls.at(-1)!.init.signal!.aborted, true);
		after = undefined;
		response = Response.json({ ok: false, code: 'DATA_PLANE_CHANGED' }, { status: 409 });
		await assert.rejects(bind().snapshot(signal()), /confirmation changed/);
		response = new Response('x'.repeat(8 * 1024 * 1024 + 1));
		await assert.rejects(bind().snapshot(signal()), /cache limit/);
	} finally {
		Object.assign(globalThis, previous);
		rootIdentity.confirm(rootIdentity.read().generation);
		bindLocalWorkspace(true, rootIdentity.read().generation);
	}
});
