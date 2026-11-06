import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
let docs: any[] = [], characters: any[] = [], calls = 0, revoked = false, missingScope = false, disabled = false, member = true, customPlane = false, publicSpace = false, wrongAccount = false, badSchema = false, crashAfterWrite = false;
const owner = { _id: 'owner', id: 'owner', username: 'owner' };
const pat = { jti: 'token', scopes: ['agents.report'], visibility: 'private', onlyCreatedThings: false };
const equal = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);
const get = (value: any, path: string) => path.split('.').reduce((v, key) => v?.[key], value);
const match = (doc: any, filter: any): boolean => Object.entries(filter).every(([key, value]: [string, any]) => {
  const actual = get(doc, key);
  if (value && Object.hasOwn(value, '$exists')) return (actual !== undefined) === value.$exists;
  if (key === 'thingtime') return doc.thingtime.includes(value);
  if (key === 'uniqueKeys') return doc.uniqueKeys?.some((entry: any) => equal(entry, value));
  return equal(actual, value);
});
const set = (doc: any, path: string, value: any) => { const parts = path.split('.'); const key = parts.pop()!; const target = parts.reduce((v, k) => v[k] ??= {}, doc); target[key] = value; };
let lockGate: { requestId: string; reached: () => void; released: Promise<void> } | null = null;
const collection = {
  findOne: async (filter: any) => { const doc = docs.find(doc => match(doc, filter)); return doc ? structuredClone(doc) : null; },
  insertOne: async (doc: any) => { if (doc.uniqueKeys?.some((key: any) => docs.some(other => other.uniqueKeys?.some((entry: any) => equal(key, entry))))) throw Object.assign(new Error(), { code: 11000 }); docs.push(doc); },
  updateOne: async (filter: any, mutation: any) => { if (lockGate && mutation.$set?.['crystal.activeOperation'] === lockGate.requestId) { lockGate.reached(); await lockGate.released; } const doc = docs.find(doc => match(doc, filter)); if (!doc) return { modifiedCount: 0 }; for (const [key, value] of Object.entries(mutation.$set || {})) set(doc, key, value); for (const key of Object.keys(mutation.$unset || {})) { const parts = key.split('.'); const leaf = parts.pop()!; delete parts.reduce((v, k) => v[k], doc)[leaf]; } return { modifiedCount: 1 }; }
};
mock.module('../auth/patTokens', { namedExports: {
  resolveThingsActor: async () => missingScope ? { ok: false, status: 403, error: 'This token was not granted the agents.report scope' } : { ok: true, actor: { user: wrongAccount ? { id: 'foreign', username: 'foreign' } : owner, pat } },
  revalidateThingsActor: async () => ({ ok: true, actor: { user: revoked ? null : owner, pat } })
} });
mock.module('../auth/users', { namedExports: { findUserById: async (id: string) => id === 'owner' ? owner : characters.find(c => c._id === id) } });
mock.module('../auth/characters', { namedExports: {
  canManageCharacters: (user: any) => user?._id === 'owner',
  createCharacter: async (_owner: any, input: any) => { let c = characters.find(c => c.requestId === input.requestId); if (!c) { c = { _id: input.requestId, username: `character-${input.requestId}`, requestId: input.requestId, meta: { character: { ownerId: 'owner', loginMode: 'switch', disabled: false } } }; characters.push(c); } return { ok: true, character: { user: { id: c._id } } }; }
} });
mock.module('../mongodb/endpoint', { namedExports: { isCustomMongoEndpointActive: () => customPlane } });
mock.module('../mongodb/collections', { namedExports: { getThingsCollection: async () => collection } });
mock.module('../messenger/shared', { namedExports: { newThingDoc: (kind: string, fields: any) => ({ ...fields, shareId: fields.shareId || `receipt-${docs.length}`, thingtime: [kind], acl: ['tt:user'], createdAt: new Date() }) } });
mock.module('../subspaces/gate', { namedExports: {
  findSubspaceById: async (id: string) => id === 'agents' ? { shareId: id, crystal: { access: publicSpace ? 'public' : 'private' } } : null,
  findSubspaceBySlug: async () => null, accessOf: (doc: any) => doc.crystal.access,
  canModerate: (membership: any) => membership?.role === 'owner', isActiveMember: (membership: any) => !!membership && !membership.left,
  membershipOf: async (_subspace: string, userId: string) => userId === 'owner' ? { role: 'owner' } : member ? { role: 'member' } : { role: 'member', left: true }
} });
mock.module('../subspaces/subspaces', { namedExports: { listSubspaces: async () => ({ ok: true, subspaces: [{ id: 'agents', name: 'Thingtime Agents' }], nextCursor: null }), mutateMember: async () => ({ ok: true }) } });
mock.module('../things/things', { namedExports: {
  createThing: async (ownerId: string, input: any) => { const doc = { shareId: input.shareId, ownerId, thingtime: input.thingtime, acl: input.acl, crystal: input.crystal, subspacePrivate: true }; docs.push(doc); return { ok: true, doc }; },
  viewerOf: (user: any) => ({ id: user.id, username: user.username }),
  getThing: async (viewer: any, id: string) => { const doc = docs.find(doc => doc.shareId === id); return doc && (viewer?.id === doc.ownerId || (doc.subspacePrivate ? viewer?.id === 'owner' : (doc.acl.includes(`tt:user/${viewer?.username}`) || doc.acl.includes(`tt:user/${viewer?.username}/write`)))) ? { ok: true, thing: { id, thingtime: doc.thingtime, crystal: doc.crystal, author: { id: doc.ownerId } } } : { ok: false, status: 404, error: 'Thing not found' }; },
  updateThing: async (_viewer: any, id: string, patch: any, options: any = {}) => { if (options.expectedUpdatedAt instanceof Date) return { ok: false, status: 400, error: 'expectedUpdatedAt must be an ISO timestamp' }; const doc = docs.find(doc => doc.shareId === id); if (patch.acl) doc.acl = patch.acl; if (patch.crystal) doc.crystal = { ...doc.crystal, ...patch.crystal }; return { ok: true }; }
} });
mock.module('../actions/execute', { namedExports: { runAction: async (viewer: any, request: any, _shared: any, context: any) => {
  calls++; await context.assertAuthorized();
  if (disabled) characters[0].meta.character.disabled = true;
  if (request.action === 'action-updateWorkItem') {
    try { await context.operationPolicy.access(request.inputs.recordId, 'update'); await context.operationPolicy.update(request.inputs.recordId, { status: request.inputs.status }); }
    catch (error: any) { return { ok: true, status: 'error', error: error.message }; }
    docs.find(doc => doc.shareId === request.inputs.recordId).crystal.status = request.inputs.status;
    return { ok: true, status: 'ok' };
  }
  const role = request.action.replace('action-', '');
  await context.operationPolicy.step('things.create');
  let stamped;
  try { stamped = await context.operationPolicy.create(badSchema ? 'foreign-schema' : role, request.inputs, '1'); }
  catch (error: any) { return { ok: true, status: 'error', error: error.message }; }
  docs.push({ shareId: stamped.shareId, ownerId: viewer.id, thingtime: ['data'], crystal: { ...request.inputs, ...stamped.crystal, schemaId: role }, acl: stamped.acl });
  if (crashAfterWrite) throw new Error('simulated interrupted execution');
  return { ok: true, status: 'ok' };
} } });
const { agentReporting } = await import('./reporting');
const workspace = { subspaceId: 'agents', pages: { overview: 'overview', taskDetail: 'detail' }, schemas: Object.fromEntries(['project', 'task', 'agent', 'todo', 'progress', 'question'].map(role => [role, role])), actions: { createTask: 'action-task', addProgress: 'action-progress', createProject: 'action-project', createAgent: 'action-agent', updateWorkItem: 'action-updateWorkItem' } };
const request = () => new Request('https://thingtime.test/api/v1/agents/reporting', { headers: { Authorization: 'Bearer token' } });
const body = (operation: string, extra: any = {}) => ({ operation, origin: 'https://thingtime.test', externalTaskId: 'chat-stable', ...extra });
const reset = () => {
  docs = Object.entries({ overview: 'webpage', detail: 'webpage', ...Object.fromEntries(Object.values(workspace.schemas).map(id => [id, 'schema'])), ...Object.fromEntries(Object.values(workspace.actions).map(id => [id, 'action'])) }).map(([shareId, kind]) => ({ shareId, ownerId: 'owner', thingtime: [kind], acl: ['tt:user'], crystal: {}, updatedAt: new Date() }));
  lockGate = null; characters = []; calls = 0; revoked = false; missingScope = false; disabled = false; member = true; customPlane = false; publicSpace = false; wrongAccount = false; badSchema = false; crashAfterWrite = false;
};
const prepare = () => agentReporting(request(), body('prepare', { displayName: 'Reporter', workspace }));
const report = (requestId = '12345678-1234-4123-a123-123456789abc', inputs = { title: 'Task' }) => agentReporting(request(), body('report', { requestId, actionName: 'createTask', inputs }));

