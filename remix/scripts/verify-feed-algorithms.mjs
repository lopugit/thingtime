import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const base = process.env.THINGTIME_TEST_ORIGIN;
if (!base || !['localhost', '127.0.0.1'].includes(new URL(base).hostname))
	throw new Error('Set THINGTIME_TEST_ORIGIN to a local test server. Creates synthetic QA accounts via the real signup API.');
const suffix = Date.now().toString(36);
const call = async (path, body, cookie = '', method = body ? 'POST' : 'GET') => {
	const res = await fetch(base + path, {
		method,
		headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
		...(body ? { body: JSON.stringify(body) } : {})
	});
	const data = await res.json();
	return {
		status: res.status,
		data,
		cookie: res.headers
			.getSetCookie()
			.map((c) => c.split(';')[0])
			.join('; ')
	};
};
const owner = await call('/api/v1/auth/register', {
	username: `algoqa${suffix}`,
	email: `algoqa${suffix}@example.invalid`,
	password: randomUUID() + 'aA1!'
});
assert.equal(owner.status, 200, JSON.stringify(owner.data));
const other = await call('/api/v1/auth/register', {
	username: `algoqb${suffix}`,
	email: `algoqb${suffix}@example.invalid`,
	password: randomUUID() + 'aA1!'
});
assert.equal(other.status, 200, JSON.stringify(other.data));
const minted = [];
const posts = [];
let checks = 0;
try {
	const created = await call('/api/v1/algorithms', { name: `QA ${suffix}`, description: 'Synthetic directory validation' }, owner.cookie);
	assert.equal(created.status, 200, JSON.stringify(created.data));
	const id = created.data.algorithm.id;
	minted.push([id, owner.cookie]);
	const search = async () => (await call('/api/v1/algorithms/search?q=' + encodeURIComponent(suffix))).data.algorithms;
	assert.equal((await search()).length, 0);
	checks++;
	assert.equal((await call('/api/v1/algorithms/update', { id, shared: true }, owner.cookie)).status, 200);
	assert.equal((await search()).length, 0);
	checks++;
	assert.equal((await call('/api/v1/algorithms/update', { id, listed: true }, other.cookie)).status, 404);
	checks++;
	assert.equal((await call('/api/v1/algorithms/update', { id, listed: 'true' }, owner.cookie)).status, 400);
	checks++;
	assert.equal((await call('/api/v1/algorithms/update', { id, listed: true }, owner.cookie)).status, 200);
	const found = await search();
	assert.equal(found.length, 1);
	assert.equal(found[0].id, id);
	assert.equal('weights' in found[0], false);
	assert.equal('topInterests' in found[0], false);
	checks++;
	const branch = await call('/api/v1/algorithms', { name: 'Synthetic branch', branchFrom: id }, other.cookie);
	assert.equal(branch.status, 200, JSON.stringify(branch.data));
	minted.push([branch.data.algorithm.id, other.cookie]);
	assert.equal(branch.data.algorithm.shared, false);
	assert.equal(branch.data.algorithm.listed, false);
	checks++;
	await call('/api/v1/algorithms/update', { id, shared: false }, owner.cookie);
	assert.equal((await search()).length, 0);
	assert.equal((await call('/api/v1/algorithms/shared?id=' + id)).status, 404);
	checks++;
	for (const preset of ['hot', 'new', 'top', 'rising', 'controversial', 'local', 'global', 'political']) {
		assert.equal((await call('/api/v1/algorithms/active', { algorithmId: preset }, owner.cookie)).status, 200, preset);
		const result = await call('/api/v1/things/feed?algorithm=' + preset);
		assert.equal(result.status, 200, JSON.stringify(result.data));
		checks++;
	}
	for (const entry of [
		{ text: 'Near public', geo: { lat: -37.81, lng: 144.96 }, acl: ['tt:all'] },
		{ text: 'Far public', geo: { lat: 40.7, lng: -74 }, acl: ['tt:all'] },
		{ text: 'Near private', geo: { lat: -37.81, lng: 144.96 }, acl: ['tt:user'] }
	]) {
		const res = await call(
			'/api/v1/things',
			{ thingtime: ['post'], crystal: { type: 'text', text: entry.text }, tags: [suffix], geo: entry.geo, acl: entry.acl },
			owner.cookie
		);
		assert.equal(res.status, 200, JSON.stringify(res.data));
		posts.push(res.data.post.id);
		assert.deepEqual(res.data.post.geo, entry.geo);
		checks++;
	}
	const feed = await call(`/api/v1/things/feed?algorithm=local&lat=-37.81&lng=144.96&radiusKm=50&tag=${suffix}`);
	assert.equal(feed.status, 200, JSON.stringify(feed.data));
	assert.deepEqual(
		feed.data.posts.map((x) => x.id),
		[posts[0]]
	);
	checks++;
	const near = await call('/api/v1/things/search', { near: { lat: -37.81, lng: 144.96 }, radiusKm: 50, tags: suffix });
	assert.equal(near.status, 200, JSON.stringify(near.data));
	assert.deepEqual(
		near.data.things.map((x) => x.id),
		[posts[0]]
	);
	checks++;
	const invalid = await call('/api/v1/things', { crystal: { name: 'Invalid' }, geo: { lat: 91, lng: 0 } }, owner.cookie);
	assert.equal(invalid.status, 400);
	checks++;
	await call('/api/v1/things', { id: posts[0], geo: null }, owner.cookie, 'PATCH');
	const cleared = await call('/api/v1/things?id=' + posts[0]);
	assert.equal((cleared.data.post || cleared.data.thing).geo, null);
	checks++;
	console.log(
		JSON.stringify({ ok: true, checks, description: 'Two-account directory isolation, consent, branching, all builtins, geo write/search/ACL/clear' })
	);
} finally {
	for (const [id, cookie] of minted) await call('/api/v1/algorithms/delete', { id }, cookie);
	for (const id of posts) await call('/api/v1/things', { id }, owner.cookie, 'DELETE');
}
