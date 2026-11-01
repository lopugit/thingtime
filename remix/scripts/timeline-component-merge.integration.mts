// Real HTTP mutations are restricted to this explicitly disposable replica set.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { captureComponentBindings } from '../app/timeline/componentBindings.ts';
import { mergeComponentVersions } from '../app/timeline/componentMerge.ts';
import { parseBranchMergePreview, createBranchMergeProposal } from '../app/timeline/branchMerge.ts';
import { parseTimelineEvent, type TimelineEvent } from '../app/timeline/contract.ts';

const base = process.env.TIMELINE_TEST_BASE;
if (!base || !['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Set a disposable loopback TIMELINE_TEST_BASE');
const status = await fetch(base + '/api/v1/mongodb/status').then(r => r.json());
assert.equal(status.host, '127.0.0.1:20337'); assert.equal(status.replicaSet, 'timeline-rs'); assert.equal(status.custom, false);
let cookie = '';
async function call(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
	const response = await fetch(base + path, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
	return { status: response.status, body: await response.json(), headers: response.headers };
}
const username = `component-merge-${randomUUID().slice(0, 8)}`, password = `Timeline-${randomUUID()}-9a!`;
const registration = await call('/api/v1/auth/register', { username, password, email: `${username}@example.invalid` });
assert.equal(registration.body.ok, true, registration.body.error);
cookie = registration.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
const ownerId = registration.body.user.id;
const scope = `ownerId=${ownerId}&dataPlane=home`;
const timeline = (body: unknown) => call(`/api/v1/timeline?${scope}`, body);
const crystal = (name: string, text: string) => ({ name, componentKey: name, version: 1, args: [], render: { tag: 'section', children: [{ tag: 'h2', children: text }, { tag: 'button', props: { 'data-tt-action': 'merge-inert-probe' }, children: 'Action probe' }] } });
const initial = { card: crystal('card', 'Original recorded card'), badge: crystal('badge', 'Original recorded badge') };
const liveComponents: Record<string, any> = {};
for (const [ref, value] of Object.entries(initial)) {
	const result = await call('/api/v1/things', { thingtime: ['component'], crystal: value, visibility: 'private' });
	assert.equal(result.body.ok, true, result.body.error); liveComponents[ref] = result.body.thing; (initial as any)[ref] = result.body.thing.crystal;
}
const blocks = [{ type: 'text', id: 'heading', style: 'heading', text: 'Component merge acceptance' }, ...Object.keys(initial).map(ref => ({ type: 'component', id: ref, component: ref }))];
const created = await call('/api/v1/things', { thingtime: ['webpage'], crystal: { name: 'Component merge acceptance', blocks }, visibility: 'private' });
assert.equal(created.body.ok, true, created.body.error);
const thingId = created.body.thing.id;
const original = (await call(`/api/v1/timeline?${scope}&thingId=${thingId}`)).body.entries[0].event as TimelineEvent;
async function draft(parent: TimelineEvent, label: string, definitions: Record<string, any>) {
	let event = parseTimelineEvent({ ...parent, id: randomUUID(), operationId: randomUUID(), source: 'client', clientId: 'component-merge-integration', mode: 'draft', operation: 'update', branchId: 'draft-components', parentIds: [parent.id], label, before: parent.after, occurredAt: new Date().toISOString(), dependencies: [] });
	const captured = captureComponentBindings(event, Object.fromEntries(Object.entries(definitions).map(([ref, value]) => [ref, { id: liveComponents[ref].id, crystal: value }])), [], () => randomUUID());
	for (const capture of captured.events) assert.equal((await timeline(capture)).body.ok, true);
	event = parseTimelineEvent({ ...event, dependencies: captured.dependencies });
	assert.equal((await timeline(event)).body.ok, true); return event;
}
const changedDefinition = (ref: keyof typeof initial, text: string) => ({ ...initial[ref], render: crystal(ref, text).render });
const current = await draft(original, 'Current coral card', { ...initial, card: changedDefinition('card', 'Coral recorded card') });
const independent = await draft(original, 'Incoming emerald badge', { ...initial, badge: changedDefinition('badge', 'Emerald recorded badge') });
const branchId = `branch-${randomUUID()}`;
const createBranch = async (id: string, event: TimelineEvent, name: string) => {
	const result = await timeline({ command: 'create-branch', operationId: randomUUID(), branchId: id, thingId, eventId: event.id, expectedRevision: 0, name });
	assert.equal(result.body.ok, true, result.body.error);
};
await createBranch(branchId, current, 'Definition merge API');
const legacy = { command: 'preview-branch-merge' as const, branchId, thingId, eventId: independent.id, expectedHeadId: current.id, expectedRevision: 1, choices: {} };
assert.equal((await timeline(legacy)).status, 409, 'Older clients cannot silently drop captures');
const request = { ...legacy, componentChoices: {} };
const response = await timeline(request);
assert.equal(response.status, 200, response.body.error); assert.equal(response.headers.get('cache-control'), 'private, no-store');
const preview = parseBranchMergePreview(response.body.preview, ownerId, request);
const merged = mergeComponentVersions(preview.components!, preview.result);
assert.deepEqual(merged.conflicts, []); assert.equal(merged.dependencies.length, 2);
assert.equal((merged.result.value as any).card.crystal.render.children[0].children, 'Coral recorded card');
assert.equal((merged.result.value as any).badge.crystal.render.children[0].children, 'Emerald recorded badge');
const proposal = createBranchMergeProposal(preview, 'component-merge-integration');
const upload = await timeline(proposal.event); assert.deepEqual(upload.body.entry.event, proposal.event);
assert.deepEqual((await timeline(proposal.event)).body, upload.body);
const push = await timeline(proposal.command); assert.equal(push.body.head.revision, 2);
assert.deepEqual((await timeline(proposal.command)).body, push.body, 'Lost reply does not create another branch revision');
assert.equal((await timeline(request)).status, 409, 'A changed branch cannot use a stale comparison');
const changed = await call('/api/v1/things', { id: liveComponents.card.id, crystal: crystal('card', 'Live component changed later') }, 'PATCH');
assert.equal(changed.body.ok, true);
const kept = (await call(`/api/v1/timeline?${scope}&eventId=${proposal.event.id}&components=1`)).body.entries;
assert.equal(kept.find((entry: any) => entry.event.after.value.ref === 'card').event.after.value.component.crystal.render.children[0].children, 'Coral recorded card');
assert.deepEqual((await call(`/api/v1/things?id=${thingId}`)).body.thing.crystal, created.body.thing.crystal);

const incoming = await draft(original, 'Incoming violet card', { ...initial, card: changedDefinition('card', 'Violet recorded card'), badge: changedDefinition('badge', 'Emerald recorded badge') });
const uiBranchId = `branch-${randomUUID()}`;
await createBranch(uiBranchId, current, 'Review recorded components');
const conflicting = { ...request, branchId: uiBranchId, eventId: incoming.id };
const overlap = parseBranchMergePreview((await timeline(conflicting)).body.preview, ownerId, conflicting);
assert.deepEqual(mergeComponentVersions(overlap.components!, overlap.result).conflicts.map(item => item.path), [['card']]);
const choices = { ...conflicting, componentChoices: { '["card"]': 'incoming' as const } };
const chosen = parseBranchMergePreview((await timeline(choices)).body.preview, ownerId, choices);
assert.deepEqual(mergeComponentVersions(chosen.components!, chosen.result).conflicts, []);
assert.equal((mergeComponentVersions(chosen.components!, chosen.result).result.value as any).card.crystal.render.children[0].children, 'Violet recorded card');
assert.equal((await timeline({ ...conflicting, componentChoices: { '["unknown"]': 'incoming' } })).status, 422);
assert.equal((await call('/api/v1/timeline?ownerId=other&dataPlane=home', conflicting)).status, 409);
assert.equal((await call(`/api/v1/timeline?ownerId=${ownerId}&dataPlane=custom-other`, conflicting)).status, 409);
const savedCookie = cookie; cookie = ''; assert.equal((await timeline(conflicting)).status, 401); cookie = savedCookie;
if (process.env.TIMELINE_TEST_FIXTURE_PATH) await writeFile(process.env.TIMELINE_TEST_FIXTURE_PATH, JSON.stringify({ base, username, password, cookie, ownerId, thingId, branchId: uiBranchId, current, incoming, originalCrystal: created.body.thing.crystal, builderPath: `/builder?page=${thingId}&branchId=${uiBranchId}&historyOwner=${ownerId}&dataPlane=home&mode=edit` }, null, 2), { mode: 0o600 });
console.log('PASS: independent definitions, explicit conflicting choices, exact canonical upload/retry, stale branch refusal, immutable captures after live edits, published page unchanged, private source/account fences');
