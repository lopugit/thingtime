import assert from 'node:assert/strict';
import test from 'node:test';
import { requireThingtimeCapability } from '../api/utils/capabilities/requireCapability.client';
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
		capability = '1.3.0';
		await assert.rejects(bind().snapshot(signal()), /incompatible/);
		assert.equal(calls.length,0,'older snapshots cannot silently omit titles');
		capability = '1.4.0';
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
			expectedVersion: 'theme-state-v1:' + 'b'.repeat(64),
			name: 'Peach',
			theme: {},
			visibility: 'private'
		});
		if (command.action !== 'save') throw new Error('Expected a save fixture');
		// Model a historical stored payload: normalization now supplies focus defaults,
		// while these compatibility checks intentionally exercise older field sets.
		for (const key of ['focusBorder', 'focusGlowStart', 'focusGlowEnd']) Reflect.deleteProperty(command.theme.colors, key);
		for (const key of ['focusGlowBlur', 'focusGlowOpacity']) Reflect.deleteProperty(command.theme.general, key);
		const acknowledgment = {
			id: command.id,
			writeId: command.writeId,
			action: 'save',
			expectedVersion: command.expectedVersion,
			resultVersion: 'theme-state-v1:' + 'a'.repeat(64)
		};
		const creation = { ...command, expectedVersion: null };
		const creationAck = { ...acknowledgment, expectedVersion: null };
		const beforeCreation = calls.length;
		await assert.rejects(bind().write(creation, signal()), /incompatible/);
		assert.equal(calls.length, beforeCreation, 'older contracts reject new theme admission before sending');
		capability = '1.7.0';
		await assert.rejects(bind().write(creation, signal()), /incompatible/);
		assert.equal(calls.length, beforeCreation, 'streaming catalogues alone do not authorize unlimited creation');
		capability = '1.8.0';
		response = Response.json({ ok: true, ownerId: 'owner', dataPlane: 'home', storagePlane: 'home', acknowledgment: creationAck });
		assert.deepEqual(await bind().write(creation, signal()), creationAck);
		await assert.rejects(requireThingtimeCapability('test-refresh', '1.0.0'));
		capability = '1.4.0';
		response = Response.json({ ok: true, ownerId: 'owner', dataPlane: 'home', storagePlane: 'home', acknowledgment });
		assert.deepEqual(await bind().write(command, signal()), acknowledgment);
		assert.deepEqual(JSON.parse(String(calls.at(-1)!.init.body)), { operation: 'write', expectedOwnerId: 'owner', command: parseThemeWrite(command) });
		assert.deepEqual(JSON.parse(String(calls.at(-1)!.init.body)).command, command, 'Transport must preserve an already frozen legacy command without adding focus defaults');
		for (const [section, key, value] of [
			['colors', 'focusBorder', '#123456'], ['colors', 'focusGlowStart', '#234567'], ['colors', 'focusGlowEnd', '#345678'],
			['general', 'focusGlowBlur', 0], ['general', 'focusGlowOpacity', 0]
		] as const) {
			await assert.rejects(requireThingtimeCapability('test-refresh', '1.0.0'));
			capability = '1.7.0';
			const focused = { ...command, theme: { ...command.theme, [section]: { ...command.theme[section], [key]: value } } };
			const beforeFocus = calls.length;
			await assert.rejects(bind().write(focused, signal()), /incompatible/);
			assert.equal(calls.length, beforeFocus, `${key} cannot be silently lost on an older host`);
			capability = '1.8.0';
			response = Response.json({ ok: true, ownerId: 'owner', dataPlane: 'home', storagePlane: 'home', acknowledgment });
			assert.deepEqual(await bind().write(focused, signal()), acknowledgment);
			assert.equal(JSON.parse(String(calls.at(-1)!.init.body)).command.theme[section][key], value);
		}
		const beforePlacement = calls.length;
		await assert.rejects(requireThingtimeCapability('api.themes-sync','2.0.0'));
		capability = '1.2.0';
		if (command.action !== 'save') throw new Error('Expected a save fixture');
		await assert.rejects(bind().write({ ...command, folderId: null }, signal()), /incompatible/);
		assert.equal(calls.length, beforePlacement, '1.2.0 cannot silently drop imported folder placement');
		capability = '1.3.0';
		response = Response.json({ ok: true, ownerId: 'owner', dataPlane: 'home', storagePlane: 'home', acknowledgment });
		assert.deepEqual(await bind().write({ ...command, folderId: null }, signal()), acknowledgment);

		await assert.rejects(bind().write({...command,title:'Display label'},signal()),/incompatible/);
		capability='1.4.0';
		response=Response.json({ok:true,ownerId:'owner',dataPlane:'home',storagePlane:'home',acknowledgment});
		assert.deepEqual(await bind().write({...command,title:'Display label'},signal()),acknowledgment);

		const selection = { themeId: null, version: 'theme-selection-v1:' + 'a'.repeat(64) };
		response = Response.json({ ok: true, ownerId: 'owner', dataPlane: 'home', storagePlane: 'home', selection });
		assert.deepEqual(await bind().selection(signal()), selection);
		assert.deepEqual(JSON.parse(String(calls.at(-1)!.init.body)), { operation: 'selection', expectedOwnerId: 'owner' });
		const selectionCommand = { themeId: null, expectedVersion: selection.version, writeId: 'select-1' };
		const selectionReceipt = { ...selectionCommand, result: selection };
		response = Response.json({ ok: true, ownerId: 'owner', dataPlane: 'home', storagePlane: 'home', acknowledgment: selectionReceipt });
		assert.deepEqual(await bind().select(selectionCommand, signal()), selectionReceipt);
		assert.deepEqual(JSON.parse(String(calls.at(-1)!.init.body)), { operation: 'select', expectedOwnerId: 'owner', command: selectionCommand });

		capability = '1.4.0';
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


