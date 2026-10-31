import assert from 'node:assert/strict';
import test from 'node:test';
import { thingContentSnapshot } from '../timeline/recordMutation';
import { parseBackupThingSnapshot } from './thingSnapshots';

test('ordinary recovery accepts only canonical content and refuses protected or extra envelope fields', () => {
	const snapshot = thingContentSnapshot({ thingtime: ['data'], crystal: { title: 'Saved content' }, folderId: 'folder-one' })!;
	assert.deepEqual(parseBackupThingSnapshot(snapshot), snapshot);
	for (const mutate of [
		(s: any) => (s.value.thingtime = ['draft']),
		(s: any) => (s.value.thingtime = ['chat-message']),
		(s: any) => (s.value.thingtime = []),
		(s: any) => (s.value.secure = 'private'),
		(s: any) => delete s.value.acl,
		(s: any) => (s.adapter = 'unknown'),
		(s: any) => (s.version = 2),
		(s: any) => (s.extra = true)
	]) {
		const changed = structuredClone(snapshot);
		mutate(changed);
		assert.throws(() => parseBackupThingSnapshot(changed));
	}
});
