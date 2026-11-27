// Run only against the task-owned disposable incoming-share host. All product
// fixtures use supported HTTP APIs; credentials remain transient and unprinted.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
const [fixturePath, evidencePath] = process.argv.slice(2);
assert(fixturePath && evidencePath, 'Provide the private host fixture path and an external evidence path.');
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
const origin = fixture.apiOrigin;
assert.equal(new URL(origin).hostname, '127.0.0.1');
let cookie = '', actor;
async function request(path, body, options = {}) {
  const response = await fetch(origin + path, { method: body ? 'POST' : 'GET', headers: {
    'Content-Type': 'application/json', Origin: origin,
    ...(options.anonymous ? {} : cookie ? { Cookie: cookie } : {}),
    ...(!options.anonymous && actor ? { 'X-Thingtime-Expected-Actor': actor, 'X-Thingtime-Expected-Data-Plane': 'home' } : {})
  }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(options.timeout || 120000) });
  const data = await response.json();
  if (options.denied) { assert.ok([401, 403, 404].includes(response.status)); return data; }
  assert.ok(response.ok && data.ok !== false, `${path}: HTTP${response.status} ${data.error || 'request failed'}`);
  return { data, response };
}
const health = (await request('/api/v1/health/mongodb')).data;
assert.equal(health.dbName, 'thingtime'); assert.equal(health.replicaSet, 'incoming_share'); assert.equal(health.custom, false);
const name = 'feed-window-' + randomUUID().slice(0, 8);
const registered = await request('/api/v1/auth/register', { username: name, email: `${name}@example.invalid`, displayName: name, password: randomBytes(24).toString('hex') });
actor = registered.data.user.id;
cookie = registered.response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
assert(cookie && actor);
const seed = randomUUID();
// The supported bulk import runs each record through canonical createThing.
// It avoids changing normal comment rate policies or minting dozens of actors.
const manifest = { format: 'thingtime.transfer', version: 1, roots: ['root'], files: [], things: [
  { id: 'root', thingtime: ['post'], crystal: { type: 'text', text: `${seed}: bounded feed reader` } },
  ...Array.from({ length: 501 }, (_, index) => ({ id: `comment-${index}`, thingtime: ['comment'], targetId: 'root', crystal: { text: `${seed}: comment ${String(index).padStart(4, '0')}` } }))
] };
// A timeout here has an unknown outcome. Do not replay this import.
const imported = (await request('/api/v1/things/import', { manifest })).data;
assert.equal(imported.imported, 502);
const rootId = imported.ids.root;
const extra = (await request('/api/v1/things', { shareId: randomUUID(), thingtime: ['comment'], targetId: rootId, crystal: { text: `${seed}: regular comment after501` } })).data.thing;
assert(extra?.id);
const countExpected = 502;
const all = []; let cursor = null;
do {
  const query = new URLSearchParams({ target: rootId, thingtime: 'comment', commentProjection: 'true', limit: '20', ...(cursor ? { cursor } : {}) });
  const page = (await request('/api/v1/things?' + query)).data;
  const rows = page.comments || page.things;
  assert.ok(Array.isArray(rows)); assert.ok(rows.length <= 20);
  all.push(...rows); cursor = page.nextCursor;
  assert.ok(all.length <= countExpected);
} while (cursor);
assert.equal(all.length, countExpected); assert.equal(new Set(all.map(row => row.id)).size, countExpected);
const chronological = [...all].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt) || a.id.localeCompare(b.id));
const bestId = chronological[0].id;
await request('/api/v1/things/updown', { id: bestId, direction: 'up' });
await request('/api/v1/things/react', { id: rootId, emoji: '🥰' });
await request('/api/v1/things/react', { id: bestId, emoji: '🚀' });
const outcomes = {};
for (const sort of [null, 'new', 'old', 'top']) {
  const query = new URLSearchParams({ id: rootId, ...(sort ? { commentSort: sort } : {}) });
  const post = (await request('/api/v1/things?' + query)).data.post;
  assert(post); assert.equal(post.commentCount, countExpected); assert.equal(post.commentCounts.direct, countExpected); assert.equal(post.comments.length, 20);
  const expected = sort === null ? chronological.slice(-20) : sort === 'new' ? [...chronological].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt) || a.id.localeCompare(b.id)).slice(0, 20) : sort === 'top' ? [...chronological].sort((a, b) => Number(b.id === bestId) - Number(a.id === bestId) || +new Date(a.createdAt) - +new Date(b.createdAt) || a.id.localeCompare(b.id)).slice(0, 20) : chronological.slice(0, 20);
  assert.deepEqual(post.comments.map(row => row.id), expected.map(row => row.id));
  assert.equal(post.reactionCounts['🥰'], 1); assert.ok(post.viewerReactions.includes('🥰'));
  if (sort === 'top') { assert.equal(post.comments[0].votes.score, 1); assert.equal(post.comments[0].reactionCounts['🚀'], 1); }
  outcomes[sort || 'default'] = { displayed: post.comments.length, total: post.commentCount, ordered: true };
}
await request('/api/v1/things?id=' + rootId, undefined, { anonymous: true, denied: true });
const result = { source: 'real HTTP APIs against isolated replica host', accountKind: 'ordinary synthetic user', importedComments: 501, regularComments: 1, completeCursorRows: all.length, distinctRows: new Set(all.map(row => row.id)).size, privateAnonymousReadDenied: true, outcomes };
await writeFile(evidencePath, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
