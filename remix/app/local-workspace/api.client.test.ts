import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { anonymousApi, resolveLocalWebpage } from './api.client';
import { anonymousWorkspaceDatabase, bindLocalWorkspace } from './runtime.client';
import { transferChecksum } from '../utils/thingTransfer/archive';
import { bundleFromPlan } from '../utils/thingTransfer/browser';
import { rootIdentity } from '../utils/rootIdentity';

test('anonymous API writes and exports use no network and a retired facade cannot switch to an account', async () => {
	const oldWindow = globalThis.window, oldFactory = globalThis.indexedDB;
	Object.assign(globalThis, { window: { dispatchEvent() {} }, indexedDB: new IDBFactory() });
	let remoteCalls = 0;
	const remote = async (..._args: any[]): Promise<any> => { remoteCalls++; throw new Error('Unexpected remote call'); };
	bindLocalWorkspace(true, rootIdentity.read().generation);
	try {
		const api = anonymousApi({ attachments: { annotate: remote }, login: remote, auth: { login: remote }, things: { remove: remote, create: remote, update: remote, get: remote, list: remote, export: remote, import: remote, bulk: remote, feed: remote, trending: remote, react: remote, save: remote, saved: remote, vote: remote, updown: remote }, actions: { run: remote }, schemas: { list: remote }, algorithms: { list: remote, create: remote, update: remote, remove: remote, setActive: remote, track: remote }, themes: { list: remote, save: remote, getShared: remote, setActive: remote, remove: remote } });
		const created = await api.things.create({ thingtime: ['data'], crystal: { name: 'Offline' } });
		assert.equal((await api.things.get({ id: created.id })).thing.crystal.name, 'Offline');
		assert.equal((await api.things.export({ ids: [created.id] })).plan.things.length, 1);
		await assert.rejects(api.actions.run({}), /Which action/);
  const action = await api.things.create({ thingtime: ['action'], crystal: { name: 'Local', inputs: [], capabilities: [], steps: [{ op: 'return', value: 'offline' }] } });
  assert.equal((await api.actions.run({ action: action.id })).result, 'offline');
  await api.things.remove({ id: action.id });
		assert.equal(api.login, remote, 'Explicit sign-in remains available from a local workspace');
		assert.equal(remoteCalls, 0);
		const component = await api.things.create({ thingtime: ['component'], crystal: { name: 'Card', componentKey: 'card', version: 1, render: { tag: 'p', children: 'Offline component' } } });
		const page = await api.things.create({ thingtime: ['webpage'], crystal: { name: 'Components', blocks: [{ id: 'card', type: 'component', component: 'card' }, { id: 'missing', type: 'component', component: 'missing' }] } });
		const rendered = await resolveLocalWebpage({ kind: 'id', id: page.id });
		assert.equal(rendered.refs.card, component.id);
		assert.equal(rendered.refs.missing, null);
		assert.deepEqual(rendered.components.map((row: any) => row.id), [component.id]);
		const newer = await api.things.create({ thingtime: ['component'], crystal: { name: 'Card v2', componentKey: 'card', version: 2, render: { tag: 'p', children: 'Newest component' } } });
		assert.equal((await resolveLocalWebpage({ kind: 'id', id: page.id })).refs.card, newer.id);
		await api.things.update({ id: page.id, crystal: { blocks: [{ id: 'card', type: 'component', component: 'card' }] } });
		const exported = (await api.things.export({ ids: [page.id] })).plan;
		assert.equal(exported.things.find((row: any) => row.id === page.id).crystal.blocks[0].component, newer.id);
		assert.ok(exported.things.some((row: any) => row.id === newer.id));
		assert.equal(remoteCalls, 0);
		const savedTheme = (await api.themes.save({ name: 'Local peach', theme: { colors: { accent: '#cc8866' } }, visibility: 'private' })).theme;
		await api.themes.setActive({ themeId: savedTheme.id });
		assert.equal((await api.themes.list()).activeThemeId, savedTheme.id);
		assert.equal((await api.themes.getShared({ id: savedTheme.id })).theme.name, 'Local peach');
		assert.equal((await api.things.export({ ids: [savedTheme.id] })).plan.things[0].thingtime[0], 'theme');
		await api.themes.remove({ id: savedTheme.id });
		assert.equal((await api.themes.list()).themes.length, 0);
		assert.equal(remoteCalls, 0);
		const algorithm = (await api.algorithms.create({ name: 'Local art' })).algorithm;
		await api.algorithms.setActive({ algorithmId: algorithm.id });
		assert.equal((await api.algorithms.list()).activeAlgorithmId, algorithm.id);
		await api.algorithms.track({ algorithmId: algorithm.id, events: [{ thingId: 'unknown', signal: 'view' }] });
		assert.equal((await api.things.export({ ids: [algorithm.id] })).plan.things[0].thingtime[0], 'feed-algorithm');
		await api.algorithms.remove({ id: algorithm.id }); assert.equal(remoteCalls, 0);
		const fileBytes = new TextEncoder().encode('Scoped offline bytes');
		const fileImport = await api.things.import({ manifest: { format: 'thingtime.transfer', version: 1, roots: ['file'],
			things: [{ id: 'file', thingtime: ['attachment'], crystal: { recordingFileId: 'bytes', filePurpose: 'file' } }],
			files: [{ id: 'bytes', targetId: 'file', path: 'files/000000', name: 'local.txt', mime: 'text/plain', bytes: fileBytes.length, sha256: await transferChecksum(fileBytes) }] }, localFiles: new Map([['bytes', fileBytes]]) });
		const filePlan = (await api.things.export({ ids: fileImport.roots })).plan;
		assert.deepEqual([...((await bundleFromPlan(filePlan, { fetch: remote })).files.values())][0], fileBytes);
		// Renaming an owned local file is a local write, not a cloud account call.
		const annotated = await api.attachments.annotate({ id: fileImport.roots[0], title: 'Renamed offline file' });
		assert.equal(annotated.attachment.title, 'Renamed offline file');
		assert.equal(annotated.attachment.name, 'local.txt', 'the immutable download name is untouched');
		assert.equal((await api.things.get({ id: fileImport.roots[0] })).thing.crystal.title, 'Renamed offline file');
		await assert.rejects(api.attachments.annotate({ id: fileImport.roots[0] }), /filename preview, title or description/);
		await assert.rejects(api.attachments.annotate({ id: created.id, title: 'Not a file' }), /not stored in this workspace/);
		assert.equal(remoteCalls, 0);
		const fileCopy = await api.things.bulk({ op: 'copy', ids: fileImport.roots });
		const deleted = await api.things.bulk({ op: 'delete', ids: fileImport.roots });
		assert.equal(deleted.succeeded, 1); assert.equal(deleted.results[0].ok, true);
		assert.equal(fileCopy.succeeded, 1); assert.equal(fileCopy.results[0].newId, fileCopy.roots[0]);
		assert.deepEqual([...((await bundleFromPlan((await api.things.export({ ids: fileCopy.roots })).plan, { fetch: remote })).files.values())][0], fileBytes);
		assert.equal(remoteCalls, 0);
		const poll = await api.things.create({ thingtime: ['post'], crystal: { type: 'thingtime', thing: { question: 'Offline API poll', options: ['Gold', 'Peach'] } } });
		await api.things.react({ id: poll.id, emoji: '🥰' });
		await api.things.save({ id: poll.id });
		await api.things.vote({ id: poll.id, optionIndex: 1 });
		await api.things.updown({ id: poll.id, direction: 'up' });
		const saved = await api.things.saved();
		assert.equal(saved.posts[0].id, poll.id); assert.equal(saved.posts[0].viewerSaved, true);
		assert.equal(saved.posts[0].reactionCounts['🥰'], 1); assert.equal(saved.posts[0].pollVotes.viewerVote, 1);
		assert.equal((await api.things.get({ id: poll.id })).post.votes.score, 1);
		await assert.rejects(api.things.save({ id: 'private-remote-id' }), /device workspace/);
		assert.equal(remoteCalls, 0);
		rootIdentity.changed(); bindLocalWorkspace(false, rootIdentity.read().generation); rootIdentity.confirm(rootIdentity.read().generation);
		await assert.rejects(api.things.create({ crystal: { name: 'Late callback' } }), /Workspace changed/);
		await assert.rejects(api.things.save({ id: poll.id }), /Workspace changed/);
		await assert.rejects(api.things.saved(), /Workspace changed/);
		await assert.rejects(filePlan.readLocalFile(filePlan.files[0].id), /Workspace changed/);
		assert.equal(remoteCalls, 0);
	} finally {
		await anonymousWorkspaceDatabase().close();
		Object.assign(globalThis, { window: oldWindow, indexedDB: oldFactory });
	}
});

