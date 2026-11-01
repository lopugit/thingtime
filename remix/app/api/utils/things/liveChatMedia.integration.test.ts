import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { capabilitySatisfies, THINGTIME_CAPABILITY_MANIFEST_PATH } from '../capabilities/capabilityContract';
import { bundleFromPlan } from '../../../utils/thingTransfer/browser';
import { encodeTransferArchive, decodeTransferArchive } from '../../../utils/thingTransfer/archive';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

test('real self-only live message image survives ZIP import and source deletion', {
  skip: process.env.TT_TRANSFER_LIVE_MEDIA_TEST !== '1', timeout: 240_000
}, async () => {
  const origin = new URL(process.env.TT_TRANSFER_TEST_URL!);
  const cookie = process.env.TT_TRANSFER_TEST_COOKIE;
  const username = process.env.TT_TRANSFER_TEST_USERNAME;
  assert.equal(process.env.TT_TRANSFER_REMOTE_DEV_TEST, '1');
  assert.ok(cookie && username);
  assert.equal(origin.protocol, 'https:');
  assert.equal(origin.username + origin.password + origin.port + origin.search + origin.hash, '');
  assert.equal(origin.pathname, '/');
  assert.ok(origin.hostname === 'dev.thingtime.com' || /^pr-[1-9][0-9]*\.previews\.dev\.thingtime\.com$/.test(origin.hostname));
  const request = (path: string, method = 'GET', body?: unknown, authenticated = true) => {
    const url = new URL(path, origin); assert.equal(url.origin, origin.origin);
    return fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { 'Content-Type': 'application/json', Origin: origin.origin, ...(authenticated ? { Cookie: cookie! } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  };
  const json = async (path: string, method = 'GET', body?: unknown) => {
    const r = await request(path, method, body);
    assert.equal(r.status, 200, `${method} ${path.split('?')[0]} HTTP ${r.status}`);
    return r.json();
  };
  const capabilities = await json(THINGTIME_CAPABILITY_MANIFEST_PATH);
  assert.equal(capabilities.origin, origin.origin);
  for (const [feature, version] of Object.entries({ 'api.things-export': '1.12.0', 'api.things-import': '1.9.1',
    'api.things': '1.16.1', 'api.chats': '1.0.0', 'api.chats-get': '1.0.0', 'api.chats-messages': '1.0.1',
    'api.chats-messages-delete': '1.0.0', 'api.attachment-uploads': '1.3.0', 'api.attachment-upload-parts': '1.1.0',
    'api.attachment-upload-complete': '1.3.0', 'api.attachment-upload-abort': '1.1.0',
    'api.attachment-delete': '1.1.0', 'api.attachment-content': '1.6.4' }))
    assert.ok(capabilitySatisfies(capabilities.features?.[feature]?.version, version), `Missing ${feature}; no fixture writes`);
  const me = (await json('/api/v1/auth/me')).user;
  assert.equal(me.username, username); assert.equal(me.accountKind, 'user');
  assert.equal(me.publicUploadsEnabled, true); assert.equal(me.privateUploadsEnabled, true);
  assert.ok(!me.avatarUrl, 'This fixture must remain avatar-free');
  const chats = (await json('/api/v1/chats')).chats.filter((chat: any) => chat.name === 'Transfer acceptance — self-only');
  assert.equal(chats.length, 1, 'Reuse exactly one existing fixture; never create another');
  const chatId = chats[0].id;
  const detailPath = `/api/v1/chats/get?id=${encodeURIComponent(chatId)}`;
  const detail = await json(detailPath);
  assert.equal(detail.chat.chatType, 'group'); assert.ok(!detail.chat.externalSource);
  assert.deepEqual(detail.members.map((member: any) => member.userId), [me.id], 'Never message anyone else');
  assert.equal(detail.myMember.state, 'active');
  const uploads = new Set<string>();
  let messageId: string | undefined, copyId: string | undefined;
  const upload = async (bytes: Uint8Array, purpose: 'message' | 'post') => {
    const plan = await json('/api/v1/attachments/uploads', 'POST', { requestId: randomUUID(),
      filename: 'live-history.png', contentType: 'image/png', sizeBytes: bytes.length, purpose });
    const id = plan.upload?.id; assert.equal(typeof id, 'string'); uploads.add(id);
    assert.equal(plan.upload.partCount, 1);
    const checksum = createHash('sha256').update(bytes).digest('base64');
    const signed = await json('/api/v1/attachments/uploads/parts', 'POST', { uploadId: id, parts: [{ partNumber: 1, checksumSha256: checksum }] });
    assert.equal(signed.parts?.length, 1);
    const part = signed.parts[0], url = new URL(part.url);
    assert.equal(url.protocol, 'https:'); assert.equal(url.username + url.password, '');
    assert.equal(part.headers?.['x-amz-checksum-sha256'], checksum);
    const put = await fetch(url, { method: 'PUT', redirect: 'error', credentials: 'omit',
      headers: { 'x-amz-checksum-sha256': checksum }, body: Uint8Array.from(bytes), signal: AbortSignal.timeout(30_000) })
      .catch(() => { throw new Error('Storage upload failed; signed URL withheld'); });
    assert.ok(put.ok, `Storage HTTP ${put.status}`);
    const ready = await json('/api/v1/attachments/uploads/complete', 'POST', { uploadId: id });
    assert.equal(ready.attachment?.id, id);
    return id as string;
  };
  const contentPath = (id: string) => `/api/v1/attachments/content?id=${encodeURIComponent(id)}&cache=bytes`;
  const bytes = async (id: string) => {
    // Moderation is asynchronous. Bounded polling never changes its decision.
    for (let attempt = 0; attempt < 7; attempt++) {
      const r = await request(contentPath(id));
      if (r.status === 200) return Buffer.from(await r.arrayBuffer());
      assert.ok([403, 404, 409, 423].includes(r.status), `Content HTTP ${r.status}`);
      if (attempt < 6) await new Promise(resolve => setTimeout(resolve, 5000));
    }
    throw new Error('Image did not become readable within the moderation window');
  };
  const archivePath = () => `/api/v1/things?id=${encodeURIComponent(copyId!)}&archive=true`;
  const failures: unknown[] = [];
  try {
    const sourceImage = await upload(png, 'message');
    assert.deepEqual(await bytes(sourceImage), png);
    const sent = await json('/api/v1/chats/messages', 'POST', { chatId, requestId: randomUUID(),
      text: 'Private live-image transfer fixture 🥰', attachmentIds: [sourceImage] });
    messageId = sent.message?.id; assert.ok(messageId);
    const messagesPath = `/api/v1/chats/messages?chatId=${encodeURIComponent(chatId)}&limit=100`;
    const before = await json(messagesPath); assert.equal(before.nextCursor, null);
    const beforeDetail = await json(detailPath);
    const exported = await json('/api/v1/things/export', 'POST', { ids: [chatId] });
    const bundle = await bundleFromPlan(exported.plan, { fetch: ((path: string) => request(path)) as typeof fetch });
    const decoded = await decodeTransferArchive(await encodeTransferArchive(bundle));
    assert.equal(decoded.manifest.files.length, 1, 'Fixture unexpectedly contains other media');
    const file = decoded.manifest.files[0]; assert.equal(file.targetId, messageId);
    assert.deepEqual(Buffer.from(decoded.files.get(file.id)!), png);
    const copiedImage = await upload(decoded.files.get(file.id)!, 'post');
    const response = await request('/api/v1/things/import', 'POST', { manifest: decoded.manifest, files: { [file.id]: copiedImage } });
    const imported = await response.json(); copyId = imported.ids?.[chatId];
    assert.equal(response.status, 200); assert.ok(copyId && copyId !== chatId);
    const archive = (await json(archivePath())).archive;
    assert.equal(archive.attachments.length, 1);
    assert.equal(archive.attachments[0].id, copiedImage);
    assert.equal(archive.attachments[0].targetId, imported.ids[messageId!]);
    assert.deepEqual((await json(messagesPath)).messages, before.messages);
    assert.deepEqual((await json(detailPath)).members, beforeDetail.members);
    assert.notEqual(copiedImage, sourceImage);
    const anonymous = await request(archivePath(), 'GET', undefined, false);
    assert.ok([401, 403, 404].includes(anonymous.status));
    await json('/api/v1/chats/messages/delete', 'POST', { id: messageId });
    await json('/api/v1/attachments/delete', 'POST', { id: sourceImage });
    assert.equal((await request(contentPath(sourceImage))).status, 404);
    assert.deepEqual(await bytes(copiedImage), png, 'Copied bytes must survive source deletion');
    console.log(JSON.stringify({ liveChatMediaZipRoundTrip: true, independentBytes: true, sourceUnchangedDuringTransfer: true }));
  } catch (error) { failures.push(error); }
  finally {
    if (messageId) try { await json('/api/v1/chats/messages/delete', 'POST', { id: messageId }); } catch (e) { failures.push(e); }
    if (copyId) try {
      const archive = (await json(archivePath())).archive;
      await json('/api/v1/things', 'DELETE', { id: copyId, expectedUpdatedAt: archive.updatedAt });
      assert.equal((await request(archivePath())).status, 404);
    } catch (e) { failures.push(e); }
    for (const id of uploads) try {
      await request('/api/v1/attachments/uploads/abort', 'POST', { uploadId: id });
      await request('/api/v1/attachments/delete', 'POST', { id });
      assert.equal((await request(contentPath(id))).status, 404, `Fixture cleanup ${id}`);
    } catch (e) { failures.push(e); }
    if (failures.length) throw Object.assign(new Error('Live-chat media acceptance or cleanup failed'), { errors: failures });
    console.log(JSON.stringify({ liveMediaCleanup: true, retainedSelfOnlyChatWithDeletedFixtureMessage: chatId }));
  }
});
