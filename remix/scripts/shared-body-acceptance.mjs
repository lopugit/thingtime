// HTTP-only regression for former incoming-share request budgets. This owns a
// disposable identity and separate IDs; never run against a production origin.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
const [fixturePath, evidencePath] = process.argv.slice(2);
assert(fixturePath && evidencePath);
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
const origin = fixture.apiOrigin;
assert.equal(new URL(origin).hostname, '127.0.0.1');
let cookie = '', actor;
const evidence = { origin, checks: [], requests: [], ids: {} };
async function call(path, body, options = {}) {
  const source = body ? JSON.stringify(body) : undefined;
  const response = await fetch(origin + path, { method: body ? 'POST' : 'GET', headers: {
    'Content-Type': 'application/json', Origin: origin,
    ...(options.anonymous ? {} : cookie ? { Cookie: cookie } : {}),
    ...(!options.anonymous && actor ? { 'X-Thingtime-Expected-Actor': actor, 'X-Thingtime-Expected-Data-Plane': 'home' } : {})
  }, ...(source ? { body: source } : {}), signal: AbortSignal.timeout(120000) });
  evidence.requests.push({ route: path.split('?')[0], method: body ? 'POST' : 'GET', requestBytes: source ? Buffer.byteLength(source, 'utf8') : 0, status: response.status, anonymous: options.anonymous === true });
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
  const data = await response.json();
  if (options.denied) { assert.ok([401, 403, 404].includes(response.status)); return { data, response }; }
  assert.ok(response.ok && data.ok !== false, `${path}: HTTP${response.status} ${data.error || 'request failed'}`);
  return { data, response };
}
const health = (await call('/api/v1/health/mongodb')).data;
assert.equal(health.dbName, 'thingtime'); assert.equal(health.replicaSet, 'incoming_share'); assert.equal(health.custom, false);
const username = 'body-' + randomUUID().slice(0, 8);
const registered = await call('/api/v1/auth/register', { username, email: `${username}@example.invalid`, displayName: username, password: randomBytes(24).toString('hex') });
cookie = registered.response.headers.getSetCookie().map(value => value.split(';')[0]).join('; '); actor = registered.data.user.id; assert(cookie && actor);
evidence.ids.actor = actor;
const large = '雪'.repeat(270000); // 810000 UTF8 bytes, above768KiB with normal framing.
const post = (await call('/api/v1/things', { shareId: randomUUID(), thingtime: ['post'], crystal: { type: 'text', text: large } })).data.post;
assert(post?.id); evidence.ids.post = post.id;
assert.equal((await call(`/api/v1/things?id=${post.id}`)).data.thing.crystal.text, large);
const data = (await call('/api/v1/things', { shareId: randomUUID(), thingtime: ['data'], visibility: 'private', crystal: { text: large } })).data.thing;
assert(data?.id); evidence.ids.data = data.id;
const updated = large + ' updated';
await call('/api/v1/things/update', { id: data.id, crystal: { text: updated } });
assert.equal((await call(`/api/v1/things?id=${data.id}`)).data.thing.crystal.text, updated);
evidence.checks.push('Post/Data create and Data update exceed768KiB and exact-read full text');
const commentText = 'c'.repeat(270000);
const comment = (await call('/api/v1/things/comment', { id: post.id, text: commentText })).data.comment;
assert(comment?.id); evidence.ids.comment = comment.id;
const commentRead = (await call(`/api/v1/things?id=${comment.id}`)).data;
assert.equal(commentRead.thing.crystal.text, commentText);
evidence.checks.push('comment exceeds256KiB and exact-read full text');
await call('/api/v1/things', { thingtime: ['data'], crystal: { text: large } }, { anonymous: true, denied: true });
await call('/api/v1/things?id=' + data.id, undefined, { anonymous: true, denied: true });
// Independent disposable recipient; no real contacts or notifications.
const receiverName = 'body-peer-' + randomUUID().slice(0, 8);
const receiver = await call('/api/v1/auth/register', { username: receiverName, email: `${receiverName}@example.invalid`, displayName: receiverName, password: randomBytes(24).toString('hex') });
const chat = (await call('/api/v1/chats', { chatType: 'dm', memberIds: [receiver.data.user.id] })).data.chat;
assert(chat?.id); evidence.ids.chat = chat.id;
const text = 'm'.repeat(70000);
const message = (await call('/api/v1/chats/messages', { chatId: chat.id, text, requestId: randomUUID() })).data.message;
assert(message?.id); evidence.ids.message = message.id;
await call('/api/v1/chats/messages/edit', { id: message.id, text: text + ' edited' });
assert.equal((await call('/api/v1/chats/messages?chatId=' + chat.id)).data.messages.find(item => item.id === message.id).text, text + ' edited');
evidence.checks.push('Message send/edit exceed64KiB and list-read full text');
// Attachment approval is not bypassed: use the host's separately authorized
// synthetic owner for metadata lifecycle, with independent object identities.
assert(fixture.cookie && fixture.ownerId, 'Expected isolated fixture owner session');
cookie = fixture.cookie; actor = fixture.ownerId;
const longUrl = 'https://example.invalid/original.bin?q=' + 'x'.repeat(20000);
const linked = (await call('/api/v1/attachments/link', { url: longUrl, purpose: 'post' })).data.attachment;
assert.equal(linked.url, longUrl); evidence.ids.linkedAttachment = linked.id;
const filename = 'f'.repeat(20000);
const upload = (await call('/api/v1/attachments/uploads', { requestId: randomUUID(), filename, contentType: 'application/octet-stream', sizeBytes: 0, purpose: 'file' })).data.upload;
assert.equal(upload.partCount, 0);
const attachment = (await call('/api/v1/attachments/uploads/complete', { uploadId: upload.id })).data.attachment;
assert.equal(attachment.name, filename); evidence.ids.attachment = attachment.id;
const description = 'd'.repeat(20000);
const annotated = (await call('/api/v1/attachments/annotate', { id: attachment.id, description })).data.attachment;
assert.equal(annotated.description, description);
const proof = (await call('/api/v1/attachments/content?id=' + attachment.id + '&fingerprint=1')).data;
const fileName = 'n'.repeat(34000), fileId = randomUUID(), operationId = randomUUID();
await call('/api/v1/files', { id: fileId, operationId, expectedRevision: null, name: fileName, folderId: null, attachmentId: attachment.id, contentVersion: proof.version, trashed: false });
const file = (await call('/api/v1/files?id=' + fileId + '&operationId=' + operationId)).data.receipt.file;
assert.equal(file.name, fileName); assert.equal(file.content.attachmentId, attachment.id); evidence.ids.file = fileId;
evidence.checks.push('attachment create/annotation exceed16KiB; file commit exceeds32KiB; exact readback');
evidence.ok = true;
await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ ok: true, checks: evidence.checks, evidencePath }));
