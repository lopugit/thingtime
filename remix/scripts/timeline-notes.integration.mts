// Opt-in integration. App data is created only through the real HTTP API.
// Requires a development server using a disposable local `timeline-rs` set.
// Lopu may be unconfigured locally: explain-change asserts only the reply shape and its idempotency.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { TIMELINE_NOTES_PER_EVENT, parseTimelineNote, parseTimelineNoteResult, timelineNoteId } from '../app/timeline/notes.ts';

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
const registered = await call('/api/v1/auth/register', { username, password, email: `${username}@example.invalid`, displayName: 'Timeline notes test' });
assert.equal(registered.data.ok, true, 'Fixture registration failed');
cookie = registered.response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
const ownerId = registered.data.user.id;
assert.ok(ownerId);
const query = `ownerId=${encodeURIComponent(ownerId)}&dataPlane=home`;
const discovery = await call(`/api/v1/timeline?ownerId=${encodeURIComponent(ownerId)}`);
assert.equal(discovery.data.ok, true);
assert.equal(discovery.data.dataPlane, 'home');

const created = await call('/api/v1/things', { thingtime: ['data'], crystal: { title: 'Notes acceptance', colour: 'Original' }, visibility: 'private' });
assert.equal(created.data.ok, true);
const thing = created.data.thing;
const history = () => call(`/api/v1/timeline?${query}&thingId=${thing.id}`);
const entry = (eventId: string) => call(`/api/v1/timeline?${query}&eventId=${eventId}`);
const post = (body: unknown) => call(`/api/v1/timeline?${query}`, body);
const first = await history();
assert.equal(first.data.ok, true); assert.deepEqual(first.data.notes, [], 'A fresh history page carries an empty notes list');
const root = first.data.entries[0].event;
assert.deepEqual((await entry(root.id)).data.notes, [], 'An exact version read carries an empty notes list');

// Owner note: stored once, replayed by operation id, visible on the page and the exact read.
const add = { command: 'add-note' as const, operationId: randomUUID(), eventId: root.id, thingId: thing.id, text: 'Created for the notes acceptance run.\nSecond line.' };
const added = await post(add);
assert.equal(added.response.status, 200); assert.equal(added.response.headers.get('cache-control'), 'private, no-store');
const stored = parseTimelineNoteResult(added.data, ownerId, add);
assert.ok('note' in stored); assert.equal(stored.note.id, timelineNoteId(add.operationId)); assert.equal(stored.note.author, 'owner');
assert.deepEqual((await post(add)).data, added.data, 'Lost note reply retried with the same operation id returns the identical note');
assert.equal((await post({ ...add, text: 'Different text' })).response.status, 409, 'Same operation id with other content is refused');
assert.equal((await post({ command: 'explain-change', operationId: add.operationId, eventId: root.id, thingId: thing.id })).response.status, 409);
assert.deepEqual((await history()).data.notes, [added.data.note], 'The page lists the note under notes, not inside the event');
assert.deepEqual((await history()).data.entries[0].event, root, 'The event record is unchanged by its note');
assert.deepEqual((await entry(root.id)).data.notes, [added.data.note], 'The exact version read includes the note');

// The event must be this account's and this Thing's.
const other = await call('/api/v1/things', { thingtime: ['data'], crystal: { title: 'Other Thing' }, visibility: 'private' });
assert.equal(other.data.ok, true);
assert.equal((await post({ command: 'add-note', operationId: randomUUID(), eventId: root.id, thingId: other.data.thing.id, text: 'Wrong Thing' })).response.status, 404);
assert.equal((await post({ command: 'add-note', operationId: randomUUID(), eventId: 'missing-event', thingId: thing.id, text: 'Missing event' })).response.status, 404);
for (const invalid of [{ ...add, operationId: 'not-a-uuid' }, { ...add, text: '' }, { ...add, text: 'x'.repeat(2001) }, { ...add, ownerId }, { command: 'remove-note', operationId: randomUUID(), noteId: root.id }])
	assert.equal((await post(invalid)).response.status, 400, JSON.stringify(invalid).slice(0, 80));
assert.equal((await call(`/api/v1/timeline?${query}`, add, 'POST', false)).response.status, 401);
assert.equal((await call(`/api/v1/timeline?ownerId=another-user&dataPlane=home`, add)).response.status, 409);
assert.equal((await call(`/api/v1/timeline?ownerId=${ownerId}&dataPlane=custom-other`, add)).response.status, 409);

// Cap: at most eight notes per event, replayed notes still answer.
const extra: typeof add[] = [];
for (let n = 2; n <= TIMELINE_NOTES_PER_EVENT; n++) {
	const command = { ...add, operationId: randomUUID(), text: `Note ${n}` }; extra.push(command);
	assert.equal((await post(command)).response.status, 200, `note ${n}`);
}
const ninth = { ...add, operationId: randomUUID(), text: 'One too many' };
const full = await post(ninth);
assert.equal(full.response.status, 413); assert.equal(full.data.error, 'This change already has 8 notes. Remove one to add another.');
assert.deepEqual((await post(add)).data, added.data, 'A stored note replays even when the event is full');
const page = await history();
assert.equal(page.data.notes.length, TIMELINE_NOTES_PER_EVENT);
assert.deepEqual(page.data.notes.map((note: any) => parseTimelineNote(note).text), [add.text, ...extra.map(command => command.text)], 'Notes arrive in creation order');
assert.ok(page.data.notes.every((note: any) => note.ownerId === ownerId && note.eventId === root.id && note.thingId === thing.id));

