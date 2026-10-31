import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

const base = process.env.TT_FORK_TEST_URL;
// Explicit local-only acceptance: API-created accounts/content, no database writes.
// TT_FORK_COPIER_COOKIE must belong to an upload-approved disposable account.
test('image posts, comment galleries and deep replies copy privately through the real API', { skip: !base, timeout: 180_000 }, async () => {
 assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base!).hostname));
 const created: { id: string; cookie: string }[] = [];
 const request = async (path: string, method = 'GET', body?: unknown, cookie = '') => {
  const response = await fetch(new URL(path, base), { method, headers: { 'Content-Type': 'application/json', Origin: base!, ...(cookie ? { Cookie: cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json();
  return { response, data };
 };
 const session = async () => {
  const username = `copytest${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const { response, data } = await request('/api/v1/auth/register', 'POST', { username, email: `${username}@example.invalid`, password: `${randomUUID()}Aa1!` });
  assert.ok(response.ok, `Registration: ${response.status} ${data.error || ''}`);
  return response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
 };
 assert.ok(process.env.TT_FORK_COPIER_COOKIE, 'Set TT_FORK_COPIER_COOKIE for an upload-approved disposable account');
 const owner = process.env.TT_FORK_OWNER_COOKIE || await session(), copier = process.env.TT_FORK_COPIER_COOKIE;
 const json = async (path: string, method: string, body: unknown, cookie: string) => {
  const { response, data } = await request(path, method, body, cookie);
  assert.equal(response.status, 200, `${method} ${path.split('?')[0]}: ${data.error || response.status}`);
  return data;
 };
 const link = async (purpose: 'post' | 'comment', name: string) => (await json('/api/v1/attachments/link', 'POST', { url: `https://example.com/${name}.png`, purpose }, owner)).attachment.id;
 const read = async (id: string, cookie: string) => {
  const data = await json(`/api/v1/things?id=${id}`, 'GET', undefined, cookie);
  return { ...data.thing, attachments: data.post?.attachments || [] };
 };
 try {
  const fileIds = [await link('post', 'second'), await link('post', 'first')];
  const post = (await json('/api/v1/things', 'POST', { thingtime: ['post'], crystal: { type: 'image', images: [], text: '' }, acl: ['tt:all'], attachmentIds: fileIds }, owner)).post;
  created.push({ id: post.id, cookie: owner });
  let parent = post.id;
  for (let i = 0; i < 5; i++) {
   const attachmentIds = i === 0 || i === 4 ? [await link('comment', `reply-${i}`)] : [];
   const { comment } = await json('/api/v1/things/comment', 'POST', { id: parent, shareId: randomUUID(), type: attachmentIds.length ? 'image' : 'text', text: `Copy fixture reply ${i}`, attachmentIds }, owner);
   created.push({ id: comment.id, cookie: owner }); parent = comment.id;
  }
  const mediaComment = (await json('/api/v1/things/comment', 'POST', { id: fileIds[0], shareId: randomUUID(), type: 'image', text: 'Comment on the media itself', attachmentIds: [await link('comment', 'media-comment')] }, owner)).comment;
  created.push({ id: mediaComment.id, cookie: owner });
  const mediaReply = (await json('/api/v1/things/comment', 'POST', { id: mediaComment.id, shareId: randomUUID(), text: 'Reply in the media thread' }, owner)).comment;
  created.push({ id: mediaReply.id, cookie: owner });
  assert.equal((await request('/api/v1/things/fork', 'POST', { id: post.id })).response.status, 401);
  const fork = await json('/api/v1/things/fork', 'POST', { id: post.id }, copier);
  for (const id of fork.ids) created.push({ id, cookie: copier });
  assert.equal(fork.copied, 8); assert.equal(fork.filesCopied, 5);
  const copy = await read(fork.id, copier);
  assert.deepEqual(copy.acl, ['tt:user']);
  assert.deepEqual(copy.attachments.map((file: any) => file.name), ['second.png', 'first.png']);
  assert.ok(copy.attachments.every((file: any) => !fileIds.includes(file.id)));
  assert.equal((await request(`/api/v1/things?id=${fork.id}`, 'GET', undefined, owner)).response.status, 404);
  const copies = await Promise.all(fork.ids.map((id: string) => read(id, copier)));
  let target = fork.id;
  for (let i = 0; i < 5; i++) {
   const parentId = target;
   const reply = copies.find(doc => doc.targetId === parentId);
   assert.ok(reply, `Missing nested reply ${i}`);
   assert.equal(reply.crystal.text, `Copy fixture reply ${i}`);
   assert.deepEqual(reply.acl, ['tt:inherit']);
   assert.equal(reply.attachments.length, i === 0 || i === 4 ? 1 : 0);
   target = reply.id;
  }
  const copiedMediaComment = copies.find(doc => doc.targetId === copy.attachments[0].id);
  assert.equal(copiedMediaComment?.crystal.text, 'Comment on the media itself');
  assert.equal(copiedMediaComment.attachments.length, 1);
  assert.equal(copies.find(doc => doc.targetId === copiedMediaComment.id)?.crystal.text, 'Reply in the media thread');
  const again = await json('/api/v1/things/fork', 'POST', { id: fork.id }, copier);
  for (const id of again.ids) created.push({ id, cookie: copier });
  assert.equal(again.copied, 8); assert.equal(again.filesCopied, 5);
  assert.ok(again.ids.every((id: string) => !fork.ids.includes(id)));
  await json('/api/v1/things', 'PATCH', { id: post.id, acl: ['tt:user'] }, owner);
  assert.equal((await request('/api/v1/things/fork', 'POST', { id: post.id }, copier)).response.status, 404);
  assert.equal((await read(fork.id, copier)).attachments.length, 2);
 } finally {
  for (const { id, cookie } of created.reverse()) {
   const { response } = await request('/api/v1/things', 'DELETE', { id }, cookie);
   assert.ok(response.ok || response.status === 404, `Fixture cleanup returned ${response.status}`);
  }
 }
});
