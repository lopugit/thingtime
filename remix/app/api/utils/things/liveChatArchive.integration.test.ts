import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { capabilitySatisfies, THINGTIME_CAPABILITY_MANIFEST_PATH } from '../capabilities/capabilityContract';
import { encodeTransferArchive, decodeTransferArchive } from '../../../utils/thingTransfer/archive';
import { bundleFromPlan } from '../../../utils/thingTransfer/browser';

const fixtureName = 'Transfer acceptance — self-only';
const fixtureOrigin = (value: string, consent: boolean, username: string) => {
  const url = new URL(value);
  assert.ok(!url.username && !url.password && url.pathname + url.search + url.hash === '/');
  assert.ok((['localhost', '127.0.0.1'].includes(url.hostname) && ['http:', 'https:'].includes(url.protocol)) ||
    (consent && !!username && url.protocol === 'https:' && !url.port &&
      (url.hostname === 'dev.thingtime.com' || /^pr-[1-9][0-9]*\.previews\.dev\.thingtime\.com$/.test(url.hostname))));
  return url;
};

test('live chat fixture origin rejects production, lookalikes and implicit remote writes', () => {
  assert.equal(fixtureOrigin('https://pr-764.previews.dev.thingtime.com', true, 'fixture').hostname, 'pr-764.previews.dev.thingtime.com');
  for (const origin of ['https://thingtime.com', 'https://dev.thingtime.com.evil.test', 'http://dev.thingtime.com',
    'https://dev.thingtime.com:444', 'https://user:secret@dev.thingtime.com']) assert.throws(() => fixtureOrigin(origin, true, 'fixture'));
  assert.throws(() => fixtureOrigin('https://dev.thingtime.com', false, 'fixture'));
});

