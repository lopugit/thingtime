import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { capabilitySatisfies, THINGTIME_CAPABILITY_MANIFEST_PATH } from '../capabilities/capabilityContract';
import { decodeTransferArchive, encodeTransferArchive } from '../../../utils/thingTransfer/archive';
import { validateTransfer } from '../../../utils/thingTransfer/format';

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

test('real private archive folder ZIP round trip preserves history, fresh identities and owner-only lifecycle', {
  skip: process.env.TT_TRANSFER_ARCHIVE_TEST !== '1', timeout: 240_000
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
  for (const [feature, version] of Object.entries({
    'api.auth-me': '1.0.0', 'api.things-import': '1.9.1', 'api.things': '1.14.0',
    'api.things-export': '1.10.0', 'api.things-bulk': '1.4.0'
  })) {
    assert.ok(capabilitySatisfies(capabilities.data.features?.[feature]?.version, version), `Missing ${feature} ${version}; no archive created`);
  }
  const me = await request('/api/v1/auth/me');
  assert.equal(me.status, 200); assert.ok(me.data.user?.id, 'Fixture session required');
  assert.ok(me.data.user.username === expectedUsername, 'Unexpected fixture account; no archive created');
  const at = '2026-09-01T00:00:00.000Z';
  const name = `Archive transfer fixture ${randomUUID()}`;
  const things = [
    { id: 'folder', thingtime: ['folder'], crystal: { name } },
    { id: 'archive', folderId: 'folder', thingtime: ['chat-archive'], crystal: { name, topic: 'Private test history', chatType: 'dm', createdAt: at, selfParticipantId: 'self' } },
    { id: 'self', targetId: 'archive', thingtime: ['chat-archive-participant'], crystal: { username: 'fictional-original', displayName: 'Original self', nickname: '', joinedAt: at } },
    { id: 'friend', targetId: 'archive', thingtime: ['chat-archive-participant'], crystal: { username: 'fictional-archived-friend', displayName: 'Archived friend', nickname: 'F', joinedAt: at } },
    { id: 'message', targetId: 'archive', thingtime: ['chat-archive-message'], crystal: { participantId: 'self', text: 'Exact\n history 🥰', createdAt: at, deleted: false } },
    { id: 'reply', targetId: 'archive', thingtime: ['chat-archive-message'], crystal: { participantId: 'friend', text: 'Historical reply', createdAt: at, deleted: false, replyToId: 'message', threadRootId: 'message' } },
    { id: 'reaction', targetId: 'message', thingtime: ['chat-archive-reaction'], crystal: { participantId: 'friend', emoji: '🥰', createdAt: at } }
  ];
  let created: string | undefined;
  const archiveCleanup = new Set<string>();
  const folderCleanup = new Set<string>();
  const remember = (value: unknown, cleanup: Set<string>) => {
    if (typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) cleanup.add(value);
  };
  try {
    const imported = await request('/api/v1/things/import', 'POST', { manifest: { format: 'thingtime.transfer', version: 1, roots: ['folder'], things, files: [] } });
    // Record the returned cleanup anchor before checking response details.
    remember(imported.data?.ids?.archive, archiveCleanup);
    remember(imported.data?.ids?.folder, folderCleanup);
    if (typeof imported.data?.ids?.archive === 'string') created = imported.data.ids.archive;
    assert.equal(imported.status, 200, `Archive import returned ${imported.status}`);
    assert.ok(created && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(created), 'Import did not return a safe cleanup anchor');
    const ids = imported.data.ids;
    assert.equal(imported.data.imported, things.length);
    assert.equal(new Set(Object.values(ids)).size, things.length);
    assert.ok(Object.values(ids).every(id => !things.some(row => row.id === id) && id !== me.data.user.id));
    assert.ok(folderCleanup.has(ids.folder), 'Import did not return a safe folder cleanup anchor');
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

    const listing = await request(`/api/v1/things?folder=${encodeURIComponent(ids.folder)}&limit=100`);
    assert.equal(listing.status, 200); assert.match(listing.cache || '', /no-store/);
    assert.ok(listing.data.things.some((row: any) => row.id === created), 'Archive root missing from its owner folder');
    const exported = await request('/api/v1/things/export', 'POST', { ids: [ids.folder] });
    assert.equal(exported.status, 200); assert.match(exported.cache || '', /no-store/);
    assert.equal(exported.data.plan.things.length, things.length);
    assert.equal(exported.data.plan.things.find((row: any) => row.id === created).folderId, ids.folder);
    assert.equal(exported.data.plan.files.length, 0, 'This fixture proves metadata ZIP transport, not media bytes');
    const manifest = validateTransfer({ format: 'thingtime.transfer', version: 1, ...exported.data.plan });
    const decoded = await decodeTransferArchive(await encodeTransferArchive({ manifest, files: new Map() }));
    assert.deepEqual(decoded.manifest, manifest);
    const copied = await request('/api/v1/things/import', 'POST', { manifest: decoded.manifest });
    remember(copied.data?.ids?.[created!], archiveCleanup);
    remember(copied.data?.ids?.[ids.folder], folderCleanup);
    assert.equal(copied.status, 200); assert.equal(copied.data.imported, things.length);
    const copyIds = copied.data.ids;
    assert.equal(new Set(Object.values(copyIds)).size, things.length);
    assert.ok(Object.values(copyIds).every(id => !Object.values(ids).includes(id) && id !== me.data.user.id));
    const copyRoot = copyIds[created!], copyFolder = copyIds[ids.folder];
    assert.ok(archiveCleanup.has(copyRoot) && folderCleanup.has(copyFolder));
    const copyPath = `/api/v1/things?id=${encodeURIComponent(copyRoot)}&archive=true`;
    const copiedRead = await request(copyPath);
    assert.equal(copiedRead.status, 200);
    const copyGroup = copiedRead.data.archive.group;
    assert.equal(copyGroup.self.id, copyIds[ids.self]);
    assert.equal(copyGroup.root.crystal.selfParticipantId, copyIds[ids.self]);
    assert.equal(copyGroup.participants.length, 2); assert.equal(copyGroup.messages.length, 2); assert.equal(copyGroup.reactions.length, 1);
    assert.equal(copyGroup.participants.find((row: any) => row.id === copyIds[ids.friend]).crystal.username, 'fictional-archived-friend');
    assert.deepEqual(copyGroup.messages.find((row: any) => row.id === copyIds[ids.message]).crystal,
      { ...message.crystal, participantId: copyIds[ids.self] });
    assert.deepEqual(copyGroup.messages.find((row: any) => row.id === copyIds[ids.reply]).crystal,
      { ...reply.crystal, participantId: copyIds[ids.friend], replyToId: copyIds[ids.message], threadRootId: copyIds[ids.message] });
    assert.equal(copyGroup.reactions[0].targetId, copyIds[ids.message]);
    assert.equal(copyGroup.reactions[0].crystal.participantId, copyIds[ids.friend]);
    assert.doesNotMatch(JSON.stringify(copiedRead.data.archive), /"(?:ownerId|userId|acl|tokenAcl|archiveVersion|appId)"/);
    const moved = await request('/api/v1/things/bulk', 'POST', { op: 'move', ids: [copyRoot], folderId: null });
    assert.equal(moved.status, 200); assert.equal(moved.data.succeeded, 1); assert.equal(moved.data.failed, 0);
    const emptyFolder = await request('/api/v1/things/export', 'POST', { ids: [copyFolder] });
    assert.equal(emptyFolder.status, 200); assert.equal(emptyFolder.data.plan.things.length, 1);
    const standalone = await request('/api/v1/things/export', 'POST', { ids: [copyRoot], includeChildren: false, includeDependencies: false });
    assert.equal(standalone.status, 200); assert.equal(standalone.data.plan.things.length, things.length - 1);
    assert.equal(standalone.data.plan.things.find((row: any) => row.id === copyRoot).folderId, undefined);
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
    archiveCleanup.delete(created!);
    // The imported copy must still work after deleting its source history.
    assert.equal((await request(copyPath)).status, 200);
    created = undefined;
  } finally {
    const failures: string[] = [];
    // Attempt every known root even if one deletion fails. Never recursively
    // delete a folder to compensate for an uncertain archive cascade.
    for (const [kind, cleanupIds] of [['archive', archiveCleanup], ['folder', folderCleanup]] as const) {
      for (const id of cleanupIds) {
        try {
          const cleanup = await request('/api/v1/things', 'DELETE', { id });
          assert.ok(cleanup.status === 200 || cleanup.status === 404, `Fixture cleanup incomplete for ${kind} ${id}; status ${cleanup.status}`);
          const absent = await request(`/api/v1/things?id=${encodeURIComponent(id)}${kind === 'archive' ? '&archive=true' : ''}`);
          assert.equal(absent.status, 404, `Fixture ${kind} ${id} still exists`);
        } catch {
          failures.push(`${kind} ${id}`);
        }
      }
    }
    assert.equal(failures.length, 0, `Archive round-trip fixture cleanup incomplete: ${failures.join(', ')}`);
  }
});
