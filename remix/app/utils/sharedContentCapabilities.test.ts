import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SHARED_CONTENT_REQUIREMENTS, requireSharedContentCapability, sharedContentWrite } from './sharedContentCapabilities';
test('full-content contracts negotiate the exact selected origin and reject an older metadata API', async t => {
 const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window'), oldFetch = globalThis.fetch;
 const selected = 'https://content-contract.example', requested: string[] = [];
 Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: 'http://unrelated-ui.example' } } });
 globalThis.fetch = async input => { requested.push(String(input)); return new Response(JSON.stringify({ schemaVersion: 1, origin: selected, features: { 'api.things': { version: '1.51.1' }, 'api.attachment-annotate': { version: '1.1.0' } } }), { headers: { 'Content-Type': 'application/json' } }); };
 t.after(() => { globalThis.fetch = oldFetch; if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else Reflect.deleteProperty(globalThis, 'window'); });
 await requireSharedContentCapability('api.things', { expectedApiOrigin: selected });
 await assert.rejects(requireSharedContentCapability('api.attachment-annotate', { expectedApiOrigin: selected }));
 assert.deepEqual(requested, [selected + '/.well-known/thingtime-capabilities.json']);
});
test('Data, explicit rich text, metadata and references use the full-content writer contract', () => {
 for (const args of [{ thingtime: ['data'] }, { thingtime: ['post'] }, { text: '' }, { richText: { blocks: [] } }, { crystal: { body: 'x'.repeat(20_000) } }, { thing: { kind: 'thing-collection', things: [] } }, { tags: ['a'.repeat(100)] }]) assert.equal(sharedContentWrite(args), true);
 assert.equal(sharedContentWrite({ id: 'id', visibility: 'private' }), false);
 assert.equal(SHARED_CONTENT_REQUIREMENTS['api.things-comment'], '1.11.0');
 assert.equal(SHARED_CONTENT_REQUIREMENTS['api.attachment-link'], '1.2.0');
});