test('endpoints the server serves logged out stay reachable, account surfaces stay blocked', async () => {
	const oldWindow = globalThis.window, oldFactory = globalThis.indexedDB, oldFetch = globalThis.fetch;
	const origin = 'https://thingtime.example';
	let publicReads = 0, remoteCalls = 0;
	Object.assign(globalThis, { window: { dispatchEvent() {}, location: { origin } }, indexedDB: new IDBFactory(), fetch: async (_input: RequestInfo | URL, options?: RequestInit) => {
		if (options?.credentials === 'same-origin') return Response.json({ schemaVersion: 1, origin, features: Object.fromEntries(['users-profile', 'users-activity', 'users-search', 'themes-shared', 'things-feed', 'things'].map(id => [`api.${id}`, { version: id === 'users-profile' ? '1.1.0' : id === 'things-feed' ? '1.8.0' : id === 'things' ? '1.31.0' : '1.0.0' }])) });
		assert.equal(options?.credentials, 'omit'); assert.equal(options?.redirect, 'error'); publicReads++;
		const url = new URL(String(_input), origin);
		if (url.pathname === '/api/v1/things/feed') { assert.equal(url.searchParams.get('algorithm'), 'latest'); return Response.json({ ok: true, posts: [{ id: 'public-post', type: 'text', author: { id: 'author' }, tags: ['art'], createdAt: '2026-10-16T00:00:00.000Z' }], nextCursor: null }); }
		return Response.json({ ok: true });
	} });
	bindLocalWorkspace(true, rootIdentity.read().generation);
	try {
		const online = async (..._args: any[]): Promise<any> => { remoteCalls++; return { ok: true }; };
		const api = anonymousApi({
			waitlist: { join: online },
			things: { feed: online }, algorithms: { create: online, track: online, list: online },
			profile: { get: online, activity: online, search: online, update: online },
			themes: { getShared: online, listShared: online, list: online, save: online, setActive: online },
			admin: { users: online }
		});
		// A visitor with no account must still reach the public landing form,
		// public profiles, the people rail and the public theme gallery.
		for (const call of [api.waitlist.join({ email: 'a@b.co' }), api.profile.get({ username: 'lopu' }),
			api.profile.activity({ username: 'lopu' }), api.profile.search({ q: 'lo' }),
			api.themes.getShared({ id: 't' }), api.themes.listShared()]) assert.deepEqual(await call, { ok: true });
		assert.equal(publicReads, 5); assert.equal(remoteCalls, 1, 'only the explicit public waitlist uses its existing writer');
		const algorithm = (await api.algorithms.create({ name: 'Private interests' })).algorithm;
		const feed = await api.things.feed({ algorithm: algorithm.id });
		assert.equal(feed.localRanking, true); assert.equal(feed.posts[0].id, 'public-post');
		const trained = await api.algorithms.track({ algorithmId: algorithm.id, events: [{ thingId: 'public-post', signal: 'react' }] });
		assert.equal(trained.applied, 1); assert.equal(publicReads, 6); assert.equal(remoteCalls, 1);
		// Theme content now has a dedicated local writer; account surfaces stay denied.
		const saved = await api.themes.save({ name: 'Local', theme: {} });
		await api.themes.setActive({ themeId: saved.theme.id });
		for (const call of [() => api.profile.update({ bio: 'x' }), () => api.admin.users({})])
			await assert.rejects(call(), /signed-in account/);
		rootIdentity.changed(); bindLocalWorkspace(false, rootIdentity.read().generation); rootIdentity.confirm(rootIdentity.read().generation);
		for (const call of [() => api.profile.activity({ username: 'lopu' }), () => api.themes.listShared(), () => api.waitlist.join({ email: 'a@b.co' })])
			await assert.rejects(async () => call(), /Workspace changed/);
		assert.equal(publicReads, 6); assert.equal(remoteCalls, 1);
	} finally {
		await anonymousWorkspaceDatabase().close();
		Object.assign(globalThis, { window: oldWindow, indexedDB: oldFactory, fetch: oldFetch });
	}
});

