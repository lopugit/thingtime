#!/usr/bin/env node
// Real HTTP regression checks, not mocked utilities or direct database writes.
// Creates two disposable local accounts. Removes their content and pauses their
// schedules in finally; accounts remain, with credentials never persisted.
// No providers, push devices, cron dispatches or production credentials are used.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveDevContext } = require('./worktree-ports.cjs');
const context = resolveDevContext(fileURLToPath(new URL('..', import.meta.url)));
const base = new URL(process.argv[2] || `http://127.0.0.1:${context.ports.web}`);
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) && base.protocol === 'http:'
  && !base.username && !base.password && base.pathname === '/' && !base.search && !base.hash,
  'This mutation smoke test only accepts a loopback HTTP origin.');
let checks = 0;
const fixtures = [], chats = [], schedules = [], cleanupFailures = [];

function account() {
  const jar = new Map();
  return {
    id: null,
    async request(path, body, method = body ? 'POST' : 'GET') {
      const response = await fetch(new URL(path, base), {
        method, redirect: 'error', signal: AbortSignal.timeout(25_000),
        headers: { Origin: base.origin, 'Content-Type': 'application/json',
          Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join('; ') },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(';')[0], separator = pair.indexOf('=');
        jar.set(pair.slice(0, separator), pair.slice(separator + 1));
      }
      return { status: response.status, data: await response.json() };
    }
  };
}
function check(label, condition) {
  assert.ok(condition, label);
  checks++;
  console.log(`PASS ${label}`);
}
function compatible(actual, minimum) {
  const parse = value => /^\d+\.\d+\.\d+$/.test(value || '') ? value.split('.').map(Number) : [];
  const a = parse(actual), b = parse(minimum);
  return a.length === 3 && a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] >= b[2]));
}
const a = account(), b = account();
try {
  const { data: manifest } = await a.request('/.well-known/thingtime-capabilities.json');
  assert.equal(manifest.origin, base.origin);
  for (const [feature, minimum] of Object.entries({
    'api.auth-register': '1.1.0', 'api.things-search': '1.1.1',
    'api.chats-messages': '1.0.0', 'api.lopu-chats-delete': '1.0.1',
    'api.things': '1.8.1', 'api.things-comment': '1.4.0',
    'api.lopu-reminders': '1.1.0', 'api.lopu-voice-capture': '1.0.0'
  })) assert.ok(compatible(manifest.features?.[feature]?.version, minimum), `${feature} ${minimum} required`);
  for (const client of [a, b]) {
    const username = `qa_lopu_${randomBytes(7).toString('hex')}`;
    const result = await client.request('/api/v1/auth/register', {
      username, password: randomBytes(32).toString('base64url'),
      email: `${username}@example.invalid`, displayName: 'Disposable Lopu API QA'
    });
    assert.equal(result.status, 200, 'local signup');
    client.id = result.data.user.id;
  }
  check('two isolated API-registered accounts', a.id !== b.id);
  const created = await a.request('/api/v1/things', { thingtime: ['data'], acl: ['tt:user'],
    crystal: { title: `Scheduled chat QA ${randomUUID()}`, note: 'Parent data must remain unchanged' } });
  check('private source Thing created', created.status === 200 && created.data.thing?.id);
  const source = created.data.thing; fixtures.push(source.id);
  const comment = await a.request('/api/v1/things/comment', {
    id: source.id, text: 'Separate contextual QA comment', shareId: randomUUID()
  });
  check('relational comment created', comment.status === 200 && comment.data.comment?.id);
  fixtures.push(comment.data.comment.id);
  const parent = await a.request(`/api/v1/things?id=${source.id}`);
  assert.deepEqual(parent.data.thing.crystal, source.crystal);
  check('comment leaves parent crystal unchanged', true);
  const comments = await a.request(`/api/v1/things?target=${source.id}&thingtime=comment`);
  check('comment fetched by target relationship', comments.data.things?.some(t => t.id === comment.data.comment.id));
  const input = { ownerId: a.id, sessionId: randomUUID(), eventId: 'user-1', role: 'user', text: 'Remember the violet lighthouse' };
  const capture = await a.request('/api/v1/lopu/voice/capture', input);
  check('voice starts a persisted Lopu chat', capture.status === 200 && capture.data.chatId);
  const chatId = capture.data.chatId; chats.push(chatId);
  const replay = await a.request('/api/v1/lopu/voice/capture', input);
  assert.deepEqual(replay.data.messages.map(m => m.id), capture.data.messages.map(m => m.id));
  check('voice retry uses the same chat and message', replay.data.chatId === chatId);
  const assistant = await a.request('/api/v1/lopu/voice/capture', { ...input, eventId: 'assistant-1', role: 'assistant', chatId, text: 'The lighthouse is violet.' });
  check('assistant transcript saved in that chat', assistant.status === 200 && assistant.data.chatId === chatId);
  const messages = await a.request(`/api/v1/chats/messages?chatId=${chatId}`);
  check('Messenger history contains both voice turns', messages.status === 200 && [...capture.data.messages, ...assistant.data.messages].every(m => messages.data.messages?.some(row => row.id === m.id)));
  const schedule = await a.request('/api/v1/lopu/reminders', { op: 'create', title: `QA scheduled message ${randomUUID()}`,
    description: 'A saved scheduled update', mode: 'message', chatId, relatedThingIds: [source.id],
    at: new Date(Date.now() + 3_600_000).toISOString(), everyMinutes: 5, timeZone: 'Australia/Melbourne', delivery: 'quiet' });
  check('scheduled chat message creates a Thing and protected control', schedule.status === 200 && schedule.data.reminder?.thingId);
  const reminder = schedule.data.reminder; schedules.push(reminder.id); fixtures.push(reminder.thingId);
  const task = await a.request(`/api/v1/things?id=${reminder.thingId}`);
  check('schedule appears through ordinary Thing reads', task.data.thing?.crystal.type === 'scheduled-task');
  const search = await a.request('/api/v1/things/search', { conditions: [{ field: 'shareId', op: 'eq', value: reminder.thingId }] });
  check('schedule is searchable as a Thing', search.data.things?.some(t => t.id === reminder.thingId));
  const detail = await a.request(`/api/v1/lopu/reminders?thingId=${reminder.thingId}`);
  check('schedule links its conversation and source Thing', detail.data.reminder?.chatId === chatId && detail.data.relatedThings?.some(t => t.id === source.id));
  check('other account cannot inspect schedule details', (await b.request(`/api/v1/lopu/reminders?thingId=${reminder.thingId}`)).status === 404);
  check('other account cannot inspect voice history', [403, 404].includes((await b.request(`/api/v1/chats/messages?chatId=${chatId}`)).status));
  // Protected means dedicated writes, not that owners cannot inspect their own
  // safe projection. A direct read must still enforce the account boundary.
  check('other account cannot read the execution control', (await b.request(`/api/v1/things?id=${reminder.id}`)).status === 404);
  check('generic CRUD cannot reprogram the execution control', (await a.request('/api/v1/things', { id: reminder.id, crystal: { enabled: false } }, 'PATCH')).status === 403);
  for (const enabled of [false, true]) {
    const result = await a.request('/api/v1/lopu/reminders', { op: 'set-enabled', id: reminder.id, enabled });
    check(`schedule ${enabled ? 'resume' : 'pause'} persists`, result.status === 200 && result.data.reminder.enabled === enabled);
  }
  console.log(`${checks} real HTTP checks passed. Provider inference, scheduled delivery, device uploads and rendered UI are NOT covered.`);
} finally {
  for (const id of schedules) {
    try { if ((await a.request('/api/v1/lopu/reminders', { op: 'set-enabled', id, enabled: false })).status !== 200) cleanupFailures.push('schedule pause'); }
    catch { cleanupFailures.push('schedule pause'); }
  }
  for (const id of fixtures.reverse()) {
    try { if (![200, 404].includes((await a.request('/api/v1/things', { id }, 'DELETE')).status)) cleanupFailures.push('Thing cleanup'); }
    catch { cleanupFailures.push('Thing cleanup'); }
  }
  for (const chatId of chats) {
    try { if (![200, 404].includes((await a.request('/api/v1/lopu/chats/delete', { chatId })).status)) cleanupFailures.push('chat cleanup'); }
    catch { cleanupFailures.push('chat cleanup'); }
  }
  assert.equal(cleanupFailures.length, 0, `Cleanup incomplete: ${cleanupFailures.join(', ')}`);
  console.log('Created content removed; schedules paused. Disposable local accounts remain; credentials were not saved.');
}
