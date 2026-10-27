import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { THINGTIME_THEME } from '../theme/tokens.ts';
import { themeContentSnapshot, themeContentValue, themeContentStoragePayload } from './themeContent.ts';
import { themeMutationEvent } from '../api/utils/timeline/themeContent.ts';
import { newThingMutationCapture } from '../api/utils/timeline/recordMutation.ts';
import { withTimelineMutationContext } from '../api/utils/timeline/mutationContext.ts';
import { packTimelineEntry, timelinePayloadBytes } from '../api/utils/timeline/envelope.ts';
import { thingStorageSizeBytes } from '../api/utils/storage/storageCore.ts';
import { entryFixture } from './testFixtures.ts';

const before = { shareId: 'theme-one', ownerId: 'owner', thingtime: ['theme'], timelineHeadId: 'saved',
	crystal: { name: 'A saved theme', theme: structuredClone(THINGTIME_THEME) }, extended: null, tags: [], acl: ['tt:user'], folderId: null };
const bytes = (event: ReturnType<typeof themeMutationEvent>) => timelinePayloadBytes({ thingtime: ['timeline-event'], ...packTimelineEntry(entryFixture(event!)) });

test('theme projection preserves every current token and exact historical partial values without adding defaults', () => {
	const value = themeContentValue(themeContentSnapshot({ crystal: before.crystal, tags: [], visibility: 'private', folderId: null }));
	assert.deepEqual(value.crystal.theme, THINGTIME_THEME, 'A new theme field needs an explicit versioned history contract');
	const partial = { name: 'Historical', colors: { accent: 'saved-value' }, general: { motion: false, radiusScale: 0 } };
	const snapshot = themeContentSnapshot({ crystal: { name: 'Old theme', theme: partial }, tags: [], visibility: 'public', folderId: null });
	assert.deepEqual(themeContentValue(snapshot).crystal.theme, partial);
	assert.equal(Object.prototype.hasOwnProperty.call(themeContentValue(snapshot).crystal, 'title'), false);
	const title = themeContentSnapshot({ crystal: { ...before.crystal, title: null }, tags: ['one'], visibility: 'private', folderId: 'folder' });
	assert.equal(Object.prototype.hasOwnProperty.call(themeContentValue(title).crystal, 'title'), true);
	assert.equal(themeContentValue(title).crystal.title, null);
});

test('protected theme history excludes non-approved fields and its decoder rejects hidden content', () => {
	const source = structuredClone(before) as any;
	source.secure = 'root-secret'; source.extended = { secret: 'extension-secret' };
	source.crystal.secret = 'crystal-secret'; source.crystal.theme.secret = 'theme-secret';
	source.crystal.theme.colors.secret = 'token-secret';
	const event = themeMutationEvent(null, source, newThingMutationCapture('owner'))!;
	for (const secret of ['root-secret', 'extension-secret', 'crystal-secret', 'theme-secret', 'token-secret']) assert.equal(JSON.stringify(event).includes(secret), false);
	const valid = event.after!;
	for (const changed of [
		{ ...valid, version: 3 }, { ...valid, value: { ...valid.value as any, secure: 'hidden' } },
		{ ...valid, value: { ...valid.value as any, crystal: { ...(valid.value as any).crystal, password: 'hidden' } } },
		{ ...valid, value: { ...valid.value as any, crystal: { name: 'Name', theme: { colors: { privateKey: 'hidden' } } } } },
		{ ...valid, value: { ...valid.value as any, crystal: { name: 'Name', theme: { general: { motion: 'yes' } } } } },
		{ ...valid, value: { ...valid.value as any, crystal: { name: 'Name', theme: { colors: { rainbow: ['one'] } } } } }
	]) assert.throws(() => themeContentValue(changed as any));
});