test('legacy things tokens get a precise missing scope and never create a Character', async () => { reset(); missingScope = true; const result = await prepare(); assert.equal(result.ok, false); assert.equal(result.status, 403); assert.match(result.error, /agents.report/); assert.equal(characters.length, 0); });
test('wrong origin and foreign/public workspace references fail before delegation', async () => {
  reset(); assert.equal((await agentReporting(request(), { ...body('prepare'), origin: 'https://wrong.test', displayName: 'Reporter', workspace })).ok, false);
  for (const field of ['ownerId', 'acl']) { reset(); docs[0][field] = field === 'ownerId' ? 'foreign' : ['tt:all']; assert.equal((await prepare()).ok, false); assert.equal(characters.length, 0); }
});
test('prepare reuses the task Character and exact workspace IDs; revoked membership and Character stay revoked', async () => {
  reset(); const first = await prepare(); const second = await prepare(); assert.equal(first.ok, true); assert.equal(second.ok, true); assert.equal(characters.length, 1); assert.equal(first.binding.characterId, second.binding.characterId);
  member = false; assert.equal((await prepare()).ok, false); member = true; characters[0].meta.character.disabled = true; assert.equal((await prepare()).ok, false);
});
test('immutable request receipt and task lock prevent duplicate and concurrent writes', async () => {
  reset(); await prepare(); const results = await Promise.all([report(), report()]); assert.equal(results.filter(result => result.ok).length >= 1, true); assert.equal(calls, 1);
  const replay = await report(); assert.equal(replay.ok, true); assert.equal(calls, 1);
  assert.equal((await report(undefined, { title: 'changed' })).ok, false); assert.equal(calls, 1);
  assert.equal((await report('22345678-1234-4123-a123-123456789abc')).ok, false); assert.equal(calls, 2);
});
test('get independently reads back Character-authored private rows visible to the owner', async () => {
  reset(); await prepare(); const created = await report(); assert.equal(created.ok, true);
  const read = await agentReporting(request(), body('get')); assert.equal(read.ok, true); assert.equal(read.records.length, 1); assert.equal(read.records[0].author.id, characters[0]._id);
  assert.equal((await agentReporting(request(), body('get', { recordIds: ['overview'] }))).ok, false);
});
test('revocation before a step and disabled Character after a write fence completion', async () => {
  reset(); await prepare(); revoked = true; assert.equal((await report()).ok, false); assert.equal(calls, 0);
  reset(); await prepare(); disabled = true; assert.equal((await report()).ok, false); assert.equal(docs.some(doc => doc.thingtime.includes('agent-reporting-operation') && doc.crystal.status === 'complete'), false);
});