test('generic local Things have paged discussions and retired or aborted reads cannot continue', async () => {
	const oldWindow = globalThis.window, oldFactory = globalThis.indexedDB, oldFetch = globalThis.fetch;
	let requests = 0;
	const remote = async (..._args: any[]): Promise<any> => { requests++; throw new Error('Unexpected network request'); };
	Object.assign(globalThis, { window: { dispatchEvent() {} }, indexedDB: new IDBFactory(), fetch: remote });
	bindLocalWorkspace(true, rootIdentity.read().generation);
	try {
		const api = anonymousApi({ things: { get: remote, list: remote, create: remote, comment: remote, remove: remote } });
		const root = await api.things.create({ thingtime: ['component'], crystal: { name: 'Discuss me', render: { tag: 'p', children: 'Native editable component' } } });
		for (let index = 0; index < 25; index++) await api.things.comment({ id: root.id, text: `Comment ${index}` });
		const read = await api.things.get({ id: root.id, commentProjection: true });
		assert.equal(read.post, null);
		assert.equal(read.discussion.sourceThingId, root.id);
		assert.equal(read.discussion.localOnly, true);
		assert.equal(read.discussion.commentCount, 25);
		assert.deepEqual(read.discussion.comments, []);
		assert.equal(read.discussion.repliesLoaded, false);
		assert.equal(read.thing.crystal.name, 'Discuss me');
		const first = await api.things.list({ target: root.id, thingtime: 'comment', commentProjection: true, limit: 20 });
		const second = await api.things.list({ target: root.id, thingtime: 'comment', commentProjection: true, limit: 20, cursor: first.nextCursor });
		assert.equal(first.comments.length, 20); assert.equal(second.comments.length, 5); assert.equal(second.nextCursor, null);
		assert.equal(new Set([...first.comments, ...second.comments].map(row => row.id)).size, 25);
		const child = first.comments[0];
		await api.things.comment({ id: child.id, text: 'Nested reply' });
		const direct = await api.things.get({ id: child.id, commentProjection: true });
		assert.deepEqual(direct.post.comments, []); assert.equal(direct.comment.commentCount, 1);
		const replies = await api.things.list({ target: child.id, thingtime: 'comment', commentProjection: true });
		assert.equal(replies.comments[0].text, 'Nested reply');
		const controller = new AbortController(); controller.abort();
		await assert.rejects(api.things.get({ id: root.id }, { signal: controller.signal }), /abort/i);
		await assert.rejects(api.things.list({ target: root.id, commentProjection: true }, { signal: controller.signal }), /abort/i);
		await assert.rejects(api.things.comment({ id: 'private-account-thing', text: 'No remote authority' }), /not in this workspace/);
		assert.equal(requests, 0);
		await api.things.remove({ id: root.id });
		await assert.rejects(api.things.get({ id: child.id }), /not in this workspace/);
		rootIdentity.changed(); bindLocalWorkspace(false, rootIdentity.read().generation); rootIdentity.confirm(rootIdentity.read().generation);
		await assert.rejects(api.things.list({ target: root.id, commentProjection: true }), /Workspace changed/);
		assert.equal(requests, 0);
	} finally {
		await anonymousWorkspaceDatabase().close();
		Object.assign(globalThis, { window: oldWindow, indexedDB: oldFactory, fetch: oldFetch });
	}
});