test('theme create/edit/delete events share the exact parent chain and trusted Action/AI provenance', () => {
	withTimelineMutationContext('owner', 'ai', () => {
		const capture = newThingMutationCapture('owner');
		const after = { ...before, crystal: { ...before.crystal, name: 'Edited theme', title: 'Friendly title' }, acl: ['tt:all'] };
		const created = themeMutationEvent(null, before, capture)!;
		const edited = themeMutationEvent(before, after, capture)!;
		const deleted = themeMutationEvent(after, null, capture)!;
		assert.equal(created.operation, 'create'); assert.equal(created.before, null); assert.deepEqual(created.parentIds, []);
		assert.equal(edited.operation, 'update'); assert.deepEqual(edited.parentIds, ['saved']);
		assert.equal(themeContentValue(edited.after!).visibility, 'public');
		assert.equal(deleted.operation, 'delete'); assert.equal(deleted.after, null);
		assert.deepEqual(deleted.before, edited.after);
		for (const event of [created, edited, deleted]) { assert.equal(event.source, 'ai'); assert.equal(event.actorId, 'owner'); assert.equal(event.operationId, capture.operationId); }
		assert.equal(themeMutationEvent(before, structuredClone(before), capture), null);
		for (const bad of [{ ...after, ownerId: 'other' }, { ...after, shareId: 'other' }, { ...after, thingtime: ['theme', 'data'] }]) assert.throws(() => themeMutationEvent(before, bad, capture));
	});
});

test('theme retained-byte projection matches approved live payload and never exempts client drafts or invalid shapes', () => {
	const capture = newThingMutationCapture('owner');
	const deleted = themeMutationEvent(before, null, capture)!;
	assert.equal(bytes(deleted), thingStorageSizeBytes(before));
	assert.equal(bytes(themeMutationEvent(null, before, capture)), thingStorageSizeBytes(before));
	const titled = { ...before, crystal: { ...before.crystal, title: 'A title' }, tags: ['favorite'] };
	assert.equal(bytes(themeMutationEvent(titled, null, capture)), thingStorageSizeBytes(titled));
	const snapshot = themeMutationEvent(titled, null, capture)!.before!;
	assert.deepEqual(themeContentStoragePayload(snapshot), { crystal: titled.crystal, extended: null, tags: titled.tags });
	const draft = { ...deleted, mode: 'draft' as const, source: 'client' as const, clientId: 'browser' };
	assert.equal(bytes(draft), Buffer.byteLength(JSON.stringify({ before: draft.before, after: draft.after })));
	const poisoned = { ...deleted, before: { ...deleted.before!, value: { ...(deleted.before!.value as any), hidden: 'payload' } } };
	assert.equal(bytes(poisoned), null);
});

test('theme focus tokens use v2 while historical v1 bytes and validation stay frozen', () => {
	const oldTheme = { name: 'Historical', colors: { accent: 'saved-value' }, general: { motion: false, radiusScale: 0 } };
	const oldValue = { crystal: { name: 'Old theme', theme: oldTheme }, tags: [], visibility: 'private', folderId: null };
	const oldSnapshot = themeContentSnapshot(oldValue);
	assert.equal(oldSnapshot.version, 1);
	const encoded = JSON.stringify(oldSnapshot);
	const digest = '1481ecb32bd4b3356e9e25be42a434396a28ed2081e29475dad97b3adccf74cc';
	assert.equal(createHash('sha256').update(encoded).digest('hex'), digest, 'Frozen historical v1 projection digest');
	assert.deepEqual(themeContentValue(JSON.parse(encoded)), oldValue);
	assert.equal(JSON.stringify(themeContentSnapshot(themeContentValue(oldSnapshot))), encoded);
	assert.equal(createHash('sha256').update(JSON.stringify(oldSnapshot)).digest('hex'), digest);
	const theme = { colors: { focusBorder: '#334455', focusGlowStart: '#556677', focusGlowEnd: '#778899' }, general: { focusGlowBlur: 0, focusGlowOpacity: 0.375 } };
	const current = themeContentSnapshot({ ...oldValue, crystal: { name: 'Focus', theme } });
	assert.equal(current.version, 2);
	assert.deepEqual(themeContentValue(current).crystal.theme, theme);
	assert.throws(() => themeContentValue({ ...current, version: 1 }), /Invalid theme content history/);
	for (const invalid of [{ ...theme, general: { focusGlowBlur: '3' } }, { ...theme, general: { focusGlowOpacity: Infinity } },
		{ ...theme, colors: { focusBorder: false } }])
		assert.throws(() => themeContentSnapshot({ ...oldValue, crystal: { name: 'Focus', theme: invalid } }));
});