test('custom database, wrong account and public coordination are refused before delegation', async () => {
  for (const condition of ['plane', 'account', 'audience']) {
    reset(); if (condition === 'plane') customPlane = true; if (condition === 'account') wrongAccount = true; if (condition === 'audience') publicSpace = true;
    assert.equal((await prepare()).ok, false); assert.equal(characters.length, 0);
  }
});
test('foreign schema Action is fenced before data effects and a corrected new request can proceed', async () => {
  reset(); await prepare(); badSchema = true;
  assert.equal((await report()).ok, false);
  assert.equal(docs.filter(doc => doc.thingtime.includes('data')).length, 0);
  assert.equal((await agentReporting(request(), body('get'))).activeOperation, null);
  badSchema = false; assert.equal((await report('22345678-1234-4123-a123-123456789abc')).ok, true);
});
test('interruption preserves safe receipt diagnostics and never takes over uncertain effects', async () => {
  reset(); await prepare(); crashAfterWrite = true; assert.equal((await report()).ok, false);
  const inspection = await agentReporting(request(), body('get'));
  assert.equal(inspection.ok, true); assert.equal(inspection.activeOperation.status, 'pending');
  assert.equal(inspection.activeOperation.mutationAttempted, true); assert.equal(inspection.activeOperation.createdIds.length, 1);
  assert.equal((await report('22345678-1234-4123-a123-123456789abc')).ok, false); assert.equal(calls, 1);
});

