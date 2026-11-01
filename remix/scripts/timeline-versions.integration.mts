// Opt-in integration. App data is created only through the real HTTP API.
// Requires a development server using a disposable local `timeline-rs` set.
// Covers api.timeline 1.18.0: named versions (name-version), undo this change
// (mode:undo), compare with now (recover:true preview) and version export (export=1).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { parseTimelineEntry } from '../app/timeline/contract.ts';
import { TIMELINE_UNDO_LABEL, parsePublishedVersionPreview } from '../app/timeline/publishedVersion.ts';
import type { VersionRequest } from '../app/timeline/publishedVersion.ts';
import { TIMELINE_VERSION_NAME_LABELS, parseTimelineVersionName, parseTimelineVersionNameResult, timelineVersionNameEventId } from '../app/timeline/versionNames.ts';
import type { TimelineVersionNameCommand } from '../app/timeline/versionNames.ts';
import { versionContent, versionContentEquals } from '../app/timeline/versions.ts';

const base = process.env.TIMELINE_TEST_BASE;
if (!base) throw new Error('Set TIMELINE_TEST_BASE to the isolated local test server');
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Timeline integration only runs on a disposable local server');
const status = await fetch(`${base}/api/v1/mongodb/status`).then(response => response.json());
assert.equal(status.host, '127.0.0.1:20337');
assert.equal(status.replicaSet, 'timeline-rs');
assert.equal(status.custom, false);
assert.equal(status.connected, true);