test('home receipts negotiate their contract while requests retain the current selected-plane fence',async()=>{
 const origin='https://theme-home-transport.example', selected='custom-'+'a'.repeat(64), original='custom-'+'b'.repeat(64);
 const scope={kind:'account',ownerId:'owner',origin,dataPlane:selected} as const;
 const previous={window:globalThis.window,fetch:globalThis.fetch};
 const calls:RequestInit[]=[];
 let capability='1.4.0';
 const command=parseThemeWrite({action:'save',id:'123e4567-e89b-42d3-a456-426614174000',writeId:'receipt-context',expectedVersion:'theme-state-v1:'+'b'.repeat(64),name:'Peach',theme:{},visibility:'private'});
 if(command.action!=='save') throw new Error('Expected save fixture');
 for(const key of ['focusBorder','focusGlowStart','focusGlowEnd']) Reflect.deleteProperty(command.theme.colors,key);
 for(const key of ['focusGlowBlur','focusGlowOpacity']) Reflect.deleteProperty(command.theme.general,key);
 const acknowledgment={id:command.id,writeId:command.writeId,action:'save',expectedVersion:command.expectedVersion,resultVersion:'theme-state-v1:'+'a'.repeat(64)};
 Object.assign(globalThis,{window:{location:{origin},dispatchEvent:()=>true},fetch:async(url:string,init:RequestInit)=>{
  if(url.includes('capabilities')) return Response.json({schemaVersion:1,origin,features:{'api.themes-sync':{version:capability},'api.mongodb-endpoint':{version:'1.1.0'}}});
  calls.push(init);return Response.json({ok:true,ownerId:'owner',dataPlane:selected,storagePlane:'home',acknowledgment});
 }});
 const bind=(confirmed=true)=>{
  rootIdentity.confirm(rootIdentity.read().generation);bindLocalWorkspace(false,rootIdentity.read().generation,scope,confirmed);
  return accountThemeTransport(scope,accountWorkspaceLease(scope));
 };
 try {
  await assert.rejects(bind().write(command,signal(),'home'),/incompatible/);assert.equal(calls.length,0);
  capability='1.5.0';
  for(const receiptPlane of ['home',original]) {
   assert.deepEqual(await bind().write(command,signal(),receiptPlane),acknowledgment);
   const sent=calls.at(-1)!;
   assert.equal((sent.headers as any)['X-Thingtime-Expected-Data-Plane'],selected);
   assert.equal((sent.headers as any)['X-Thingtime-Expected-Actor'],'owner');
   assert.deepEqual(JSON.parse(String(sent.body)),{operation:'write',expectedOwnerId:'owner',command:parseThemeWrite(command),context:{storagePlane:'home',receiptPlane}});
  }
  const count=calls.length;
  await assert.rejects(bind().write(command,signal(),'https://elsewhere.example'),/Invalid home theme context/);
  await assert.rejects(bind(false).write(command,signal(),'home'),/offline/);
  rootIdentity.confirm(rootIdentity.read().generation);bindLocalWorkspace(true,rootIdentity.read().generation);
  await assert.rejects(accountThemeTransport(scope,{assertCurrent(){},onInvalidate:()=>()=>{}}).write(command,signal(),'home'));
  assert.equal(calls.length,count,'invalid context, offline or anonymous identity never sends');
 } finally {Object.assign(globalThis,previous);rootIdentity.confirm(rootIdentity.read().generation);bindLocalWorkspace(true,rootIdentity.read().generation);}
});