test('completed prepare never repairs a revoked workspace grant', async () => {
  reset(); await prepare(); const page = docs.find(doc => doc.shareId === 'overview'); page.acl = ['tt:user'];
  assert.equal((await prepare()).ok, false); assert.deepEqual(page.acl, ['tt:user']);
});
test('private data access rejects public rows and legacy-name schema substitution', async () => {
  for (const mode of ['public', 'foreign']) {
    reset(); await prepare(); const created = await report(); const id = created.receipt.result.ids[0]; const row = docs.find(doc => doc.shareId === id);
    if (mode === 'public') row.acl = ['tt:user', 'tt:all']; else { row.crystal.schema = 'task'; row.crystal.schemaId = 'foreign-schema'; }
    assert.equal((await agentReporting(request(), body('get', { recordIds: [id] }))).ok, false);
  }
});
test('concurrent prepare cannot extend the winning immutable workspace with loser references', async () => {
  reset(); docs.push({ shareId: 'alternate-action', ownerId: 'owner', thingtime: ['action'], acl: ['tt:user'], crystal: {} });
  const other = { ...workspace, actions: { ...workspace.actions, createTask: 'alternate-action' } };
  const results = await Promise.all([prepare(), agentReporting(request(), body('prepare', { displayName: 'Reporter', workspace: other }))]);
  assert.equal(results.filter(result => result.ok).length, 1); assert.equal(results.filter(result => !result.ok).length, 1);
  const binding = docs.find(doc => doc.thingtime.includes('agent-reporting-binding'));
  const unused = binding.crystal.workspace.actions.createTask === 'alternate-action' ? 'action-task' : 'alternate-action';
  assert.deepEqual(docs.find(doc => doc.shareId === unused).acl, ['tt:user']);
});

const coordinate = (requestId: string, text = 'Started work') => agentReporting(request(), body('coordinate', { requestId, title: 'Task coordination', text, renderComponent: { name: 'Task status', render: '<p>{{text}}</p>' } }));
test('coordination creates one Character post and reuses it on update and retry', async () => {
  reset(); await prepare();
  const first = await coordinate('12345678-1234-4123-a123-123456789abc'); assert.equal(first.ok, true);
  const second = await coordinate('22345678-1234-4123-a123-123456789abc', 'Completed work'); assert.equal(second.ok, true);
  assert.equal(first.binding.coordinationPostId, second.binding.coordinationPostId);
  assert.equal((await coordinate('22345678-1234-4123-a123-123456789abc', 'Completed work')).ok, true);
  const posts = docs.filter(doc => doc.thingtime.includes('post')); assert.equal(posts.length, 1); assert.equal(posts[0].ownerId, characters[0]._id);
  assert.equal(posts[0].subspacePrivate, true); assert.equal(posts[0].crystal.subspaceId, 'agents');
  const inspection = await agentReporting(request(), body('get')); assert.equal(inspection.coordinationPost.crystal.text, 'Completed work');
});
test('coordination and reporting refuse a later owner subspace visibility change', async () => {
  reset(); await prepare(); assert.equal((await coordinate('12345678-1234-4123-a123-123456789abc')).ok, true);
  publicSpace = true;
  assert.equal((await coordinate('22345678-1234-4123-a123-123456789abc')).ok, false);
  assert.equal((await agentReporting(request(), body('get'))).ok, false);
  assert.equal((await report('32345678-1234-4123-a123-123456789abc')).ok, false);
});

