// Opt-in, disposable loopback replica only. All fixtures use the real HTTP API;
// runLopuTool is the production provider-loop entry point (no model billing).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createLopuToolContext, runLopuTool } from '../app/api/utils/lopu/chatTools';
import { createLopuChat, getLopuChat } from '../app/api/utils/messenger/lopuChats';
import { getCurrentUser } from '../app/api/utils/auth/getCurrentUser';
import { verifyLopuConfirmation, mintLopuConfirmation } from '../app/api/utils/lopu/confirmations';
assert.equal(process.env.TT_LOPU_ACTIONS_LOCAL, '1');
assert.equal(process.env.MONGODB_CONNECTION_STRING, 'mongodb://127.0.0.1:22563/?replicaSet=lopuActions');
const base = 'http://127.0.0.1:22562';
let cookie = '';
async function api(path: string, body?: unknown) {
  const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: base }, ...(body ? { body: JSON.stringify(body) } : {}) });
  for (const value of response.headers.getSetCookie()) {
    const pair = value.split(';')[0], key = pair.split('=')[0];
    cookie = [...cookie.split('; ').filter(entry => entry && !entry.startsWith(key + '=')), pair].join('; ');
  }
  const result = await response.json();
  assert.equal(response.ok && result.ok !== false, true, `${path}: ${result.error || response.status}`);
  return result;
}
const suffix = randomUUID().slice(0, 8);
const registered = await api('/api/v1/auth/register', { username: `lopu-actions-${suffix}`, password: 'Synthetic-only-Local-2026!', email: `lopu-actions-${suffix}@example.invalid` });
const actor = () => getCurrentUser(new Request(base + '/api/v1/lopu/chats/reply', { headers: { Cookie: cookie } }));
const viewer = { id: registered.user.id, username: registered.user.username };
const rootId = randomUUID(), equipmentId = randomUUID();
await api('/api/v1/builder/workspaces', { operation: 'initialize', rootId, name: 'Lopu Action QA' });
async function saveAction(crystal: any) {
  const saved = await api('/api/v1/things', { thingtime: ['action'], crystal, acl: ['tt:user'] });
  return saved.thing.id;
}
const save = await saveAction({ name: 'Save equipment', actionKey: `qa-save-${suffix}`, runtime: 'browser', inputs: [{ name: 'title', type: 'string', required: true }], capabilities: [{ capability: 'http.request', endpoints: ['POST /api/v1/builder/workspaces'] }], steps: [
  { op: 'http.request', method: 'POST', path: '/api/v1/builder/workspaces', feature: 'api.builder-workspaces', minimumVersion: '1.0.1', body: { operation: 'save', rootId, id: equipmentId, kind: 'equipment', values: { title: '$input.title', category: 'Battery' } } },
  { op: 'return', value: '$step.1' }
] });
const outer = await saveAction({ name: 'Port equipment', actionKey: `qa-port-${suffix}`, runtime: 'browser', inputs: [{ name: 'title', type: 'string', required: true }], capabilities: [{ capability: 'actions.invoke', actions: [save] }], steps: [ { op: 'actions.invoke', action: save, inputs: { title: '$input.title' } }, { op: 'return', value: '$step.1' } ] });
const chat = await createLopuChat(viewer.id, { title: 'Action access QA' });
assert.equal(chat.ok, true);
if (!chat.ok) throw new Error(chat.error);
const chatId = chat.chat.id;
assert.equal(chat.chat.lopu.accessMode, 'ask');
const readAccessMode = async () => {
  const current = await getLopuChat(viewer.id, chatId);
  if (!current.ok) throw new Error(current.error);
  return current.settings.accessMode || 'ask';
};
const events: any[] = [];
const context = (approved: any[] = []) => createLopuToolContext(viewer, {}, event => events.push(event), { chatId, readAccessMode, resolveActionActor: actor, approved, mint: action => mintLopuConfirmation({ userId: viewer.id, chatId, action }) });
const call = { id: 'port', name: 'run_action', input: { action: outer, inputs: { title: '56V battery' } } };
assert.equal((await runLopuTool(call, context()) as any).needsConfirmation, true);
assert.equal((await api(`/api/v1/builder/workspaces?rootId=${rootId}`)).records.filter((r: any) => r.kind === 'equipment').length, 0);
const card = events.find(event => event.type === 'confirm');
const grant = await verifyLopuConfirmation(card.token, { userId: viewer.id, chatId, key: card.key });
assert.ok(grant);
const confirmed = await runLopuTool(call, context([grant]));
assert.equal(confirmed.ok, true, JSON.stringify(confirmed));
await api('/api/v1/lopu/chats/update', { chatId, accessMode: 'full' });
assert.equal(await readAccessMode(), 'full');
await api('/api/v1/lopu/chats/update', { chatId, title: 'Renamed access QA' });
assert.equal(await readAccessMode(), 'full', 'unrelated settings preserve access');
const rerun = await runLopuTool(call, context());
assert.equal(rerun.ok, true, JSON.stringify(rerun));
const records = (await api(`/api/v1/builder/workspaces?rootId=${rootId}`)).records.filter((r: any) => r.kind === 'equipment');
assert.equal(records.length, 1, 'stable-id retries must not duplicate equipment');
assert.equal(records[0].values.title, '56V battery');
const read = await saveAction({ name: 'Read Thing', actionKey: `qa-read-${suffix}`, runtime: 'browser', inputs: [], capabilities: [{ capability: 'http.request', endpoints: ['GET /api/v1/things'] }], steps: [ { op: 'http.request', method: 'GET', path: '/api/v1/things', feature: 'api.things', minimumVersion: '1.0.0', query: { id: outer } }, { op: 'return', value: '$step.1' } ] });
const readResult = await runLopuTool({ id: 'read', name: 'run_action', input: { action: read } }, context());
assert.equal(readResult.ok, true, JSON.stringify(readResult));
const server = await saveAction({ name: 'Server calculation', actionKey: `qa-server-${suffix}`, inputs: [], capabilities: [], steps: [{ op: 'return', value: { calculated: 42 } }] });
const serverResult = await runLopuTool({ id: 'server', name: 'run_action', input: { action: server } }, context());
assert.equal(serverResult.ok, true, JSON.stringify(serverResult));
assert.equal((serverResult as any).data.result.calculated, 42);
await api('/api/v1/lopu/chats/update', { chatId, accessMode: 'ask' });
assert.equal((await runLopuTool(call, context()) as any).needsConfirmation, true);
await api('/api/v1/lopu/chats/update', { chatId, accessMode: 'full' });
const staleReply = await fetch(base + '/api/v1/lopu/chats/reply', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: base }, body: JSON.stringify({ chatId, text: 'hello', accessMode: 'full' }) });
assert.equal(staleReply.status, 400, 'reply bodies cannot change existing chat permissions');
await api('/api/v1/auth/logout', {});
const revoked = await runLopuTool(call, context());
assert.equal(revoked.ok, false);
console.log('PASS: real registration, nested browser Actions, signed Ask approval, persisted Full/Ask changes, stale reply refusal, workspace upsert/readback, Things API, server Action, revoked session. Disposable replica contains only synthetic fixtures.');
process.exit(0);