test('real self-only live chat exports through ZIP into a private independent archive', {
  skip: process.env.TT_TRANSFER_LIVE_CHAT_TEST !== '1', timeout: 240_000
}, async () => {
  const cookie = process.env.TT_TRANSFER_TEST_COOKIE, username = process.env.TT_TRANSFER_TEST_USERNAME;
  assert.ok(cookie && username && process.env.TT_TRANSFER_TEST_URL);
  const origin = fixtureOrigin(process.env.TT_TRANSFER_TEST_URL, process.env.TT_TRANSFER_REMOTE_DEV_TEST === '1', username);
  const request = async (path: string, method = 'GET', body?: unknown, authenticated = true) => {
    const response = await fetch(new URL(path, origin), { method, redirect: 'error',
      headers: { 'Content-Type': 'application/json', Origin: origin.origin, ...(authenticated ? { Cookie: cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(35_000) });
    const data = await response.json(); return { status: response.status, data };
  };
  const capabilities = await request(THINGTIME_CAPABILITY_MANIFEST_PATH);
  assert.equal(capabilities.status, 200); assert.equal(capabilities.data.origin, origin.origin);
  for (const [feature, version] of Object.entries({ 'api.things-export': '1.11.1', 'api.things-import': '1.9.1',
    'api.things': '1.14.0', 'api.chats': '1.0.0', 'api.chats-get': '1.0.0', 'api.chats-messages': '1.0.1',
    'api.chats-messages-edit': '1.0.1', 'api.chats-messages-delete': '1.0.0', 'api.chats-react': '1.0.1' }))
    assert.ok(capabilitySatisfies(capabilities.data.features?.[feature]?.version, version), `Missing ${feature}; no fixture writes`);
  const me = await request('/api/v1/auth/me');
  assert.equal(me.status, 200); assert.equal(me.data.user?.username, username); assert.ok(me.data.user.id);
  // This phase proves real relational history, not a mocked byte transfer. A
  // separate media fixture supplies uploads; refuse rather than dropping avatars.
  assert.ok(!me.data.user.avatarUrl, 'Use the approved avatar-free account for this metadata round trip');
  const listed = await request('/api/v1/chats'); assert.equal(listed.status, 200);
  const candidates = listed.data.chats.filter((chat: any) => chat.name === fixtureName);
  assert.ok(candidates.length <= 1, 'Resolve duplicate fixtures before creating more');
  let chatId = candidates[0]?.id;
  if (!chatId) {
    const created = await request('/api/v1/chats', 'POST', { chatType: 'group', name: fixtureName,
      topic: 'Reusable private test fixture. No other participants.', memberIds: [] });
    assert.equal(created.status, 200); chatId = created.data.chat?.id;
  }
  assert.ok(typeof chatId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(chatId));
  console.log(JSON.stringify({ retainedSelfOnlyFixture: chatId }));
  const detail = await request(`/api/v1/chats/get?id=${encodeURIComponent(chatId)}`);
  assert.equal(detail.status, 200); assert.equal(detail.data.chat.name, fixtureName);
  assert.equal(detail.data.chat.chatType, 'group'); assert.ok(!detail.data.chat.externalSource);
  assert.deepEqual(detail.data.members.map((member: any) => member.userId), [me.data.user.id], 'Never message another participant');
  assert.equal(detail.data.myMember.state, 'active');
  const marker = randomUUID();
  const send = async (text: string, extra = {}) => {
    const result = await request('/api/v1/chats/messages', 'POST', { chatId, text, ...extra });
    assert.equal(result.status, 200); assert.ok(result.data.message?.id); return result.data.message.id as string;
  };
  const root = await send(`History ${marker}\nOriginal 🥰`);
  const reply = await send('Thread reply', { threadRootId: root, replyToId: root });
  const deleted = await send('This text must not be restored');
  const exact = `History ${marker}\nEdited 🥰`;
  assert.equal((await request('/api/v1/chats/messages/edit', 'POST', { id: root, text: exact })).status, 200);
  assert.equal((await request('/api/v1/chats/react', 'POST', { messageId: root, emoji: '🥰' })).status, 200);
  assert.equal((await request('/api/v1/chats/messages/delete', 'POST', { id: deleted })).status, 200);
  const before = await request(`/api/v1/chats/messages?chatId=${encodeURIComponent(chatId)}&limit=100`);
  assert.equal(before.status, 200); assert.equal(before.data.nextCursor, null);
  const beforeDetail = await request(`/api/v1/chats/get?id=${encodeURIComponent(chatId)}`);
  assert.equal(beforeDetail.status, 200);
  let copyId: string | undefined;
  try {
    const denied = await request('/api/v1/things/export', 'POST', { ids: [chatId] }, false);
    assert.ok([401, 403, 404].includes(denied.status)); assert.equal(denied.data.plan, undefined);
    const exported = await request('/api/v1/things/export', 'POST', { ids: [chatId], includeChildren: false, includeDependencies: false });
    assert.equal(exported.status, 200, `Live export failed: ${exported.status} ${exported.data.error || ''}`);
    const plan = exported.data.plan;
    assert.equal(plan.files.length, 0, 'Metadata fixture unexpectedly acquired media');
    const rows = plan.things;
    assert.equal(rows.find((row: any) => row.id === chatId).thingtime[0], 'chat-archive');
    assert.equal(rows.find((row: any) => row.id === root).crystal.text, exact);
    assert.ok(rows.find((row: any) => row.id === root).crystal.editedAt);
    assert.equal(rows.find((row: any) => row.id === reply).crystal.threadRootId, root);
    assert.equal(rows.find((row: any) => row.id === deleted).crystal.text, '');
    assert.equal(rows.find((row: any) => row.id === deleted).crystal.deleted, true);
    assert.ok(rows.some((row: any) => row.crystal.systemText));
    assert.ok(rows.some((row: any) => row.thingtime[0] === 'chat-archive-reaction' && row.targetId === root));
    assert.doesNotMatch(JSON.stringify(plan), /"(?:ownerId|userId|acl|tokenAcl|memberKey|secure)"/);
    const bundle = await bundleFromPlan(plan);
    const decoded = await decodeTransferArchive(await encodeTransferArchive(bundle));
    const imported = await request('/api/v1/things/import', 'POST', { manifest: decoded.manifest });
    if (typeof imported.data.ids?.[chatId] === 'string') copyId = imported.data.ids[chatId];
    assert.equal(imported.status, 200); assert.ok(copyId && copyId !== chatId);
    const copied = await request(`/api/v1/things?id=${encodeURIComponent(copyId)}&archive=true`);
    assert.equal(copied.status, 200);
    const group = copied.data.archive.group;
    assert.equal(group.messages.find((row: any) => row.id === imported.data.ids[root]).crystal.text, exact);
    assert.equal(group.messages.find((row: any) => row.id === imported.data.ids[reply]).crystal.replyToId, imported.data.ids[root]);
    assert.equal(group.self.id, group.root.crystal.selfParticipantId);
    const after = await request(`/api/v1/chats/messages?chatId=${encodeURIComponent(chatId)}&limit=100`);
    assert.deepEqual(after.data.messages, before.data.messages, 'Export/import must not send or modify live messages');
    const afterDetail = await request(`/api/v1/chats/get?id=${encodeURIComponent(chatId)}`);
    assert.deepEqual(afterDetail.data.members, beforeDetail.data.members, 'Export/import must not change memberships or receipts');
    console.log(JSON.stringify({ liveHistoryZipRoundTrip: true, privateCopy: true, sourceUnchanged: true }));
  } finally {
    if (copyId) {
      const path = `/api/v1/things?id=${encodeURIComponent(copyId)}&archive=true`;
      const read = await request(path); assert.equal(read.status, 200);
      const removed = await request('/api/v1/things', 'DELETE', { id: copyId, expectedUpdatedAt: read.data.archive.updatedAt });
      assert.equal(removed.status, 200); assert.equal((await request(path)).status, 404);
      console.log(JSON.stringify({ importedArchiveCleanup: true }));
    }
  }
});