test('an inaccessible coordination Component returns a structured failure before any post or receipt', async () => {
  reset(); await prepare();
  const result = await agentReporting(request(), body('coordinate', { requestId: '12345678-1234-4123-a123-123456789abc', title: 'Task', text: 'Status', renderComponent: { id: 'missing-component' } }));
  assert.equal(result.ok, false); assert.equal(result.status, 404); assert.equal(result.error, 'Thing not found');
  assert.equal(docs.some(doc => doc.thingtime.includes('post') || doc.thingtime.includes('agent-reporting-operation')), false);
});

test('post-lock refresh rejects a stale second primary create after the first operation completes', async () => {
  reset(); await prepare();
  let reached!: () => void, release!: () => void;
  const waiting = new Promise<void>(resolve => { reached = resolve; });
  lockGate = { requestId: '22345678-1234-4123-a123-123456789abc', reached, released: new Promise<void>(resolve => { release = resolve; }) };
  const later = report(lockGate.requestId); await waiting;
  assert.equal((await report()).ok, true); release();
  assert.equal((await later).ok, false); assert.equal(docs.filter(doc => doc.thingtime.includes('data')).length, 1);
});
test('post-lock refresh updates an intervening coordination post instead of creating it again', async () => {
  reset(); await prepare();
  let reached!: () => void, release!: () => void;
  const waiting = new Promise<void>(resolve => { reached = resolve; });
  lockGate = { requestId: '22345678-1234-4123-a123-123456789abc', reached, released: new Promise<void>(resolve => { release = resolve; }) };
  const later = coordinate(lockGate.requestId, 'Second status'); await waiting;
  assert.equal((await coordinate('12345678-1234-4123-a123-123456789abc')).ok, true); release();
  assert.equal((await later).ok, true); const posts = docs.filter(doc => doc.thingtime.includes('post')); assert.equal(posts.length, 1); assert.equal(posts[0].crystal.text, 'Second status');
});

