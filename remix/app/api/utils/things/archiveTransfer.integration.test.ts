import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { capabilitySatisfies, THINGTIME_CAPABILITY_MANIFEST_PATH } from '../capabilities/capabilityContract';

const fixtureOrigin = (value: string, remoteDev: boolean, username?: string) => {
  const origin = new URL(value);
  const local = ['localhost', '127.0.0.1'].includes(origin.hostname) && ['http:', 'https:'].includes(origin.protocol);
  const dev = origin.protocol === 'https:' && !origin.port &&
    (origin.hostname === 'dev.thingtime.com' || /^pr-[1-9][0-9]*\.previews\.dev\.thingtime\.com$/.test(origin.hostname));
  assert.ok(!origin.username && !origin.password && origin.pathname + origin.search + origin.hash === '/', 'Use a credential-free fixture origin');
  assert.ok(local || (remoteDev && dev && !!username?.trim()), 'Remote tests require explicit dev consent and fixture identity; production is prohibited');
  return origin;
};

test('archive live-test origin fence refuses production, lookalikes and implicit remote writes', () => {
  assert.equal(fixtureOrigin('http://localhost:12280', false).hostname, 'localhost');
  assert.equal(fixtureOrigin('https://pr-764.previews.dev.thingtime.com', true, 'fixture').protocol, 'https:');
  for (const url of ['https://thingtime.com', 'https://dev.thingtime.com.evil.test', 'http://dev.thingtime.com',
    'https://dev.thingtime.com:444', 'https://user:password@dev.thingtime.com', 'https://dev.thingtime.com/p/one']) {
    assert.throws(() => fixtureOrigin(url, true, 'fixture'));
  }
  assert.throws(() => fixtureOrigin('https://dev.thingtime.com', false, 'fixture'));
  assert.throws(() => fixtureOrigin('https://dev.thingtime.com', true));
});

