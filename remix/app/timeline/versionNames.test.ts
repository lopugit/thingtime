import assert from 'node:assert/strict';
import test from 'node:test';
import { TIMELINE_VERSION_NAME_KIND, TIMELINE_VERSION_NAME_LABELS, parseTimelineVersionName, parseTimelineVersionNameCommand, parseTimelineVersionNameResult, timelineVersionNameEventId, timelineVersionNameId } from './versionNames.ts';
import { entryFixture, eventFixture } from './testFixtures.ts';
import type { TimelineSnapshot } from './contract.ts';

const uuid = '177abf25-b322-4ac0-9707-a59c36e7bcd5';
const name = { formatVersion: 1 as const, id: 'saved/name', ownerId: 'user-1', eventId: 'saved', thingId: 'page-1', name: 'Launch copy', revision: 1, createdAt: '2026-10-13T10:00:00.000Z', updatedAt: '2026-10-13T10:00:00.000Z' };
const command = { command: 'name-version' as const, operationId: uuid, eventId: 'saved', thingId: 'page-1', name: 'Launch copy', expectedRevision: 0 };
const record = (value: unknown): TimelineSnapshot => ({ adapter: TIMELINE_VERSION_NAME_KIND, version: 1, value: value as any });
const effect = (after: TimelineSnapshot | null, before: TimelineSnapshot | null = null, id = timelineVersionNameEventId(uuid)) =>
	entryFixture(eventFixture(id, { thingId: 'page-1', source: 'api', clientId: null, mode: 'effect', operation: 'effect', label: after ? TIMELINE_VERSION_NAME_LABELS.named : TIMELINE_VERSION_NAME_LABELS.cleared, before, after, dependencies: [{ thingId: 'page-1', eventId: 'saved' }] }));

test('version name records are exact-keyed, bounded, and keyed by their event id even at 200 characters', () => {
	assert.deepEqual(parseTimelineVersionName(name), name);
	const long = 'e'.repeat(200);
	assert.equal(parseTimelineVersionName({ ...name, eventId: long, id: `${long}/name` }).id, `${long}/name`, 'the id is compared directly, never through the 200-character identifier rule');
	assert.equal(parseTimelineVersionName({ ...name, name: 'x'.repeat(80) }).name.length, 80);
	for (const patch of [{ id: 'other/name' }, { name: '' }, { name: ' padded' }, { name: 'x'.repeat(81) }, { name: 'tab\there' }, { revision: 0 }, { revision: 1.5 }, { updatedAt: '2026-10-13T09:59:59.000Z' }, { createdAt: 'yesterday' }, { ownerId: '' }, { thingId: 'bad id' }, { extra: true }])
		assert.throws(() => parseTimelineVersionName({ ...name, ...patch }), /Invalid Timeline version name/, JSON.stringify(patch));
	assert.throws(() => parseTimelineVersionName({ ...name, id: undefined }), 'a dropped key is refused as non-JSON before the key check');
	assert.throws(() => parseTimelineVersionName(null), /Invalid Timeline version name/);
	assert.equal(timelineVersionNameId('saved'), 'saved/name'); assert.equal(timelineVersionNameEventId(uuid), `version-name-${uuid}`);
});

test('name-version commands accept a trimmed 1–80 character name or null and a non-negative expected revision', () => {
	assert.deepEqual(parseTimelineVersionNameCommand(command), command);
	assert.deepEqual(parseTimelineVersionNameCommand({ ...command, name: null, expectedRevision: 3 }), { ...command, name: null, expectedRevision: 3 });
	for (const patch of [{ command: 'rename-version' }, { operationId: 'nope' }, { eventId: '' }, { thingId: 'x'.repeat(201) }, { name: '' }, { name: 'x'.repeat(81) }, { name: 'new\nline' }, { name: 'trailing ' }, { expectedRevision: -1 }, { expectedRevision: '0' }, { expectedRevision: 1.5 }, { extra: 1 }])
		assert.throws(() => parseTimelineVersionNameCommand({ ...command, ...patch }), /Invalid Timeline version name command/, JSON.stringify(patch));
	assert.throws(() => parseTimelineVersionNameCommand({ ...command, expectedRevision: undefined }), 'a dropped key is refused as non-JSON before the key check');
	assert.throws(() => parseTimelineVersionNameCommand([]), /Invalid Timeline version name command/);
});

test('results bind the stored name and its effect receipt to this account and command', () => {
	const stored = { ok: true, name, entry: effect(record(name)) };
	assert.deepEqual(parseTimelineVersionNameResult(stored, 'user-1', command), stored);
	assert.deepEqual(parseTimelineVersionNameResult({ ok: true, name, entry: null }, 'user-1', { ...command, expectedRevision: 1 }), { ok: true, name, entry: null }, 'a no-op returns the current record without a receipt');
	const clear = { ...command, name: null, expectedRevision: 1 };
	const cleared = { ok: true, name: null, entry: effect(null, record(name)) };
	assert.deepEqual(parseTimelineVersionNameResult(cleared, 'user-1', clear), cleared);
	assert.deepEqual(parseTimelineVersionNameResult({ ok: true, name: null, entry: null }, 'user-1', clear), { ok: true, name: null, entry: null });
	assert.throws(() => parseTimelineVersionNameResult(stored, 'other', command), /another version name/);
	assert.throws(() => parseTimelineVersionNameResult(stored, 'user-1', { ...command, name: 'Different' }), /another version name/);
	assert.throws(() => parseTimelineVersionNameResult(stored, 'user-1', { ...command, eventId: 'elsewhere' }), /another version name/);
	assert.throws(() => parseTimelineVersionNameResult(stored, 'user-1', { ...command, thingId: 'other-page' }), /another version name/);
	assert.throws(() => parseTimelineVersionNameResult(stored, 'user-1', { ...command, expectedRevision: 5 }), /another version name/, 'a stored revision is the expected one or the next');
	assert.throws(() => parseTimelineVersionNameResult({ ...stored, name: null }, 'user-1', command), /another version name/);
	assert.throws(() => parseTimelineVersionNameResult(stored, 'user-1', clear), /another version name/, 'a clear never returns a name');
	assert.throws(() => parseTimelineVersionNameResult({ ...stored, entry: effect({ adapter: 'timeline-branch', version: 1, value: {} }) }, 'user-1', command), /another version name/);
	assert.throws(() => parseTimelineVersionNameResult({ ...stored, entry: effect(record(name), null, 'version-name-other') }, 'user-1', command), /another version name/);
	assert.throws(() => parseTimelineVersionNameResult({ ...stored, entry: effect(record({ ...name, name: 'Other' })) }, 'user-1', command), /another version name/, 'the receipt must carry the acknowledged record');
	assert.throws(() => parseTimelineVersionNameResult({ ...stored, entry: { ...stored.entry, event: { ...stored.entry.event, dependencies: [] } } }, 'user-1', command), /another version name/);
	assert.throws(() => parseTimelineVersionNameResult({ ...stored, entry: { ...stored.entry, event: { ...stored.entry.event, mode: 'revision', operation: 'update', before: record(name) } } }, 'user-1', command), /another version name/);
	assert.throws(() => parseTimelineVersionNameResult({ ok: false }, 'user-1', command), /Invalid Timeline version name result/);
	assert.throws(() => parseTimelineVersionNameResult({ ...stored, extra: 1 }, 'user-1', command), /Invalid Timeline version name result/);
	assert.throws(() => parseTimelineVersionNameResult({ ok: true, name }, 'user-1', command), /Invalid Timeline version name result/);
});