const reportFor = (externalTaskId: string, actionName: string, requestId: string, inputs: any) => agentReporting(request(), body('report', { externalTaskId, actionName, requestId, inputs }));
test('child preparation derives real parent links and shares only exact parent roots for read', async () => {
  reset(); await prepare();
  const project = await reportFor('chat-stable', 'createProject', '12345678-1234-4123-a123-123456789abc', { title: 'Project' }); assert.equal(project.ok, true);
  const parent = await reportFor('chat-stable', 'createTask', '22345678-1234-4123-a123-123456789abc', { title: 'Parent' }); assert.equal(parent.ok, true);
  const child = await agentReporting(request(), body('prepare', { externalTaskId: 'child-chat', parentExternalTaskId: 'chat-stable', displayName: 'Child reporter', workspace }));
  assert.equal(child.ok, true); assert.notEqual(child.binding.characterId, parent.binding.characterId);
  assert.equal(child.binding.records.projectId, project.binding.records.projectId); assert.equal(child.binding.parentTaskId, parent.binding.records.taskId);
  const task = await reportFor('child-chat', 'createTask', '32345678-1234-4123-a123-123456789abc', { title: 'Child', parentId: 'untrusted' }); assert.equal(task.ok, true);
  const taskRow = docs.find(doc => doc.shareId === task.binding.records.taskId); assert.equal(taskRow.crystal.parentId, parent.binding.records.taskId); assert.equal(taskRow.crystal.taskId, parent.binding.records.taskId);
  const agent = await reportFor('child-chat', 'createAgent', '42345678-1234-4123-a123-123456789abc', { name: 'Worker' }); assert.equal(agent.ok, true);
  const agentRow = docs.find(doc => doc.shareId === agent.binding.records.agentId); assert.equal(agentRow.crystal.parentId, task.binding.records.taskId); assert.equal(agentRow.crystal.taskId, parent.binding.records.taskId);
  const forbidden = await reportFor('child-chat', 'updateWorkItem', '52345678-1234-4123-a123-123456789abc', { recordId: parent.binding.records.taskId, status: 'complete' }); assert.equal(forbidden.ok, false);
  assert.equal((await agentReporting(request(), body('get', { externalTaskId: 'child-chat' }))).ok, true);
});
test('child preparation refuses absent, self and mismatched-workspace parents before creating a Character', async () => {
  reset(); await prepare();
  for (const parentExternalTaskId of ['missing-parent', 'child-chat', 'chat-stable']) {
    const result = await agentReporting(request(), body('prepare', { externalTaskId: 'child-chat', parentExternalTaskId, displayName: 'Child', workspace }));
    assert.equal(result.ok, false); assert.equal(characters.length, 1);
  }
});

test('nested child inherits the root project actor and refuses ancestor revocation', async () => {
  reset(); await prepare();
  const rootProject = await reportFor('chat-stable', 'createProject', '12345678-1234-4123-a123-123456789abc', { title: 'Project' }); assert.equal(rootProject.ok, true);
  const rootTask = await reportFor('chat-stable', 'createTask', '22345678-1234-4123-a123-123456789abc', { title: 'Root' }); assert.equal(rootTask.ok, true);
  const child = await agentReporting(request(), body('prepare', { externalTaskId: 'child-chat', parentExternalTaskId: 'chat-stable', displayName: 'Child', workspace })); assert.equal(child.ok, true);
  const childTask = await reportFor('child-chat', 'createTask', '32345678-1234-4123-a123-123456789abc', { title: 'Child' }); assert.equal(childTask.ok, true);
  const grandchild = await agentReporting(request(), body('prepare', { externalTaskId: 'grandchild-chat', parentExternalTaskId: 'child-chat', displayName: 'Grandchild', workspace })); assert.equal(grandchild.ok, true);
  assert.equal(grandchild.binding.parentTaskId, childTask.binding.records.taskId); assert.equal(grandchild.binding.sharedTaskId, rootTask.binding.records.taskId);
  assert.equal(grandchild.binding.records.projectId, rootProject.binding.records.projectId);
  const read = await agentReporting(request(), body('get', { externalTaskId: 'grandchild-chat' })); assert.equal(read.ok, true); assert.equal(read.records[0].author.id, rootProject.binding.characterId);
  const grandTask = await reportFor('grandchild-chat', 'createTask', '42345678-1234-4123-a123-123456789abc', { title: 'Grandchild' }); assert.equal(grandTask.ok, true);
  const row = docs.find(doc => doc.shareId === grandTask.binding.records.taskId); assert.equal(row.crystal.parentId, childTask.binding.records.taskId); assert.equal(row.crystal.taskId, rootTask.binding.records.taskId);
  const rootCharacter = characters.find(c => c._id === rootProject.binding.characterId); rootCharacter.meta.character.disabled = true;
  assert.equal((await agentReporting(request(), body('get', { externalTaskId: 'grandchild-chat' }))).ok, false);
  rootCharacter.meta.character.disabled = false;
  characters.find(c => c._id === child.binding.characterId).meta.character.disabled = true;
  assert.equal((await agentReporting(request(), body('get', { externalTaskId: 'grandchild-chat' }))).ok, false);
});