test('anonymous public discussion reads preserve bounded projection and omit account credentials', async () => {
	const oldWindow = globalThis.window, oldFactory = globalThis.indexedDB, oldFetch = globalThis.fetch;
	const origin = 'https://thingtime.example'; // One document's capability cache keeps one origin.
	const queries: URLSearchParams[] = [];
	Object.assign(globalThis, { window: { dispatchEvent() {}, location: { origin } }, indexedDB: new IDBFactory(), fetch: async (input: RequestInfo | URL, options?: RequestInit) => {
		if (options?.credentials === 'same-origin') return Response.json({ schemaVersion: 1, origin, features: { 'api.things': { version: '1.31.0' } } });
		assert.equal(options?.credentials, 'omit'); assert.equal(options?.redirect, 'error');
		const url = new URL(String(input), origin); assert.equal(url.pathname, '/api/v1/things'); queries.push(url.searchParams);
		return Response.json(url.searchParams.has('target') ? { ok: true, comments: [{ id: 'public-comment' }], nextCursor: null } : { ok: true, discussion: { id: 'public-thing' } });
	} });
	bindLocalWorkspace(true, rootIdentity.read().generation);
	try {
		const api = anonymousApi({ things: { get: async (..._args: any[]): Promise<any> => {}, list: async (..._args: any[]): Promise<any> => {} } });
		assert.equal((await api.things.get({ id: 'public-thing', key: 'explicit-link', commentProjection: true })).discussion.id, 'public-thing');
		assert.equal((await api.things.list({ target: 'public-thing', key: 'explicit-link', thingtime: 'comment', commentProjection: true, cursor: 'bounded-cursor', limit: 20 })).comments[0].id, 'public-comment');
		assert.equal(queries.length, 2);
		for (const query of queries) { assert.equal(query.get('commentProjection'), 'true'); assert.equal(query.get('key'), 'explicit-link'); }
		assert.equal(queries[1].get('cursor'), 'bounded-cursor'); assert.equal(queries[1].get('thingtime'), 'comment');
	} finally {
		await anonymousWorkspaceDatabase().close();
		Object.assign(globalThis, { window: oldWindow, indexedDB: oldFactory, fetch: oldFetch });
	}
});

