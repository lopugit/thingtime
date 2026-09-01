import assert from 'node:assert/strict';
import test from 'node:test';

import { createProfileAction, createProfileLoader } from './_profile';

const endpoint = 'https://thingtime.example/api/v1/users/profile';
const request = (body: unknown, headers: Record<string, string> = {}) =>
	new Request(endpoint, {
		method: 'POST',
		headers: { Origin: 'https://thingtime.example', 'Content-Type': 'application/json', ...headers },
		body: typeof body === 'string' ? body : JSON.stringify(body)
	});

// findUserByUsername returns the FULL decoded account doc (things era unpacks
// the `secure` blob back into meta), so these fixtures carry the private
// fields the public projection has to drop.
const PRIVATE_EMAIL = 'wearer-private@thingtime.example';
const PRIVATE_HASH = 'argon2-hash-never-public';
const userDoc = (meta: Record<string, unknown> = {}) => ({
	_id: 'user-1',
	ttid: 'user-1',
	username: 'themewearer',
	displayName: 'Theme Wearer',
	bio: null,
	email: PRIVATE_EMAIL,
	passwordHash: PRIVATE_HASH,
	emailVerified: true,
	createdAt: new Date('2026-01-01T00:00:00.000Z'),
	meta
});

const publicTheme = {
	id: 'theme_public_1',
	name: 'Neon Noir',
	theme: { colors: { bg: '#000000' } },
	visibility: 'public',
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-02T00:00:00.000Z'
};

const get = (query = '?username=themewearer') => new Request(`${endpoint}${query}`);

test('the public profile publishes only the worn theme id and name', async () => {
	// The chip needs a label and a ?apply target and nothing else — the token
	// document, the visibility flag and the timestamps must not ride the public
	// payload just because getSharedTheme happens to return them.
	const asked: string[] = [];
	const loader = createProfileLoader({
		findUser: async () => userDoc({ activeThemeId: 'theme_public_1' }) as any,
		countPosts: async () => 3,
		getWornTheme: async (shareId: string) => {
			asked.push(shareId);
			return publicTheme as any;
		}
	});

	const response = await loader({ request: get() });
	assert.equal(response.status, 200);
	const body = await response.json();

	assert.deepEqual(asked, ['theme_public_1']); // gate consulted with the stored pointer, verbatim
	assert.deepEqual(body.wornTheme, { id: 'theme_public_1', name: 'Neon Noir' });
	assert.equal(body.postCount, 3);
	assert.equal(body.profile.username, 'themewearer');
});

test('a gate-rejected active theme yields null and never leaks the pointer', async () => {
	// getSharedTheme matches acl 'tt:all' only, so a private (or deleted) active
	// theme comes back null. The whole point of routing through that gate is
	// that the raw activeThemeId cannot then appear anywhere on the wire — a
	// chip must show iff its ?apply link would resolve for an anonymous visitor.
	const loader = createProfileLoader({
		findUser: async () => userDoc({ activeThemeId: 'theme_private_1' }) as any,
		countPosts: async () => 0,
		getWornTheme: async () => null
	});

	const response = await loader({ request: get() });
	assert.equal(response.status, 200);
	const raw = await response.text();
	assert.equal(JSON.parse(raw).wornTheme, null);

	for (const secret of ['theme_private_1', 'activeThemeId', PRIVATE_EMAIL, PRIVATE_HASH, 'emailVerified']) {
		assert.equal(raw.includes(secret), false, `public profile payload leaked ${secret}`);
	}
});

test('the share gate is only consulted for a real string pointer', async () => {
	// A never-themed account, a cleared pointer (themes/active writes null) and
	// a junk value must all resolve locally — no extra query per public profile
	// view, and no null/42 handed to the gate.
	for (const meta of [{}, { activeThemeId: null }, { activeThemeId: '' }, { activeThemeId: 42 }, { activeThemeId: { id: 'x' } }]) {
		let consulted = 0;
		const loader = createProfileLoader({
			findUser: async () => userDoc(meta) as any,
			countPosts: async () => 0,
			getWornTheme: async () => {
				consulted += 1;
				return publicTheme as any;
			}
		});

		const body = await (await loader({ request: get() })).json();
		assert.equal(body.wornTheme, null, `meta ${JSON.stringify(meta)} produced a chip`);
		assert.equal(consulted, 0, `meta ${JSON.stringify(meta)} hit the share gate`);
	}
});

