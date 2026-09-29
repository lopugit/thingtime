// Writes require the dedicated disposable loopback replica; never production.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { captureComponentBindings } from '../app/timeline/componentBindings';
import { planPublishedComponentCopies } from '../app/api/utils/timeline/publishedComponents';
import { parseTimelineEvent, type TimelineEvent } from '../app/timeline/contract';
import { parsePublishedVersionPreview, type VersionRequest } from '../app/timeline/publishedVersion';
const base = process.env.TIMELINE_TEST_BASE;
if (!base || !['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Set a disposable loopback TIMELINE_TEST_BASE');
const status = await fetch(base + '/api/v1/mongodb/status').then((r) => r.json());
assert.equal(status.host, '127.0.0.1:20337');
assert.equal(status.replicaSet, 'timeline-rs');
assert.equal(status.custom, false);
let cookie = '';
async function call(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
	const response = await fetch(base + path, {
		method,
		headers: { Cookie: cookie, 'Content-Type': 'application/json' },
		...(body === undefined ? {} : { body: JSON.stringify(body) })
	});
	return { status: response.status, body: await response.json(), headers: response.headers };
}
const username = `published-${randomUUID().slice(0, 8)}`,
	password = `Timeline-${randomUUID()}-9a!`;
const registered = await call('/api/v1/auth/register', { username, password, email: `${username}@example.invalid` });
assert.equal(registered.body.ok, true, registered.body.error);
cookie = registered.headers
	.getSetCookie()
	.map((value) => value.split(';')[0])
	.join('; ');
const ownerId = registered.body.user.id,
	scope = `ownerId=${ownerId}&dataPlane=home`;
const timeline = (body: unknown) => call(`/api/v1/timeline?${scope}`, body);
const history = async (thingId: string) => (await call(`/api/v1/timeline?${scope}&thingId=${thingId}`)).body.entries;
const read = async (id: string) => (await call(`/api/v1/things?id=${id}`)).body.thing;
const create = async (thingtime: string[], crystal: any) => {
	const result = await call('/api/v1/things', { thingtime, crystal, visibility: 'private' });
	assert.equal(result.body.ok, true, result.body.error);
	return result.body.thing;
};
const definition = (text: string) => ({
	name: 'Recorded card',
	componentKey: 'shared-card',
	version: 1,
	render: {
		tag: 'section',
		children: [
			{ tag: 'h2', children: text },
			{ tag: 'button', props: { 'data-tt-action': 'restore-inert-probe' }, children: 'Action probe' }
		]
	}
});
const component = await create(['component'], definition('Original blue card'));
const pageCrystal = {
	name: 'Published component restore',
	blocks: [
		{ type: 'text', id: 'title', style: 'heading', text: 'Historical page' },
		{ type: 'component', id: 'card', component: 'shared-card' }
	]
};
const page = await create(['webpage'], pageCrystal);
const sibling = await create(['webpage'], { ...pageCrystal, name: 'Other page uses shared card' });
const source: TimelineEvent = (await history(page.id))[0].event;
async function changeComponent(text: string) {
	const result = await call('/api/v1/things', { id: component.id, crystal: definition(text) }, 'PATCH');
	assert.equal(result.body.ok, true, result.body.error);
}
await changeComponent('Current coral card');
const request: VersionRequest = {
	command: 'preview-version',
	mode: 'restore',
	eventId: source.id,
	choices: {},
	componentMode: 'recorded',
	componentChoices: {}
};
async function compare(query = request) {
	const result = await timeline(query);
	assert.equal(result.status, 200, result.body.error);
	assert.equal(result.headers.get('cache-control'), 'private, no-store');
	return parsePublishedVersionPreview(result.body.preview, query.eventId, page.id, query);
}
const initial = await compare();
const text = (field: any) => field.value.crystal.render.children[0].children;
assert.equal(text(initial.components!.current['shared-card']), 'Current coral card');
assert.equal(text(initial.components!.result['shared-card']), 'Original blue card');
const command = (preview: typeof initial, query = request): VersionRequest => ({
	...query,
	command: 'apply-version',
	operationId: randomUUID(),
	expectedHeadId: preview.expectedHeadId,
	expectedComponents: preview.components!.fingerprint
});
assert.equal((await timeline({ command: 'preview-version', mode: 'restore', eventId: source.id })).status, 409);
const stale = command(initial);
await changeComponent('Later amber card');
assert.equal((await timeline(stale)).status, 409, 'Standalone component edit invalidates preview with unchanged page head');
assert.equal((await history(page.id)).length, 1);
const preview = await compare();
const apply = command(preview);
const committed = await timeline(apply);
assert.equal(committed.status, 200, committed.body.error);
assert.deepEqual((await timeline(apply)).body, committed.body, 'Lost reply replays the exact receipt');
assert.equal((await timeline({ ...apply, componentMode: 'current' })).status, 409);
const restored = await read(page.id);
const ref = restored.crystal.blocks[1].component;
assert.notEqual(ref, 'shared-card');
const copied = await read(ref);
assert.equal(copied.crystal.render.children[0].children, 'Original blue card');
assert.equal(copied.crystal.componentKey, ref);
assert.equal(copied.crystal.forkOf, component.id);
assert.deepEqual(copied.acl, ['tt:user']);
assert.deepEqual((await read(sibling.id)).crystal, sibling.crystal);
assert.equal((await read(component.id)).crystal.render.children[0].children, 'Later amber card');
assert.equal((await history(page.id)).length, 2);
assert.equal((await history(ref)).length, 1);
const captures = (await call(`/api/v1/timeline?${scope}&eventId=${committed.body.entry.event.id}&components=1`)).body.entries;
assert.equal(captures[0].event.after.value.component.id, ref);
assert.equal(captures[0].event.after.value.component.crystal.render.children[0].children, 'Original blue card');
const currentQuery = { ...request, componentMode: 'current' as const };
const currentPreview = await compare(currentQuery);
assert.equal(currentPreview.components!.copyCount, 0);
const currentApply = await timeline(command(currentPreview, currentQuery));
assert.equal(currentApply.status, 200, currentApply.body.error);
assert.equal((await read(page.id)).crystal.blocks[1].component, 'shared-card');
let draft = parseTimelineEvent({
	...source,
	id: randomUUID(),
	operationId: randomUUID(),
	source: 'client',
	clientId: 'published-integration',
	mode: 'draft',
	operation: 'update',
	branchId: 'draft-published',
	parentIds: [source.id],
	occurredAt: new Date().toISOString(),
	label: 'Violet recorded card',
	before: source.after,
	dependencies: []
});
const recorded = captureComponentBindings(
	draft,
	{ 'shared-card': { id: component.id, crystal: { ...component.crystal, render: definition('Incoming violet card').render } } },
	[],
	() => randomUUID()
);
for (const capture of recorded.events) assert.equal((await timeline(capture)).body.ok, true);
draft = parseTimelineEvent({ ...draft, dependencies: recorded.dependencies });
assert.equal((await timeline(draft)).body.ok, true);
const mergeQuery = { ...request, mode: 'merge' as const, eventId: draft.id };
const conflict = await compare(mergeQuery);
assert.deepEqual(
	conflict.components!.conflicts.map((value) => value.path),
	[['shared-card']]
);
assert.equal((await timeline(command(conflict, mergeQuery))).status, 409);
const selected = { ...mergeQuery, componentChoices: { '["shared-card"]': 'incoming' as const } };
const reviewed = await compare(selected);
assert.equal(reviewed.components!.conflicts.length, 0);
const merged = await timeline(command(reviewed, selected));
assert.equal(merged.status, 200, merged.body.error);
assert.equal((await read((await read(page.id)).crystal.blocks[1].component)).crystal.render.children[0].children, 'Incoming violet card');
assert.ok(merged.body.entry.event.parentIds.includes(draft.id));
assert.equal((await call('/api/v1/timeline?ownerId=other&dataPlane=home', request)).status, 409);
assert.equal((await call(`/api/v1/timeline?ownerId=${ownerId}&dataPlane=custom-other`, request)).status, 409);
const savedCookie = cookie;
cookie = '';
assert.equal((await timeline(request)).status, 401);
assert.equal((await call(`/api/v1/things?id=${ref}`)).status, 404);
cookie = savedCookie;
// Known absence stays unavailable even when the original ref later resolves.
const absentRef = `absent-${randomUUID()}`;
const absentPage = await create(['webpage'], { name: 'Recorded absence', blocks: [{ type: 'component', id: 'missing', component: absentRef }] });
const absentSource = (await history(absentPage.id))[0].event;
assert.equal(
	(
		await call('/api/v1/things', {
			shareId: absentRef,
			thingtime: ['component'],
			crystal: definition('Became available later'),
			visibility: 'private'
		})
	).body.ok,
	true
);
const absentQuery = { ...request, eventId: absentSource.id };
const absentPreview = parsePublishedVersionPreview((await timeline(absentQuery)).body.preview, absentSource.id, absentPage.id, absentQuery);
assert.deepEqual(absentPreview.components!.unavailable, [absentRef]);
assert.equal(absentPreview.components!.copyCount, 1);
const absentApplied = await timeline(command(absentPreview, absentQuery));
assert.equal(absentApplied.status, 200, absentApplied.body.error);
const placeholder = await read((await read(absentPage.id)).crystal.blocks[0].component);
assert.equal(placeholder.crystal.render.children, 'This component was unavailable in the recorded version.');
assert.equal((await read(absentRef)).crystal.render.children[0].children, 'Became available later');
const missingEvent = parseTimelineEvent({
	...source,
	id: randomUUID(),
	operationId: randomUUID(),
	source: 'client',
	clientId: 'published-integration',
	mode: 'draft',
	operation: 'update',
	branchId: 'draft-missing',
	parentIds: [source.id],
	before: source.after,
	dependencies: [],
	occurredAt: new Date().toISOString()
});
assert.equal((await timeline(missingEvent)).body.ok, true);
const missingQuery = { ...request, eventId: missingEvent.id };
const missingPreview = await compare(missingQuery);
assert.deepEqual(missingPreview.components!.missing, ['shared-card']);
assert.equal((await timeline(command(missingPreview, missingQuery))).status, 422);
const copiedSource = (await history(page.id)).find((entry: any) => entry.event.mode === 'revision').event;
const copiedQuery = { ...request, eventId: copiedSource.id };
const copiedPreview = await compare(copiedQuery);
const copiedAgain = await timeline(command(copiedPreview, copiedQuery));
assert.equal(copiedAgain.status, 200, copiedAgain.body.error);
assert.equal((await read((await read(page.id)).crystal.blocks[1].component)).crystal.render.children[0].children, 'Incoming violet card');
// A later branch still reaches definitions after restoration changed ref ids.
let later = parseTimelineEvent({
	...draft,
	id: randomUUID(),
	operationId: randomUUID(),
	dependencies: [],
	label: 'Later green branch',
	occurredAt: new Date().toISOString()
});
const laterCaptures = captureComponentBindings(
	later,
	{ 'shared-card': { id: component.id, crystal: { ...component.crystal, render: definition('Later green branch').render } } },
	[],
	() => randomUUID()
);
for (const capture of laterCaptures.events) assert.equal((await timeline(capture)).body.ok, true);
later = parseTimelineEvent({ ...later, dependencies: laterCaptures.dependencies });
assert.equal((await timeline(later)).body.ok, true);
const copiedRef = (await read(page.id)).crystal.blocks[1].component;
const laterQuery = { ...mergeQuery, eventId: later.id };
const laterPreview = await compare(laterQuery);
assert.deepEqual(
	laterPreview.components!.conflicts.map((value) => value.path),
	[[copiedRef]],
	'Copied identities cannot hide an incoming definition change'
);
const laterChoice = { ...laterQuery, componentChoices: { [JSON.stringify([copiedRef])]: 'incoming' as const } };
const laterReview = await compare(laterChoice);
assert.equal(laterReview.components!.conflicts.length, 0);
const laterApplied = await timeline(command(laterReview, laterChoice));
assert.equal(laterApplied.status, 200, laterApplied.body.error);
assert.equal((await read((await read(page.id)).crystal.blocks[1].component)).crystal.render.children[0].children, 'Later green branch');
// A failure on the second copy must roll back the first copy, page and ledgers.
const extra = await create(['component'], { ...definition('Extra component'), componentKey: 'extra-card' });
// Conflicting page trees must be reviewable before their component identities
// are aligned. The provisional current tree coalesces two base definitions.
const layoutBlocks = [
	{ type: 'component', id: 'first', component: component.id },
	{ type: 'component', id: 'second', component: extra.id }
];
const layoutPage = await create(['webpage'], { name: 'Layout conflict review', blocks: layoutBlocks });
const layoutSource = (await history(layoutPage.id))[0].event;
const layoutDraft = parseTimelineEvent({
	...layoutSource,
	id: randomUUID(),
	operationId: randomUUID(),
	source: 'client',
	clientId: 'published-integration',
	mode: 'draft',
	operation: 'update',
	branchId: 'layout-variation',
	parentIds: [layoutSource.id],
	before: layoutSource.after,
	after: {
		...layoutSource.after,
		value: {
			...layoutSource.after.value,
			crystal: { name: 'Layout conflict review', blocks: [{ ...layoutBlocks[0], args: { label: 'Branch label' } }, layoutBlocks[1]] }
		}
	},
	occurredAt: new Date().toISOString()
});
assert.equal((await timeline(layoutDraft)).body.ok, true);
assert.equal(
	(
		await call(
			'/api/v1/things',
			{
				id: layoutPage.id,
				crystal: { name: 'Layout conflict review', blocks: layoutBlocks.map((block) => ({ ...block, component: component.id })) }
			},
			'PATCH'
		)
	).body.ok,
	true
);
const layoutQuery = { ...request, mode: 'merge' as const, eventId: layoutDraft.id };
const layoutCompared = await timeline(layoutQuery);
assert.equal(layoutCompared.status, 200, layoutCompared.body.error);
const layoutPreview = parsePublishedVersionPreview(layoutCompared.body.preview, layoutDraft.id, layoutPage.id, layoutQuery);
assert.deepEqual(
	layoutPreview.conflicts.map((conflict) => conflict.path),
	[['crystal', 'blocks']]
);
const layoutChoice = { ...layoutQuery, choices: { '["crystal","blocks"]': 'incoming' as const } };
const layoutResolved = await timeline(layoutChoice);
assert.equal(layoutResolved.status, 200, layoutResolved.body.error);
assert.equal(parsePublishedVersionPreview(layoutResolved.body.preview, layoutDraft.id, layoutPage.id, layoutChoice).conflicts.length, 0);

const edit = await call(
	'/api/v1/things',
	{ id: page.id, crystal: { ...pageCrystal, blocks: [...pageCrystal.blocks, { type: 'component', id: 'extra', component: extra.id }] } },
	'PATCH'
);
assert.equal(edit.body.ok, true, edit.body.error);
const atomicSource = (await history(page.id))[0].event;
const atomicQuery = { ...request, eventId: atomicSource.id };
const atomicPreview = await compare(atomicQuery);
const atomicCommand = command(atomicPreview, atomicQuery);
const plan = planPublishedComponentCopies(atomicCommand.operationId!, atomicPreview.result.value, atomicPreview.components!.result);
assert.equal(plan.copies.length, 2);
const collision = await call('/api/v1/things', {
	shareId: plan.copies[1].shareId,
	thingtime: ['component'],
	crystal: plan.copies[1].crystal,
	visibility: 'private'
});
assert.equal(collision.body.ok, true, collision.body.error);
const usedBytes = async () => (await call('/api/v1/auth/me')).body.user.storage.usedBytes;
const baselineBytes = await usedBytes();
const baselineHistory = await history(page.id);
const baselinePage = await read(page.id);
const refused = await timeline(atomicCommand);
assert.equal(refused.status, 409, refused.body.error);
assert.equal((await call(`/api/v1/things?id=${plan.copies[0].shareId}`)).status, 404, 'First copy rolls back when second insertion fails');
assert.deepEqual(await read(page.id), baselinePage);
assert.deepEqual(await history(page.id), baselineHistory);
assert.equal(await usedBytes(), baselineBytes);
assert.equal((await call(`/api/v1/timeline?${scope}&eventId=version-${atomicCommand.operationId}`)).status, 404);
// Concurrent operations against one preview commit exactly one complete result.
const racePreview = await compare(atomicQuery);
const racers = Array.from({ length: 3 }, () => command(racePreview, atomicQuery));
const raced = await Promise.all(racers.map((value) => timeline(value)));
assert.equal(raced.filter((value) => value.status === 200).length, 1);
for (let index = 0; index < racers.length; index++) {
	const expected = planPublishedComponentCopies(racers[index].operationId!, racePreview.result.value, racePreview.components!.result);
	if (raced[index].status !== 200) assert.equal(raced[index].status, 409, raced[index].body.error);
	for (const copy of expected.copies) assert.equal((await call(`/api/v1/things?id=${copy.shareId}`)).status, raced[index].status === 200 ? 200 : 404);
}
assert.equal((await history(page.id)).length, baselineHistory.length + 1);
// Ordinary data called blocks must not be interpreted as a webpage.
const data = await create(['data'], { blocks: [{ type: 'component', component: 'arbitrary-value' }], name: 'Literal blocks data' });
const dataSource = (await history(data.id))[0].event;
const dataQuery = { ...request, eventId: dataSource.id };
const dataPreview = parsePublishedVersionPreview((await timeline(dataQuery)).body.preview, dataSource.id, data.id, dataQuery);
assert.deepEqual(dataPreview.components!.result, {});
const dataApplied = await timeline(command(dataPreview, dataQuery));
assert.equal(dataApplied.status, 200, dataApplied.body.error);
assert.deepEqual((await read(data.id)).crystal, data.crystal);
if (process.env.TIMELINE_TEST_FIXTURE_PATH)
	await writeFile(
		process.env.TIMELINE_TEST_FIXTURE_PATH,
		JSON.stringify(
			{
				base,
				username,
				password,
				ownerId,
				cookie,
				thingId: page.id,
				siblingId: sibling.id,
				source,
				draft,
				componentId: component.id,
				builderPath: `/builder?page=${page.id}&mode=edit`
			},
			null,
			2
		),
		{ mode: 0o600 }
	);
console.log(
	'PASS: published restore/merge, independent copies, shared-key isolation, standalone component stale fence, exact retry, canonical captures, current mode, atomic second-copy rollback with accounting, and scope/privacy fences'
);