test('anonymous library search stays scoped, supports paging, and never falls through to account search', async () => {
 const oldWindow = globalThis.window, oldFactory = globalThis.indexedDB, oldFetch = globalThis.fetch;
 let requests = 0;
 const remote = async (..._args: any[]): Promise<any> => { requests++; throw new Error('Unexpected network'); };
 Object.assign(globalThis, { window: { dispatchEvent() {} }, indexedDB: new IDBFactory(), fetch: remote });
 bindLocalWorkspace(true, rootIdentity.read().generation);
 try {
  const api = anonymousApi({ things: { create: remote, search: remote } });
  for (let n = 0; n < 3; n++) await api.things.create({ thingtime: ['data'], crystal: { name: `Find me ${n}` } });
  const page = await api.things.search({ workspace: true, q: 'find me', limit: 2 });
  const rest = await api.things.search({ workspace: true, q: 'find me', limit: 2, cursor: page.nextCursor });
  assert.equal(page.things.length, 2); assert.equal(rest.things.length, 1); assert.equal(page.total, 3);
  assert.equal(page.things[0].author.username, 'local');
  await assert.rejects(api.things.search({ workspace: true, q: 'find me', author: 'other-account' }), /filters/);
  await assert.rejects(api.things.search({ workspace: true, conditions: [{ field: 'name', value: 'find me' }] }), /filters/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(api.things.search({ workspace: true }, { signal: controller.signal }), /abort/i);
  rootIdentity.changed(); bindLocalWorkspace(false, rootIdentity.read().generation); rootIdentity.confirm(rootIdentity.read().generation);
  await assert.rejects(api.things.search({ workspace: true }), /Workspace changed/);
  assert.equal(requests, 0);
 } finally { await anonymousWorkspaceDatabase().close(); Object.assign(globalThis, { window: oldWindow, indexedDB: oldFactory, fetch: oldFetch }); }
});

test('anonymous Timeline uses local authority, canonical component responses, and retires with its API facade', async () => {
 const oldWindow = globalThis.window, oldFactory = globalThis.indexedDB;
 Object.assign(globalThis, { window: { dispatchEvent() {}, location: { origin: 'https://thingtime.example' } }, indexedDB: new IDBFactory() });
 let remoteCalls = 0;
 const remote = async (..._args: any[]): Promise<any> => { remoteCalls++; throw new Error('Unexpected remote Timeline'); };
 bindLocalWorkspace(true, rootIdentity.read().generation);
 try {
  const api = anonymousApi({ timeline: { discover: remote, page: remote, push: remote, entry: remote, componentBindings: remote, branch: remote, note: remote, nameVersion: remote, branchHead: remote, branches: remote, checkoutBranch: remote, branchMerge: remote, version: remote, exportVersion: remote }, things: { create: remote } });
  const row = await api.things.create({ thingtime: ['data'], crystal: { name: 'Local history adapter' } });
  const scope = { ownerId: 'local-workspace', dataPlane: 'local-workspace', apiOrigin: 'https://thingtime.example' };
  assert.equal((await api.timeline.discover(scope.ownerId)).dataPlane, scope.dataPlane);
  const page = await api.timeline.page(scope, { thingId: row.id, before: null, after: null, limit: 40 });
  assert.equal(page.ok, true); assert.equal(page.entries.length, 1);
  assert.equal((await api.timeline.entry(scope, page.entries[0].event.id)).entry.event.thingId, row.id);
  assert.deepEqual(await api.timeline.componentBindings(scope, page.entries[0].event.id), { ok: true, eventId: page.entries[0].event.id, entries: [] });
  await assert.rejects(api.timeline.branch(scope, {}), /Invalid/);
  const branchCommand = { command: 'create-branch', operationId: crypto.randomUUID(), branchId: `branch-${crypto.randomUUID()}`, thingId: row.id, eventId: page.entries[0].event.id, expectedRevision: 0, name: 'Local variation' };
  const branched = await api.timeline.branch(scope, branchCommand);
  assert.equal((await api.timeline.branches(scope, row.id)).branches[0].branch.id, branchCommand.branchId);
  assert.deepEqual(await api.timeline.branchHead(scope, branchCommand.branchId, row.id), { branch: branched.branch, head: branched.head });
  const checkout = { command: 'checkout-branch', branchId: branchCommand.branchId, thingId: row.id, expectedHeadId: branched.head.eventId, expectedRevision: branched.head.revision };
  assert.equal((await api.timeline.checkoutBranch(scope, checkout)).checkout.entry.event.id, branchCommand.eventId);
  await assert.rejects(async () => api.timeline.branch({ ...scope, dataPlane: 'home' }, branchCommand), /another workspace/);
  await assert.rejects(async () => api.timeline.branchMerge({ ...scope, dataPlane: 'home' }, {}), /another workspace/);
  await assert.rejects(async () => api.timeline.version({ ...scope, ownerId: 'foreign' }, {}), /another workspace/);
  await assert.rejects(api.timeline.version(scope, { command: 'preview-version', mode: 'restore', eventId: 'missing' }), /Version not found/);
  await assert.rejects(api.timeline.branchMerge(scope, { command: 'preview-branch-merge', branchId: branchCommand.branchId, thingId: row.id, expectedHeadId: branched.head.eventId, expectedRevision: 1, eventId: 'missing', choices: {}, componentChoices: {} }), /unavailable/);
  await assert.rejects(async () => api.timeline.checkoutBranch({ ...scope, ownerId: 'foreign' }, checkout), /another workspace/);
  await assert.rejects(async () => api.timeline.page({ ...scope, dataPlane: 'home' }, { thingId: null, before: null, after: null, limit: 40 }), /another workspace/);
  const command = { command: 'add-note', operationId: crypto.randomUUID(), eventId: page.entries[0].event.id, thingId: row.id, text: 'Local API note' };
  await api.timeline.note(scope, command);
  assert.equal((await api.timeline.entry(scope, command.eventId)).notes[0].text, command.text);
  await assert.rejects(async () => api.timeline.note({ ...scope, ownerId: 'another' }, command), /another workspace/);
  const named = { command: 'name-version', operationId: crypto.randomUUID(), eventId: command.eventId, thingId: row.id, name: 'Local named version', expectedRevision: 0 };
  await api.timeline.nameVersion(scope, named);
  assert.equal((await api.timeline.entry(scope, command.eventId)).names[0].name, named.name);
  await assert.rejects(async () => api.timeline.nameVersion({ ...scope, dataPlane: 'home' }, named), /another workspace/);
  const archive = await api.timeline.exportVersion(scope, command.eventId);
  assert.equal(archive.export.name.name, named.name); assert.equal(archive.export.notes[0].text, command.text);
  await assert.rejects(async () => api.timeline.exportVersion({ ...scope, ownerId: 'foreign' }, command.eventId), /another workspace/);
  await assert.rejects(async () => api.timeline.exportVersion({ ...scope, apiOrigin: 'https://other.example' }, command.eventId), /another workspace/);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(api.timeline.exportVersion(scope, command.eventId, { signal: aborted.signal }), /abort/i);
  rootIdentity.changed(); bindLocalWorkspace(false, rootIdentity.read().generation); rootIdentity.confirm(rootIdentity.read().generation);
  await assert.rejects(async () => api.timeline.nameVersion(scope, named), /Workspace changed/);
  await assert.rejects(async () => api.timeline.branch(scope, branchCommand), /Workspace changed/);
  await assert.rejects(async () => api.timeline.branchMerge(scope, {}), /Workspace changed/);
  await assert.rejects(async () => api.timeline.version(scope, {}), /Workspace changed/);
  await assert.rejects(async () => api.timeline.exportVersion(scope, command.eventId), /Workspace changed/);
  await assert.rejects(async () => api.timeline.checkoutBranch(scope, checkout), /Workspace changed/);
  await assert.rejects(async () => api.timeline.note(scope, command), /Workspace changed/);
  await assert.rejects(async () => api.timeline.entry(scope, page.entries[0].event.id), /Workspace changed/);
  assert.equal(remoteCalls, 0);
 } finally { await anonymousWorkspaceDatabase().close(); Object.assign(globalThis, { window: oldWindow, indexedDB: oldFactory }); }
});