test('the public profile loader guards the username before touching any store', async () => {
	let reads = 0;
	const counting = (findUser: () => Promise<unknown>) =>
		createProfileLoader({
			findUser: findUser as any,
			countPosts: async () => {
				reads += 1;
				return 0;
			},
			getWornTheme: async () => {
				reads += 1;
				return publicTheme as any;
			}
		});

	const missing = await counting(async () => userDoc())({ request: get('') });
	assert.equal(missing.status, 400);
	assert.deepEqual(await missing.json(), { ok: false, error: 'username is required' });

	const blank = await counting(async () => userDoc())({ request: get('?username=%20%20') });
	assert.equal(blank.status, 400);

	const unknown = await counting(async () => null)({ request: get('?username=nobody') });
	assert.equal(unknown.status, 404);
	assert.deepEqual(await unknown.json(), { ok: false, error: 'User not found' });

	assert.equal(reads, 0);
});

test('profile action rejects cross-origin, unauthenticated, and non-JSON mutations', async () => {
	let updates = 0;
	const action = createProfileAction({
		getUser: async () => ({ id: 'user-1' } as any),
		updateProfile: async () => {
			updates += 1;
			return { ok: true, user: { id: 'user-1' } as any };
		}
	});
	const crossOrigin = await action({ request: request({}, { Origin: 'https://attacker.example' }) });
	assert.equal(crossOrigin.status, 403);
	assert.deepEqual(await crossOrigin.json(), { ok: false, error: 'Cross-origin profile requests are not allowed' });

	const unauthenticated = createProfileAction({
		getUser: async () => null,
		updateProfile: async () => {
			updates += 1;
			return { ok: true, user: {} as any };
		}
	});
	assert.equal((await unauthenticated({ request: request({}) })).status, 401);
	assert.equal((await action({ request: request('{}', { 'Content-Type': 'text/plain' }) })).status, 415);
	assert.equal(updates, 0);
});

test('profile action forwards managed attachment ids and returns the effective self projection', async () => {
	let received: any;
	const expected = {
		id: 'user-1',
		avatarUrl: '/api/v1/attachments/content?id=avatar-1',
		avatarAttachmentId: 'avatar-1',
		avatarLinkedUrl: 'https://images.example/fallback.jpg'
	};
	const action = createProfileAction({
		getUser: async () => ({ id: 'user-1' } as any),
		updateProfile: async (userId: string, body: any) => {
			received = { userId, body };
			return { ok: true, user: expected as any };
		}
	});
	const response = await action({
		request: request({ avatarAttachmentId: 'avatar-1', bannerAttachmentId: null })
	});
	assert.equal(response.status, 200);
	assert.deepEqual(received, {
		userId: 'user-1',
		body: { avatarAttachmentId: 'avatar-1', bannerAttachmentId: null }
	});
	assert.deepEqual(await response.json(), { ok: true, user: expected });
});

test('profile action preserves authored failures and enforces the streaming body cap', async () => {
	const action = createProfileAction({
		getUser: async () => ({ id: 'user-1' } as any),
		updateProfile: async () => ({ ok: false, status: 409, error: 'The selected avatar attachment is unavailable' })
	});
	const conflict = await action({ request: request({ avatarAttachmentId: 'avatar-missing' }) });
	assert.equal(conflict.status, 409);
	assert.deepEqual(await conflict.json(), { ok: false, error: 'The selected avatar attachment is unavailable' });

	let oversized: unknown;
	try {
		await action({ request: request({ padding: 'x'.repeat(257 * 1024) }, { 'Content-Length': '0' }) });
	} catch (error) {
		oversized = error;
	}
	assert.ok(oversized instanceof Response);
	assert.equal(oversized.status, 413);
	assert.deepEqual(await oversized.json(), { ok: false, error: 'Request body too large' });
});