let cookie = '';
async function call(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST', authenticated = true) {
	const response = await fetch(`${base}${path}`, { method, headers: { ...(authenticated && cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
	const data = await response.json();
	return { response, data };
}
const username = `timeline-${randomUUID().slice(0, 8)}`;
const password = process.env.TIMELINE_TEST_PASSWORD || `Timeline-${randomUUID()}-9a!`;
const registered = await call('/api/v1/auth/register', { username, password, email: `${username}@example.invalid`, displayName: 'Timeline versions test' });
assert.equal(registered.data.ok, true, 'Fixture registration failed');
cookie = registered.response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
const ownerId = registered.data.user.id;
assert.ok(ownerId);
const query = `ownerId=${encodeURIComponent(ownerId)}&dataPlane=home`;
assert.equal((await call(`/api/v1/timeline?ownerId=${encodeURIComponent(ownerId)}`)).data.dataPlane, 'home');

const created = await call('/api/v1/things', { thingtime: ['data'], crystal: { title: 'Versions acceptance', a: 1, b: 1 }, visibility: 'private' });
assert.equal(created.data.ok, true);
let thing = created.data.thing;
const edit = async (crystal: Record<string, unknown>) => {
	const result = await call('/api/v1/things', { id: thing.id, crystal, expectedUpdatedAt: thing.updatedAt }, 'PATCH');
	assert.equal(result.data.ok, true, JSON.stringify(result.data)); thing = result.data.thing; return thing;
};
await edit({ a: 2 }); await edit({ b: 2 }); await edit({ title: 'Versions acceptance (third)' });
const history = () => call(`/api/v1/timeline?${query}&thingId=${thing.id}`);
const entry = (eventId: string) => call(`/api/v1/timeline?${query}&eventId=${encodeURIComponent(eventId)}`);
const post = (body: unknown) => call(`/api/v1/timeline?${query}`, body);
const exportOf = (eventId: string, suffix = '') => call(`/api/v1/timeline?${query}&eventId=${encodeURIComponent(eventId)}&export=1${suffix}`);
const currentCrystal = async () => (await call(`/api/v1/things?id=${thing.id}`)).data.thing.crystal;
const page = await history();
assert.equal(page.data.ok, true); assert.deepEqual(page.data.names, [], 'a fresh history page carries an empty names list');
const revisions = page.data.entries.map((item: any) => item.event).filter((event: any) => event.mode === 'revision');
const root = revisions.find((event: any) => event.operation === 'create');
const middle = revisions.find((event: any) => event.operation === 'update' && event.before?.value?.crystal?.a === 1 && event.after?.value?.crystal?.a === 2);
const later = revisions.find((event: any) => event.before?.value?.crystal?.b === 1 && event.after?.value?.crystal?.b === 2);
assert.ok(root && middle && later, 'the three PATCH edits recorded a create and two updates');
assert.deepEqual((await entry(middle.id)).data.names, [], 'an exact version read carries an empty names list');

// Named versions: name, replay, stale CAS, eligibility, rename, clear, page and entry reads.
const nameCommand: TimelineVersionNameCommand = { command: 'name-version', operationId: randomUUID(), eventId: middle.id, thingId: thing.id, name: 'Middle edit', expectedRevision: 0 };
const named = await post(nameCommand);
assert.equal(named.response.status, 200, JSON.stringify(named.data)); assert.equal(named.response.headers.get('cache-control'), 'private, no-store');
const stored = parseTimelineVersionNameResult(named.data, ownerId, nameCommand);
assert.ok(stored.name && stored.entry); assert.equal(stored.name.revision, 1); assert.equal(stored.name.id, `${middle.id}/name`);
assert.equal(stored.entry.event.id, timelineVersionNameEventId(nameCommand.operationId)); assert.equal(stored.entry.event.label, TIMELINE_VERSION_NAME_LABELS.named);
assert.equal(stored.entry.event.branchId, middle.branchId, 'the effect event carries the named version’s branch'); assert.equal(stored.entry.event.before, null);
assert.deepEqual(stored.entry.event.dependencies, [{ thingId: thing.id, eventId: middle.id }]);
assert.deepEqual((await post(nameCommand)).data, named.data, 'an exact replay returns the identical receipt');
assert.equal((await post({ ...nameCommand, name: 'Different' })).response.status, 409, 'a different request under a used operation id is refused');
assert.equal((await post({ ...nameCommand, operationId: randomUUID(), name: 'Stale', expectedRevision: 0 })).response.status, 409, 'a stale expectedRevision is refused');
const other = await call('/api/v1/things', { thingtime: ['data'], crystal: { title: 'Other Thing' }, visibility: 'private' });
assert.equal(other.data.ok, true);
assert.equal((await post({ ...nameCommand, operationId: randomUUID(), thingId: other.data.thing.id })).response.status, 404, 'another Thing’s id is refused');
assert.equal((await post({ ...nameCommand, operationId: randomUUID(), eventId: 'missing-event' })).response.status, 404);
assert.equal((await post({ ...nameCommand, operationId: randomUUID(), eventId: stored.entry.event.id })).response.status, 422, 'an effect event cannot be named');
for (const invalid of [{ ...nameCommand, operationId: 'nope' }, { ...nameCommand, name: '' }, { ...nameCommand, name: 'x'.repeat(81) }, { ...nameCommand, ownerId }, { ...nameCommand, expectedRevision: -1 }])
	assert.equal((await post(invalid)).response.status, 400, JSON.stringify(invalid).slice(0, 80));
assert.deepEqual((await history()).data.names, [named.data.name], 'the page lists the name beside its events');
assert.deepEqual((await entry(middle.id)).data.names, [named.data.name], 'the exact version read includes the name');
assert.deepEqual((await history()).data.entries.find((item: any) => item.event.id === middle.id).event, middle, 'the named event record is unchanged');
assert.ok((await history()).data.entries.some((item: any) => item.event.id === stored.entry!.event.id && item.event.mode === 'effect'), 'the effect event is part of the Thing’s history');
const rename: TimelineVersionNameCommand = { ...nameCommand, operationId: randomUUID(), name: 'Middle edit (renamed)', expectedRevision: 1 };
const renamed = parseTimelineVersionNameResult((await post(rename)).data, ownerId, rename);
assert.equal(renamed.name!.revision, 2); assert.equal(renamed.entry!.event.label, TIMELINE_VERSION_NAME_LABELS.renamed); assert.deepEqual(renamed.entry!.event.before!.value, stored.name);
const noop: TimelineVersionNameCommand = { ...rename, operationId: randomUUID(), expectedRevision: 2 };
assert.deepEqual(parseTimelineVersionNameResult((await post(noop)).data, ownerId, noop), { ok: true, name: renamed.name, entry: null }, 'the same name again is a no-op');
// Two concurrent first-time names on another version: exactly one wins.
const raced = await Promise.all(['First', 'Second'].map(name => post({ command: 'name-version', operationId: randomUUID(), eventId: later.id, thingId: thing.id, name, expectedRevision: 0 })));
assert.deepEqual(raced.map(item => item.response.status).sort(), [200, 409], `concurrent names answered ${raced.map(item => item.response.status)}`);
const laterName = parseTimelineVersionName(raced.find(item => item.response.status === 200)!.data.name);
assert.equal(laterName.revision, 1); assert.equal((await entry(later.id)).data.names.length, 1);
const clear: TimelineVersionNameCommand = { command: 'name-version', operationId: randomUUID(), eventId: later.id, thingId: thing.id, name: null, expectedRevision: 1 };
const cleared = parseTimelineVersionNameResult((await post(clear)).data, ownerId, clear);
assert.equal(cleared.name, null); assert.equal(cleared.entry!.event.after, null); assert.equal(cleared.entry!.event.label, TIMELINE_VERSION_NAME_LABELS.cleared); assert.deepEqual(cleared.entry!.event.before!.value, laterName);
assert.deepEqual((await post(clear)).data.name, null, 'a clear replays'); assert.deepEqual((await entry(later.id)).data.names, []);
const noopClear: TimelineVersionNameCommand = { ...clear, operationId: randomUUID(), expectedRevision: 0 };
assert.deepEqual(parseTimelineVersionNameResult((await post(noopClear)).data, ownerId, noopClear), { ok: true, name: null, entry: null }, 'clearing an absent name is a no-op');
const again = parseTimelineVersionNameResult((await post({ ...noopClear, operationId: randomUUID(), name: 'Again' })).data, ownerId, { ...noopClear, name: 'Again' });
assert.equal(again.name!.revision, 3, 'revisions stay monotonic across a clear');
assert.equal((await post({ command: 'name-version', operationId: randomUUID(), eventId: later.id, thingId: thing.id, name: 'Stale life', expectedRevision: 1 })).response.status, 409, 'a rename from the earlier life cannot land');
console.log('Named versions: name, replay, CAS, eligibility, rename, concurrent create, clear and reads');

// Undo this change: the middle edit (a 1→2) is reverted while the later edit (b) and the title edit survive.
const undoRequest: VersionRequest = { command: 'preview-version', mode: 'undo', eventId: middle.id, choices: {}, componentMode: 'current', componentChoices: {} };
const undoPreview = await post(undoRequest);
assert.equal(undoPreview.response.status, 200, JSON.stringify(undoPreview.data));
const preview = parsePublishedVersionPreview(undoPreview.data.preview, middle.id, thing.id, undoRequest);
assert.equal(preview.baseEventId, middle.id); assert.deepEqual(preview.conflicts, []); assert.deepEqual(preview.thingtime, ['data']);
assert.deepEqual(preview.result.value.crystal, { title: 'Versions acceptance (third)', a: 1, b: 2 });
const undoApply: VersionRequest = { ...undoRequest, command: 'apply-version', expectedHeadId: preview.expectedHeadId, operationId: randomUUID(), expectedComponents: preview.components!.fingerprint };
const undone = await post(undoApply);
assert.equal(undone.response.status, 200, JSON.stringify(undone.data));
const undoEntry = parseTimelineEntry(undone.data.entry);
assert.equal(undoEntry.event.id, `version-${undoApply.operationId}`); assert.equal(undoEntry.event.label, TIMELINE_UNDO_LABEL); assert.equal(undoEntry.event.operation, 'restore');
assert.deepEqual([...undoEntry.event.parentIds].sort(), [preview.expectedHeadId, middle.id].sort()); assert.equal(undoEntry.event.source, 'api'); assert.equal(undoEntry.event.mode, 'revision');
assert.deepEqual(await currentCrystal(), { title: 'Versions acceptance (third)', a: 1, b: 2 });
assert.deepEqual((await post(undoApply)).data, undone.data, 'an exact apply replay returns the same receipt');
assert.equal((await post(undoRequest)).response.status, 409, 'the edit is already reverted');
thing = (await call(`/api/v1/things?id=${thing.id}`)).data.thing;
await edit({ a: 5 });
const overlap = parsePublishedVersionPreview((await post(undoRequest)).data.preview, middle.id, thing.id, undoRequest);
assert.deepEqual(overlap.conflicts.map(conflict => conflict.path), [['crystal', 'a']], 'the later overlapping edit needs a choice');
assert.equal((await post({ ...undoApply, operationId: randomUUID(), expectedHeadId: overlap.expectedHeadId, expectedComponents: overlap.components!.fingerprint })).response.status, 409, 'apply without choices refuses');
const choices = { '["crystal","a"]': 'incoming' as const };
const resolved = parsePublishedVersionPreview((await post({ ...undoRequest, choices })).data.preview, middle.id, thing.id, { ...undoRequest, choices });
assert.deepEqual(resolved.conflicts, []); assert.equal((resolved.result.value as any).crystal.a, 1);
assert.equal((await post({ ...undoApply, operationId: randomUUID(), choices, expectedHeadId: resolved.expectedHeadId, expectedComponents: resolved.components!.fingerprint })).response.status, 200);
assert.equal((await currentCrystal()).a, 1);
assert.equal((await post({ ...undoRequest, eventId: root.id })).response.status, 422, 'a create cannot be undone on its own');
assert.equal((await post({ ...undoRequest, eventId: stored.entry.event.id })).response.status, 422, 'an effect event cannot be undone');
assert.equal((await post({ ...undoRequest, mode: 'revert' })).response.status, 400);
console.log('Undo: middle edit reverted with the later edit kept, already-reverted 409, overlap choice, replay and eligibility');

// Compare with now: the existing recover:true restore preview answers for a live Thing and parses.
const compareRequest: VersionRequest = { command: 'preview-version', mode: 'restore', eventId: middle.id, recover: true, choices: {}, componentMode: 'current', componentChoices: {} };
const compared = await post(compareRequest);
assert.equal(compared.response.status, 200, JSON.stringify(compared.data));
const comparison = parsePublishedVersionPreview(compared.data.preview, middle.id, thing.id, compareRequest);
assert.deepEqual(comparison.thingtime, ['data']); assert.ok(comparison.current); assert.equal((comparison.incoming.value as any).crystal.a, 2); assert.equal((comparison.current!.value as any).crystal.a, 1);
console.log('Compare with now: recover preview returns thingtime and both sides for a live Thing');

// Export: shape, content equality, notes and name, 404/422, privacy, strict query and the separate allowance.
const noteCommand = { command: 'add-note', operationId: randomUUID(), eventId: middle.id, thingId: thing.id, text: 'Exported with its note.' };
assert.equal((await post(noteCommand)).response.status, 200);
const exported = await exportOf(middle.id);
assert.equal(exported.response.status, 200, JSON.stringify(exported.data)); assert.equal(exported.response.headers.get('cache-control'), 'private, no-store');
const file = exported.data.export;
assert.deepEqual(Object.keys(file).sort(), ['content', 'event', 'exportedAt', 'formatVersion', 'name', 'notes', 'receipt']);
assert.equal(file.formatVersion, 1); assert.ok(Number.isFinite(Date.parse(file.exportedAt)));
const fileEntry = parseTimelineEntry({ event: file.event, receipt: file.receipt });
assert.deepEqual(fileEntry.event, middle, 'the raw event is exported unchanged');
assert.equal(file.content.adapter, 'thing-content'); assert.equal(file.content.version, 1);
assert.deepEqual(Object.keys(file.content.value).sort(), ['acl', 'crystal', 'extended', 'folderId', 'geo', 'tags']);
assert.equal(versionContentEquals(file.content.value, versionContent(middle.after)), true, 'the content equals the restorable content of the version');
assert.equal(file.notes.length, 1); assert.equal(file.notes[0].text, noteCommand.text);
assert.equal(parseTimelineVersionName(file.name).name, renamed.name!.name, 'the current name is attached');
assert.equal(parseTimelineVersionName((await exportOf(later.id)).data.export.name).name, 'Again', 'the current name of another version is attached to its own export');
const clearAgain: TimelineVersionNameCommand = { command: 'name-version', operationId: randomUUID(), eventId: later.id, thingId: thing.id, name: null, expectedRevision: again.name!.revision };
assert.equal((await post(clearAgain)).response.status, 200, 'clearing the re-added name');
assert.equal((await exportOf(later.id)).data.export.name, null, 'a cleared name exports as null');
assert.equal((await exportOf(root.id)).response.status, 200, 'a create version exports');
assert.equal((await exportOf('missing-event')).response.status, 404);
assert.equal((await exportOf(stored.entry.event.id)).response.status, 422, 'the name effect event is not an exportable version');
for (const suffix of ['&thingId=' + thing.id, '&unknown=1', '&history=1', '&export=1']) assert.equal((await exportOf(middle.id, suffix)).response.status, 400, suffix);
assert.equal((await call(`/api/v1/timeline?${query}&eventId=${middle.id}&export=0`)).response.status, 400);
assert.equal((await call(`/api/v1/timeline?${query}&eventId=${middle.id}&export=1`, undefined, 'GET', false)).response.status, 401);
assert.equal((await call(`/api/v1/timeline?ownerId=another-user&dataPlane=home&eventId=${middle.id}&export=1`)).response.status, 409);
{
	const originalCookie = cookie;
	const readerName = `timeline-reader-${randomUUID().slice(0, 8)}`;
	const reader = await call('/api/v1/auth/register', { username: readerName, password, email: `${readerName}@example.invalid` });
	assert.equal(reader.data.ok, true);
	cookie = reader.response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
	const foreign = `ownerId=${encodeURIComponent(reader.data.user.id)}&dataPlane=home`;
	assert.equal((await call(`/api/v1/timeline?${foreign}&eventId=${middle.id}&export=1`)).response.status, 404, 'another account never exports this version');
	assert.equal((await call(`/api/v1/timeline?${foreign}`, { ...nameCommand, operationId: randomUUID(), name: 'Not mine' })).response.status, 404, 'another account never names this version');
	cookie = originalCookie;
}
// The export allowance (timeline.export, 30 per minute by default) is separate from ordinary reads.
let limited: { response: Response; data: any } | null = null;
for (let n = 0; n < 32 && !limited; n++) { const attempt = await exportOf(middle.id); if (attempt.response.status === 429) limited = attempt; else assert.equal(attempt.response.status, 200); }
if (limited) {
	assert.ok(Number(limited.response.headers.get('retry-after')) >= 1); assert.equal(limited.response.headers.get('cache-control'), 'private, no-store');
	assert.equal((await entry(middle.id)).response.status, 200, 'ordinary version reads keep their own allowance');
	console.log('Export allowance refused after the configured burst with Retry-After');
} else console.log('Export allowance not exhausted within 32 requests (an admin override may raise it); skipping the 429 check');
assert.deepEqual((await history()).data.entries.find((item: any) => item.event.id === middle.id).event, middle, 'exports never change history');
console.log('PASS: named versions, undo this change, compare with now and version export over the real API');
