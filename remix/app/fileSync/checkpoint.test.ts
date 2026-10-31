import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceSyncBaseline } from './checkpoint';
const scope = { origin: 'https://example.test', ownerId: 'owner', dataPlane: 'home', rootId: 'connection', deviceId: 'device' };
const file = (id: string, version: string, hash = 'a') => ({ path: 'file', id, version, kind: 'file' as const, size: 1, sha256: hash.repeat(64) });
test('baseline advances observed agreement but keeps original evidence for divergent or missing copies', () => {
	const original = { scope, entries: [{ path: 'file', local: file('local', '1'), remote: file('remote', '1') }] };
	const scan = (entries: any[], complete = true) => ({ scope, entries, complete });
	const changed = advanceSyncBaseline(original, scan([file('local', '2', 'b')]), scan([file('remote', '1')]));
	assert.deepEqual(changed, original);
	assert.deepEqual(advanceSyncBaseline(original, scan([]), scan([file('remote', '1')])), original);
	assert.deepEqual(advanceSyncBaseline(original, scan([]), scan([])).entries, []);
	const agreed = advanceSyncBaseline(original, scan([file('local', '2', 'b')]), scan([file('remote', '3', 'b')]));
	assert.equal(agreed.entries[0].local.version, '2');
	assert.equal(agreed.entries[0].remote.version, '3');
	assert.throws(() => advanceSyncBaseline(original, scan([], false), scan([])));
	assert.deepEqual(original.entries[0].local.version, '1');
});
