// Focused real-API regression. Synthetic fixtures are restricted to localhost.
import assert from 'node:assert/strict';
const base = process.argv[2];
assert.ok(base && ['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Pass a local test server URL');
const suffix = Date.now().toString(36);
const password = 'RenameFixture123!';
async function request(path, cookie, body) {
 const r = await fetch(base + '/api/v1/' + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
 const data = await r.json();
 return { status: r.status, data, cookie: r.headers.getSetCookie().map(v => v.split(';')[0]).join('; ') };
}
async function ok(path, cookie, body) { const r = await request(path, cookie, body); assert.ok(r.status >= 200 && r.status < 300, JSON.stringify(r.data)); return r; }
async function account(role) {return ok('auth/register', null, { username: `rename_${role}_${suffix}`, email: `rename_${role}_${suffix}@example.com`, password });}
const owner = await account('owner'); const member = await account('member');
const slug = `rename_${suffix}`;
const a = (await ok('subspaces', owner.cookie, { slug, name: 'Rename fixture' })).data.subspace;
const b = (await ok('subspaces', owner.cookie, { slug: `${slug}_b`, name: 'Conflict fixture' })).data.subspace;
await ok('subspaces/join', member.cookie, { id: a.id });
await ok('things', owner.cookie, { type: 'text', text: 'Rename preserves this post', title: 'Rename fixture', subspaceId: a.id, visibility: 'public' });
assert.equal((await request('subspaces/update', null, { id: a.id, newSlug: 'thingtime' })).status, 401);
assert.equal((await request('subspaces/update', member.cookie, { id: a.id, newSlug: 'thingtime' })).status, 403);
for (const newSlug of ['admin', 'ab', 'has/slash']) assert.equal((await request('subspaces/update', owner.cookie, { id: a.id, newSlug })).status, 400);
assert.equal((await request('subspaces/update', owner.cookie, { id: a.id, newSlug: b.slug })).status, 409);
await ok('subspaces/members', owner.cookie, { id: a.id, userId: member.data.user.id, action: 'role', role: 'moderator' });
assert.equal((await request('subspaces/update', member.cookie, { id: a.id, newSlug: `${slug}_mod` })).status, 403);
const next = `${slug}_new`;
const renamed = (await ok('subspaces/update', owner.cookie, { id: a.id, newSlug: next })).data.subspace;
assert.equal(renamed.id, a.id); assert.equal(renamed.slug, next);
assert.equal((await request(`subspaces/get?slug=${slug}`, owner.cookie)).status, 404);
const read = (await ok(`subspaces/get?slug=${next}`, member.cookie)).data.subspace;
assert.equal(read.id, a.id); assert.equal(read.viewer.member, true); assert.equal(read.memberCount, 2);
const feed = (await ok(`subspaces/feed?slug=${next}`, owner.cookie)).data;
assert.ok(JSON.stringify(feed).includes('Rename preserves this post'));
const held = (await ok('subspaces', member.cookie, { slug: `${slug}_held`, name: 'Held fixture' })).data.subspace;
await ok('subspaces/delete', member.cookie, { id: held.id, confirmSlug: held.slug });
assert.equal((await request('subspaces/update', owner.cookie, { id: a.id, newSlug: held.slug })).status, 409);
const raceSlug = `${slug}_race`;
const race = await Promise.all([request('subspaces/update', owner.cookie, { id: a.id, newSlug: raceSlug }), request('subspaces/update', owner.cookie, { id: b.id, newSlug: raceSlug })]);
assert.deepEqual(race.map(r=>r.status).sort(), [200,409]);
const manifest = await (await fetch(base+'/.well-known/thingtime-capabilities.json')).json();
assert.equal(manifest.features['api.subspaces-update'].version, '1.4.0');
assert.equal(manifest.features['api.subspaces'].version, '1.5.1');
console.log('PASS: auth, membership, reserved/invalid/taken slugs, rename readback, old URL release, post preservation, concurrent uniqueness, runtime manifest');
console.log(`UI fixture username: rename_owner_${suffix}; slug: ${race[0].status === 200 ? raceSlug : next}`);
