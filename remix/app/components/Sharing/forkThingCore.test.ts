import test from 'node:test';
import assert from 'node:assert/strict';
import { canForkThing, FORKABLE_CONTENT_KINDS } from './forkThingCore';
import { getThingtimeSchema, isProtectedThingtime } from '~/schemas/registry';

test('standalone content can be copied but managed and relationship records cannot', () => {
	for (const kind of ['data', 'schema', 'component', 'webpage', 'action', 'post']) assert.equal(canForkThing({ thingtime: [kind] }), true, kind);
	for (const kind of ['user', 'app', 'passkey', 'notification', 'attachment', 'chat', 'comment', 'save', 'folder', 'subspace', 'subspace-member', 'subspace-modlog', 'subspace-tombstone', 'subspace-report', 'app-data', 'unknown']) assert.equal(canForkThing({ thingtime: [kind] }), false, kind);
	assert.equal(canForkThing({ thingtime: ['data'], targetId: 'parent' }), false);
	assert.equal(canForkThing({ thingtime: [] }), false);
});

test('each copyable content kind remains ordinary standalone content in the canonical registry', () => {
	for (const kind of FORKABLE_CONTENT_KINDS) {
		const schema = getThingtimeSchema(kind);
		assert.equal(schema?.kind, 'crystal', kind);
		assert.equal(!!schema?.requiresTarget, false, kind);
		assert.equal(isProtectedThingtime([kind]), false, kind);
	}
});


test('Builder provenance preserves legitimate content without admitting marker-only or control roots', () => {
	for (const kind of ['webpage', 'component', 'action', 'schema']) {
		assert.equal(canForkThing({ thingtime: [kind, 'builder-thing'] }), true, kind);
		assert.equal(canForkThing({ thingtime: ['builder-thing', kind] }), true, `${kind} marker order`);
		assert.equal(canForkThing({ thingtime: [kind, 'builder-thing'], targetId: 'parent' }), false, `${kind} relationship`);
	}
	assert.equal(canForkThing({ thingtime: ['builder-thing'] }), false);
	for (const kind of ['unknown', 'user', 'passkey', 'attachment', 'app-data', 'comment', 'notification']) {
		assert.equal(canForkThing({ thingtime: [kind, 'builder-thing'] }), false, kind);
		assert.equal(canForkThing({ thingtime: ['webpage', 'builder-thing', kind] }), false, `mixed ${kind}`);
	}
});
