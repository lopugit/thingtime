import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import { DEFAULT_BRIDGE_THING_NAME, readBridgeThingIdentity } from './bridgeIdentity.ts';

// createBridgePayload() for a thing already saved to Thingtime.
const savedThingPayload = {
	value: { hello: 'world' },
	thing: { id: 'b2f0c0de-0000-4000-8000-000000000000', name: 'Pricing table', visibility: 'private', version: 7 },
	parentOrigin: 'https://host.example'
};

test('the value-only state sync names no thing, so the popup keeps its identity', () => {
	// This is exactly what commit/undo/redo post: `{ value }`, no `thing`.
	assert.equal(readBridgeThingIdentity({ value: { hello: 'edited on the host page' } }), null);
	assert.equal(readBridgeThingIdentity({}), null);
	assert.equal(readBridgeThingIdentity(undefined), null);
	// A non-object `thing` is not a projection either — it must not reset anything.
	for (const thing of [null, 'nope', 42, ['id']]) {
		assert.equal(readBridgeThingIdentity({ value: {}, thing }), null, `thing: ${JSON.stringify(thing)}`);
	}
});

test('init and request-save project the saved document verbatim', () => {
	assert.deepEqual(readBridgeThingIdentity(savedThingPayload), {
		name: 'Pricing table',
		visibility: 'private',
		documentMeta: { id: 'b2f0c0de-0000-4000-8000-000000000000', version: 7 }
	});
});

test('a thing with no id is the create branch, not a broken update', () => {
	// createBridgePayload()'s else-branch: `{ name, visibility }` and no id/version.
	assert.deepEqual(readBridgeThingIdentity({ value: {}, thing: { name: 'Draft', visibility: 'public' } }), {
		name: 'Draft',
		visibility: 'public',
		documentMeta: null
	});
});

test('id/version pairs saveEmbeddedThing would reject fall back to a create', () => {
	// saveEmbeddedThing requires a non-empty id and a safe integer version >= 1;
	// anything else must not be posted as an update the server can only 400.
	for (const thing of [
		{ id: '', version: 3 },
		{ id: 'abc', version: 0 },
		{ id: 'abc', version: -1 },
		{ id: 'abc', version: 1.5 },
		{ id: 'abc', version: 'seven' },
		{ id: 'abc' },
		{ id: 123, version: 3 }
	]) {
		assert.equal(readBridgeThingIdentity({ value: {}, thing })?.documentMeta, null, `thing: ${JSON.stringify(thing)}`);
	}
});

test('names are defaulted and bounded, visibility is closed to the two known values', () => {
	assert.equal(readBridgeThingIdentity({ thing: { name: '   ' } })?.name, DEFAULT_BRIDGE_THING_NAME);
	assert.equal(readBridgeThingIdentity({ thing: { name: 42 } })?.name, DEFAULT_BRIDGE_THING_NAME);
	assert.equal(readBridgeThingIdentity({ thing: { name: 'x'.repeat(400) } })?.name.length, 120);
	assert.equal(readBridgeThingIdentity({ thing: { visibility: 'private' } })?.visibility, 'private');
	// Anything that is not exactly 'private' is public — never a third state.
	for (const visibility of [undefined, 'PRIVATE', 'secret', true]) {
		assert.equal(readBridgeThingIdentity({ thing: { visibility } })?.visibility, 'public', `visibility: ${String(visibility)}`);
	}
});
