import assert from 'node:assert/strict';
import test from 'node:test';
import { makeShareSavePlan, shareParentId, sharePathParts, validateShareSavePlan } from './shareSavePlan';
const file = (path: string, size = 3) => ({ name: path.split('/').at(-1)!, webkitRelativePath: path, size, type: 'application/octet-stream' }) as File;
test('preserves nested and empty directories with every opaque file in original order', () => {
 let next = 0; const files = Array.from({length: 40}, (_, i) => file(`Folder/Nested/${i}.custom`));
 const plan = makeShareSavePlan('share', 'destination', 'https://example.test\nNote', files, ['Empty/Sub'], () => `id-${next++}`);
 assert.equal(plan.files.length, 40);
 assert.deepEqual(plan.folders.map(f => f.path), ['Empty', 'Folder', 'Empty/Sub', 'Folder/Nested']);
 assert.equal(shareParentId(plan, 'Folder/Nested/0.custom'), plan.folders.find(f => f.path === 'Folder/Nested')!.id);
 assert.equal(shareParentId(plan, 'root.custom'), 'destination');
 assert.equal(validateShareSavePlan(plan, 'share', files, plan.text), plan);
});
test('rejects changed retry bytes/identity and traversal instead of silently changing destination', () => {
 const files = [file('file.custom')]; const plan = makeShareSavePlan('one', null, 'original', files);
 assert.throws(() => validateShareSavePlan(plan, 'two', files, 'original'));
 assert.throws(() => validateShareSavePlan(plan, 'one', [file('file.custom', 4)], 'original'));
 assert.throws(() => validateShareSavePlan(plan, 'one', files, 'changed'));
 for (const path of ['/absolute', '../outside', 'a/../b', 'a//b', 'a\\b', 'a/']) assert.throws(() => sharePathParts(path));
});

test('stable save identities survive independent hosts and refuse duplicate destination identities', async () => {
 const { makeStableShareSavePlan } = await import('./shareSavePlan');
 const files = [file('A/document.custom'), file('B/document.custom')];
 const first = await makeStableShareSavePlan('https://thingtime.com', 'owner', 'native-share', 'original', 'Text', files, ['Empty']);
 const reopened = await makeStableShareSavePlan('https://thingtime.com', 'owner', 'native-share', 'another-folder', 'Text', files, ['Empty']);
 assert.deepEqual(reopened.files, first.files);
 assert.deepEqual(reopened.folders, first.folders);
 assert.equal(reopened.noteId, first.noteId);
 assert.notEqual(first.files[0].id, first.files[1].id);
 for (const value of [first.noteId, ...first.files.flatMap(entry => [entry.id, entry.operationId]), ...first.folders.map(entry => entry.id)]) assert.match(value, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
 const otherAccount = await makeStableShareSavePlan('https://thingtime.com', 'other', 'native-share', 'original', 'Text', files);
 assert.notEqual(otherAccount.files[0].id, first.files[0].id);
});

test('recovery excludes journaled uploads and rejects reused mismatched operation commands', async () => {
 const { shareFilesNeedingUpload } = await import('./shareSavePlan');
 const files = [file('one.custom'), file('two.custom')];
 const plan = makeShareSavePlan('share', 'destination', '', files);
 const commands = new Map([[plan.files[0].id, { id: plan.files[0].id, operationId: plan.files[0].operationId }]]);
 assert.deepEqual(shareFilesNeedingUpload(plan, files, commands), [files[1]]);
 commands.set(plan.files[1].id, { id: plan.files[1].id, operationId: plan.files[1].operationId });
 assert.deepEqual(shareFilesNeedingUpload(plan, files, commands), []);
 commands.set(plan.files[0].id, { id: plan.files[0].id, operationId: 'different-operation' });
 assert.throws(() => shareFilesNeedingUpload(plan, files, commands));
});
