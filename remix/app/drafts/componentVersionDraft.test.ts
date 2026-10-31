import assert from 'node:assert/strict';
import test from 'node:test';
import { restoreComponentVersionDraft } from './componentVersionDraft';
test('component recovery preserves arguments, version name and audience, rejecting malformed values', () => {
 const snapshot = { values: { text: 'Line one\nLine two', enabled: false, size: 3 }, name: 'My version', acl: ['tt:user'] };
 assert.deepEqual(restoreComponentVersionDraft(JSON.stringify(snapshot)), snapshot);
 for (const bad of [null, {}, { ...snapshot, values: [] }, { ...snapshot, values: { text: {} } }, { ...snapshot, acl: [4] }]) assert.throws(() => restoreComponentVersionDraft(JSON.stringify(bad)));
});
