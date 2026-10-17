import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.TT_THEME_SYNC_API_URL,
	artifacts = process.env.TT_THEME_SYNC_API_ARTIFACTS,
	playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;
test(
	'conditional account theme saves use canonical storage, durable receipts and atomic deletion cleanup',
	{ skip: !base || !artifacts || !playwrightPath, timeout: 180_000 },
	async () => {
		const origin = new URL(base!).origin;
		assert.ok(['localhost', '127.0.0.1'].includes(new URL(base!).hostname));
		assert.ok(!new URL(base!).username && !new URL(base!).password);
		const { request } = await import(playwrightPath!),
			context = await request.newContext({ baseURL: origin }),
			anonymous = await request.newContext({ baseURL: origin });
		const headers = { Origin: origin, 'X-Thingtime-Expected-Data-Plane': 'home' },
			ids = new Set<string>(),
			evidence: { checks: string[]; complete?: boolean; fixtureEntriesCleaned?: boolean } = { checks: [] };
		let ownerId = '';
		const read = async (response: any, label: string, status = 200) => {
			assert.equal(response.status(), status, label);
			evidence.checks.push(label);
			return response.json();
		};
		const sync = (data: unknown, extra = {}) => context.post('/api/v1/themes/sync', { headers: { ...headers, ...extra }, data });
		const write = (command: unknown) => sync({ operation: 'write', expectedOwnerId: ownerId, command });
		const snapshot = async () => {
			const response = await sync({ operation: 'snapshot', expectedOwnerId: ownerId });
			assert.equal(response.headers()['cache-control'], 'private, no-store');
			const result = await read(response, 'complete scoped home theme snapshot');
			assert.equal(result.ownerId, ownerId);
			assert.equal(result.dataPlane, 'home');
			assert.equal(result.storagePlane, 'home');
			assert.equal(result.complete, true);
			return result.themes;
		};
		try {
			const health = await context.get('/api/v1/mongodb/status');
			assert.equal(health.status(), 200);
			const storage = await health.json();
			assert.equal(storage.host, '127.0.0.1:22463');
			assert.equal(storage.replicaSet, 'draftPreview');
			assert.equal(storage.custom, false);
			assert.equal(storage.connected, true);
			const username = 'themesync-' + randomUUID().slice(0, 8);
			ownerId = (
				await read(
					await context.post('/api/v1/auth/register', {
						headers,
						data: { username, email: username + '@example.test', password: randomUUID() + randomUUID() }
					}),
					'register disposable theme owner'
				)
			).user.id;
			await read(
				await anonymous.post('/api/v1/themes/sync', { headers, data: { operation: 'snapshot', expectedOwnerId: ownerId } }),
				'anonymous snapshot refused',
				401
			);
			await read(
				await sync({ operation: 'snapshot', expectedOwnerId: ownerId }, { Origin: 'https://other.example' }),
				'cross-origin snapshot refused',
				403
			);
			await read(await sync({ operation: 'snapshot', expectedOwnerId: 'other' }), 'wrong owner refused', 409);
			await read(
				await sync({ operation: 'snapshot', expectedOwnerId: ownerId }, { 'X-Thingtime-Expected-Data-Plane': 'custom-' + 'a'.repeat(64) }),
				'changed selected plane refused',
				409
			);
			assert.deepEqual(await snapshot(), []);
			const create = {
				action: 'save',
				id: randomUUID(),
				writeId: randomUUID(),
				expectedVersion: null,
				name: 'Local peach',
				theme: { colors: { accent: '#bf8068' } },
				visibility: 'private'
			};
			ids.add(create.id);
			const receipts = await Promise.all([write(create), write(create)]);
			const first = (await read(receipts[0], 'concurrent exact create receipt')).acknowledgment,
				second = (await read(receipts[1], 'concurrent exact create replay')).acknowledgment;
			assert.deepEqual(first, second);
			assert.equal((await snapshot()).length, 1);
			assert.deepEqual((await read(await write(create), 'lost-response create replay')).acknowledgment, first);
			await read(await write({ ...create, name: 'Changed immutable payload' }), 'write ID cannot change payload', 409);
			const normal = await read(
				await context.post('/api/v1/themes', {
					headers,
					data: { id: create.id, name: 'Other device theme', theme: { colors: { accent: '#aa7755' } }, visibility: 'private' }
				}),
				'normal theme editor changes same protected Thing'
			);
			assert.equal(normal.theme.id, create.id);
			await read(
				await write({ ...create, writeId: randomUUID(), expectedVersion: first.resultVersion, name: 'Stale device' }),
				'stale device save refuses overwrite',
				409
			);
			const beforeTitle = (await snapshot())[0];
			assert.equal(beforeTitle.name, 'Other device theme');
			assert.notEqual(beforeTitle.version, first.resultVersion);
			await read(
				await context.patch('/api/v1/things', { headers, data: { id: create.id, displayTitle: 'Fixture library title' } }),
				'generic library title edit shares the protected theme preimage'
			);
			await read(
				await write({ ...create, writeId: randomUUID(), expectedVersion: beforeTitle.version, name: 'Outdated title snapshot' }),
				'generic title edit invalidates pending theme version',
				409
			);
			const current = (await snapshot())[0];
			assert.notEqual(current.version, beforeTitle.version);

			assert.deepEqual((await read(await write(create), 'original receipt survives later edits')).acknowledgment, first);
			const candidates = ['Device one', 'Device two'].map((name) => ({ ...create, writeId: randomUUID(), expectedVersion: current.version, name }));
			const raced = await Promise.all(candidates.map(write));
			assert.deepEqual(raced.map((x) => x.status()).sort(), [200, 409]);
			evidence.checks.push('one conditional update wins; concurrent stale writer refused');
			const winner = raced.findIndex((x) => x.status() === 200);
			const winnerReceipt = (await raced[winner].json()).acknowledgment;
			const after = (await snapshot())[0];
			assert.equal(after.name, candidates[winner].name);
			assert.equal(after.version, winnerReceipt.resultVersion);
			// Selected content-plane changes do not move protected themes away from home.
			const custom = { 'x-tt-mongo-url': 'mongodb://127.0.0.1:22463/theme_sync_' + randomUUID().replace(/-/g, '') + '?replicaSet=draftPreview' };
			const root = await read(await context.get('/api/root-data', { headers: { ...headers, ...custom } }), 'resolve disposable selected database');
			assert.match(root.dataPlane, /^custom-[a-f0-9]{64}$/);
			const selected = { ...custom, 'X-Thingtime-Expected-Data-Plane': root.dataPlane };
			const homeSnapshot = await read(
				await sync({ operation: 'snapshot', expectedOwnerId: ownerId }, selected),
				'custom selected plane still reads canonical home themes'
			);
			assert.equal(homeSnapshot.storagePlane, 'home');
			assert.equal(homeSnapshot.dataPlane, root.dataPlane);
			assert.equal(homeSnapshot.themes[0].version, after.version);
			await read(
				await sync({ operation: 'write', expectedOwnerId: ownerId, command: create }, selected),
				'an immutable receipt cannot be replayed through another selected plane',
				409
			);
			const customWrite = { ...create, writeId: randomUUID(), expectedVersion: after.version, name: 'Home theme from selected database' };
			const customReceipt = (
				await read(
					await sync({ operation: 'write', expectedOwnerId: ownerId, command: customWrite }, selected),
					'conditional home write under confirmed custom selection'
				)
			).acknowledgment;
			const settled = (await snapshot())[0];
			assert.equal(settled.version, customReceipt.resultVersion);
			assert.equal(settled.name, customWrite.name);
			const listed = await read(await context.get('/api/v1/themes'), 'normal theme list reads canonical synchronized content');
			assert.equal(listed.themes.length, 1);
			assert.equal(listed.themes[0].id, create.id);
			assert.equal(listed.themes[0].visibility, 'private');
			const canonical = await read(await context.get('/api/v1/things', { params: { id: create.id } }), 'read synchronized canonical protected Thing');
			assert.equal(canonical.thing.crystal.title, 'Fixture library title');
			await read(
				await anonymous.get('/api/v1/themes/shared', { params: { id: create.id } }),
				'private synchronized theme is not publicly readable',
				404
			);
			await read(await context.post('/api/v1/themes/active', { headers, data: { themeId: create.id } }), 'select fixture theme normally');
			const me = await read(await context.get('/api/v1/auth/me'), 'selected fixture theme readback');
			assert.equal(me.user.activeThemeId, create.id);
			const remove = { action: 'delete', id: create.id, writeId: randomUUID(), expectedVersion: settled.version };
			const removed = (await read(await write(remove), 'conditional theme deletion')).acknowledgment;
			assert.equal(removed.resultVersion, null);
			assert.deepEqual((await read(await write(remove), 'lost deletion response replays exact receipt')).acknowledgment, removed);
			assert.deepEqual(await snapshot(), []);
			const cleared = await read(await context.get('/api/v1/auth/me'), 'deletion clears active theme in same completed operation');
			assert.equal(cleared.user.activeThemeId, null);
			assert.deepEqual((await read(await write(create), 'old create receipt cannot resurrect deleted content')).acknowledgment, first);
			assert.deepEqual(await snapshot(), []);
			evidence.complete = true;
		} finally {
			try {
				if (ownerId) {
					const response = await context.get('/api/v1/themes');
					assert.equal(response.status(), 200);
					for (const theme of (await response.json()).themes) {
						assert.ok(ids.has(theme.id), 'cleanup only fixture-owned ids');
						const removed = await context.post('/api/v1/themes/delete', { headers, data: { id: theme.id } });
						assert.equal(removed.status(), 200);
					}
					const final = await context.get('/api/v1/themes');
					assert.equal(final.status(), 200);
					assert.deepEqual((await final.json()).themes, []);
					evidence.fixtureEntriesCleaned = true;
				}
				await mkdir(artifacts!, { recursive: true });
				await writeFile(artifacts + '/verification.json', JSON.stringify(evidence, null, 2));
			} finally {
				await context.dispose();
				await anonymous.dispose();
			}
		}
	}
);