test('real private archive import/read/delete preserves history and substitutes only the importing identity', {
  skip: process.env.TT_TRANSFER_ARCHIVE_TEST !== '1', timeout: 180_000
}, async () => {
  const base = process.env.TT_TRANSFER_TEST_URL;
  const cookie = process.env.TT_TRANSFER_TEST_COOKIE;
  const expectedUsername = process.env.TT_TRANSFER_TEST_USERNAME;
  assert.ok(base && cookie && expectedUsername, 'Set the fixture origin, cookie and expected username');
  const origin = fixtureOrigin(base!, process.env.TT_TRANSFER_REMOTE_DEV_TEST === '1', expectedUsername);
  const request = async (path: string, method = 'GET', body?: unknown, authenticated = true) => {
    const url = new URL(path, origin);
    assert.equal(url.origin, origin.origin, 'Credentials must remain on the fixture origin');
    const response = await fetch(url, { method, redirect: 'error',
      headers: { 'Content-Type': 'application/json', Origin: origin.origin, ...(authenticated ? { Cookie: cookie! } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) });
    const data = await response.json();
    return { status: response.status, cache: response.headers.get('cache-control'), data };
  };
  const capabilities = await request(THINGTIME_CAPABILITY_MANIFEST_PATH);
  assert.equal(capabilities.status, 200); assert.equal(capabilities.data.origin, origin.origin);
  for (const [feature, version] of Object.entries({ 'api.auth-me': '1.0.0', 'api.things-import': '1.9.0', 'api.things': '1.13.0' })) {
    assert.ok(capabilitySatisfies(capabilities.data.features?.[feature]?.version, version), `Missing ${feature} ${version}; no archive created`);
  }
  const me = await request('/api/v1/auth/me');
  assert.equal(me.status, 200); assert.ok(me.data.user?.id, 'Fixture session required');
  assert.ok(me.data.user.username === expectedUsername, 'Unexpected fixture account; no archive created');
  const at = '2026-09-01T00:00:00.000Z';
  const name = `Archive transfer fixture ${randomUUID()}`;
  const things = [
    { id: 'archive', thingtime: ['chat-archive'], crystal: { name, topic: 'Private test history', chatType: 'dm', createdAt: at, selfParticipantId: 'self' } },
    { id: 'self', targetId: 'archive', thingtime: ['chat-archive-participant'], crystal: { username: 'fictional-original', displayName: 'Original self', nickname: '', joinedAt: at } },
    { id: 'friend', targetId: 'archive', thingtime: ['chat-archive-participant'], crystal: { username: 'fictional-archived-friend', displayName: 'Archived friend', nickname: 'F', joinedAt: at } },
    { id: 'message', targetId: 'archive', thingtime: ['chat-archive-message'], crystal: { participantId: 'self', text: 'Exact\n history 🥰', createdAt: at, deleted: false } },
    { id: 'reply', targetId: 'archive', thingtime: ['chat-archive-message'], crystal: { participantId: 'friend', text: 'Historical reply', createdAt: at, deleted: false, replyToId: 'message', threadRootId: 'message' } },
    { id: 'reaction', targetId: 'message', thingtime: ['chat-archive-reaction'], crystal: { participantId: 'friend', emoji: '🥰', createdAt: at } }
  ];
  let created: string | undefined;
  try {
    const imported = await request('/api/v1/things/import', 'POST', { manifest: { format: 'thingtime.transfer', version: 1, roots: ['archive'], things, files: [] } });
    // Record the returned cleanup anchor before checking response details.
    if (typeof imported.data?.ids?.archive === 'string') created = imported.data.ids.archive;
    assert.equal(imported.status, 200, `Archive import returned ${imported.status}`);
    assert.ok(created && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(created), 'Import did not return a safe cleanup anchor');
    const ids = imported.data.ids;
    assert.equal(imported.data.imported, things.length);
    assert.equal(new Set(Object.values(ids)).size, things.length);
    assert.ok(Object.values(ids).every(id => !things.some(row => row.id === id) && id !== me.data.user.id));
    const path = `/api/v1/things?id=${encodeURIComponent(created!)}&archive=true`;
    const anonymous = await request(path, 'GET', undefined, false);
    assert.equal(anonymous.status, 401); assert.match(anonymous.cache || '', /no-store/);
    const read = await request(path);
    assert.equal(read.status, 200); assert.match(read.cache || '', /private/); assert.match(read.cache || '', /no-store/);
    const group = read.data.archive.group;
    assert.equal(group.root.id, created); assert.equal(group.root.crystal.selfParticipantId, ids.self);
    assert.equal(group.self.id, ids.self); assert.equal(group.participants.length, 2); assert.equal(group.messages.length, 2);
    assert.equal(group.participants.find((row: any) => row.id === ids.friend).crystal.username, 'fictional-archived-friend');
    const message = group.messages.find((row: any) => row.id === ids.message);
    const reply = group.messages.find((row: any) => row.id === ids.reply);
    assert.equal(message.crystal.text, 'Exact\n history 🥰'); assert.equal(message.crystal.participantId, ids.self);
    assert.equal(reply.crystal.participantId, ids.friend); assert.equal(reply.crystal.replyToId, ids.message); assert.equal(reply.crystal.threadRootId, ids.message);
    assert.equal(group.reactions[0].targetId, ids.message); assert.equal(group.reactions[0].crystal.participantId, ids.friend);
    assert.doesNotMatch(JSON.stringify(read.data.archive), /"(?:ownerId|userId|acl|tokenAcl|archiveVersion|appId)"/);
    const participantDelete = await request('/api/v1/things', 'DELETE', { id: ids.friend });
    assert.equal(participantDelete.status, 404, 'Individual archived participants must remain protected');
    const attemptedEdit = await request('/api/v1/things', 'PATCH', { id: ids.message, crystal: { text: 'Not historical' } });
    assert.ok([403, 404].includes(attemptedEdit.status), 'Generic writes must not change archive history');
    const unchanged = await request(path);
    assert.equal(unchanged.status, 200);
    assert.equal(unchanged.data.archive.group.messages.find((row: any) => row.id === ids.message).crystal.text, 'Exact\n history 🥰');
    const stale = await request('/api/v1/things', 'DELETE', { id: created, expectedUpdatedAt: at });
    assert.equal(stale.status, 409); assert.equal((await request(path)).status, 200);
    const removed = await request('/api/v1/things', 'DELETE', { id: created, expectedUpdatedAt: read.data.archive.updatedAt });
    assert.equal(removed.status, 200);
    assert.equal((await request(path)).status, 404);
    created = undefined;
  } finally {
    if (created) {
      const cleanup = await request('/api/v1/things', 'DELETE', { id: created });
      assert.ok(cleanup.status === 200 || cleanup.status === 404, `Fixture cleanup incomplete for archive ${created}; status ${cleanup.status}`);
      const absent = await request(`/api/v1/things?id=${encodeURIComponent(created)}&archive=true`);
      assert.equal(absent.status, 404, `Fixture archive ${created} still exists`);
    }
  }
});