// Privacy: another signed-in account never sees these notes.
const originalCookie = cookie;
const secondUsername = `timeline-reader-${randomUUID().slice(0, 8)}`;
const secondAccount = await call('/api/v1/auth/register', { username: secondUsername, password, email: `${secondUsername}@example.invalid` });
assert.equal(secondAccount.data.ok, true);
cookie = secondAccount.response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
const foreign = `ownerId=${encodeURIComponent(secondAccount.data.user.id)}&dataPlane=home`;
assert.equal((await call(`/api/v1/timeline?${foreign}&eventId=${root.id}`)).response.status, 404);
assert.equal((await call(`/api/v1/timeline?${foreign}`, { command: 'add-note', operationId: randomUUID(), eventId: root.id, thingId: thing.id, text: 'Not mine' })).response.status, 404);
assert.deepEqual((await call(`/api/v1/timeline?${foreign}`, { command: 'remove-note', operationId: randomUUID(), noteId: added.data.note.id })).data, { ok: true, removed: true, noteId: added.data.note.id }, 'A foreign removal acknowledges without touching the note');
cookie = originalCookie;
assert.equal((await history()).data.notes.length, TIMELINE_NOTES_PER_EVENT, 'The foreign removal changed nothing');

// Remove: idempotent, frees a slot, works for either author.
const remove = { command: 'remove-note' as const, operationId: randomUUID(), noteId: added.data.note.id };
const removed = await post(remove);
assert.equal(removed.response.status, 200);
assert.deepEqual(parseTimelineNoteResult(removed.data, ownerId, remove), { ok: true, removed: true, noteId: remove.noteId });
assert.deepEqual((await post(remove)).data, removed.data, 'Removing again is idempotent');
assert.deepEqual((await post({ ...remove, operationId: randomUUID() })).data, removed.data);
assert.equal((await history()).data.notes.length, TIMELINE_NOTES_PER_EVENT - 1);
assert.ok(!(await history()).data.notes.some((note: any) => note.id === remove.noteId));
assert.equal((await post(add)).response.status, 200, 'A removed operation id may store the identical note again');
assert.deepEqual((await post({ command: 'remove-note', operationId: randomUUID(), noteId: added.data.note.id })).data, removed.data);

// Lopu explanation: shape and idempotency only; the model may be unconfigured locally.
const explain = { command: 'explain-change' as const, operationId: randomUUID(), eventId: root.id, thingId: thing.id };
const explained = await post(explain);
assert.ok([200, 503].includes(explained.response.status), `explain-change answered ${explained.response.status}`);
assert.equal(explained.response.headers.get('cache-control'), 'private, no-store');
if (explained.response.status === 200) {
	const lopu = parseTimelineNoteResult(explained.data, ownerId, explain);
	assert.ok('note' in lopu); assert.equal(lopu.note.author, 'lopu'); assert.ok(lopu.note.text.length > 0 && lopu.note.text.length <= 2000);
	assert.deepEqual((await post(explain)).data, explained.data, 'The stored explanation replays without asking Lopu again');
	assert.ok((await history()).data.notes.some((note: any) => note.id === lopu.note.id));
	assert.equal((await post({ ...ninth, operationId: randomUUID() })).response.status, 413, 'The explanation counts toward the cap');
	const removeLopu = { command: 'remove-note' as const, operationId: randomUUID(), noteId: lopu.note.id };
	assert.deepEqual((await post(removeLopu)).data, { ok: true, removed: true, noteId: lopu.note.id }, 'The owner may remove a Lopu note');
	assert.ok(!(await history()).data.notes.some((note: any) => note.id === lopu.note.id));
	console.log('Lopu explanation stored and removed');
} else {
	assert.equal(explained.data.ok, false); assert.equal(explained.data.error, 'Lopu could not explain this change right now. Try again in a moment.');
	assert.equal((await post(explain)).response.status, 503, 'An unavailable explanation stores nothing and may be retried');
	assert.ok(!(await history()).data.notes.some((note: any) => note.id === timelineNoteId(explain.operationId)));
	console.log('Lopu explanation unavailable on this server (503); nothing stored');
}
assert.equal((await call(`/api/v1/timeline?${query}`, explain, 'POST', false)).response.status, 401);
assert.deepEqual((await call(`/api/v1/things?id=${thing.id}`)).data.thing.crystal, root.after.value.crystal, 'Notes never change the Thing');
console.log('PASS: owner notes, exact retries, page and entry notes, event/Thing fences, eight-note cap, privacy, idempotent removal and Lopu explanation shape');
