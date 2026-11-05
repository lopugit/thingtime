import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { parseThemeSelection, parseThemeSelectionAcknowledgment } from './themeSelectionContract';
const base = process.env.TT_THEME_SELECTION_API_URL,
	artifacts = process.env.TT_THEME_SELECTION_ARTIFACTS,
	playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;
test(
	'conditional active-theme selection has real atomic receipts, normal-writer conflicts and deletion fencing',
	{ skip: !base || !artifacts || !playwrightPath, timeout: 180_000 },
	async () => {
		const origin = new URL(base!).origin;
		assert.ok(['localhost', '127.0.0.1'].includes(new URL(base!).hostname));
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
		const sync = (operation: string, command?: unknown) =>
			context.post('/api/v1/themes/sync', { headers, data: { operation, expectedOwnerId: ownerId, ...(command ? { command } : {}) } });
		const selection = async () => {
			const response = await sync('selection');
			assert.equal(response.headers()['cache-control'], 'private, no-store');
			const body = await read(response, 'read private versioned selection');
			assert.deepEqual(Object.keys(body).sort(), ['dataPlane', 'ok', 'ownerId', 'selection', 'storagePlane']);
			return parseThemeSelection(body.selection);
		};
		try {
			const health = await context.get('/api/v1/mongodb/status');
			assert.equal(health.status(), 200);
			const storage = await health.json();
			assert.equal(storage.host, '127.0.0.1:22463');
			assert.equal(storage.replicaSet, 'draftPreview');
			assert.equal(storage.custom, false);
			assert.equal(storage.connected, true);
			const username = 'selection-' + randomUUID().slice(0, 8);
			ownerId = (
				await read(
					await context.post('/api/v1/auth/register', {
						headers,
						data: { username, email: username + '@example.test', password: randomUUID() + randomUUID() }
					}),
					'register disposable selection owner'
				)
			).user.id;
			await read(
				await anonymous.post('/api/v1/themes/sync', { headers, data: { operation: 'selection', expectedOwnerId: ownerId } }),
				'anonymous selection read refused',
				401
			);
			const first = await selection();
			assert.equal(first.themeId, null);
			for (const name of ['First selection fixture', 'Second selection fixture']) {
				const saved = await read(
					await context.post('/api/v1/themes', { headers, data: { name, theme: {}, visibility: 'private' } }),
					'create private theme fixture'
				);
				ids.add(saved.theme.id);
			}
			const [a, b] = [...ids],
				command = { themeId: a, expectedVersion: first.version, writeId: randomUUID() };
			const concurrent = await Promise.all([sync('select', command), sync('select', command)]);
			const ack = parseThemeSelectionAcknowledgment((await read(concurrent[0], 'first conditional selection')).acknowledgment);
			assert.deepEqual(parseThemeSelectionAcknowledgment((await read(concurrent[1], 'concurrent exact selection replay')).acknowledgment), ack);
			assert.deepEqual(await selection(), ack.result);
			await read(await sync('select', { ...command, themeId: b }), 'write identity cannot change its selected theme', 409);
			await read(await context.post('/api/v1/themes/active', { headers, data: { themeId: b } }), 'normal active-theme writer shares the same state');
			const moved = await selection();
			assert.equal(moved.themeId, b);
			assert.notEqual(moved.version, ack.result.version);
			assert.deepEqual(
				parseThemeSelectionAcknowledgment(
					(await read(await sync('select', command), 'old selection receipt does not reapply after a later normal choice')).acknowledgment
				),
				ack
			);
			assert.deepEqual(await selection(), moved);
			await read(
				await sync('select', { themeId: a, expectedVersion: ack.result.version, writeId: randomUUID() }),
				'stale device selection refuses overwriting normal choice',
				409
			);
			const contenders = [a, null].map((themeId) => ({ themeId, expectedVersion: moved.version, writeId: randomUUID() }));
			const raced = await Promise.all(contenders.map((command) => sync('select', command)));
			assert.deepEqual(raced.map((response) => response.status()).sort(), [200, 409]);
			evidence.checks.push('one concurrent desired-state selection wins');
			const latest = await selection();
			const choose = { themeId: a, expectedVersion: latest.version, writeId: randomUUID() };
			const chosen = parseThemeSelectionAcknowledgment((await read(await sync('select', choose), 'select fixture before deletion')).acknowledgment);
			assert.equal(chosen.result.themeId, a);
			await read(await context.post('/api/v1/themes/delete', { headers, data: { id: a } }), 'delete selected fixture normally');
			const cleared = await selection();
			assert.equal(cleared.themeId, null);
			assert.notEqual(cleared.version, chosen.result.version);
			assert.deepEqual(
				parseThemeSelectionAcknowledgment(
					(await read(await sync('select', choose), 'old receipt cannot restore a deleted selection')).acknowledgment
				),
				chosen
			);
			assert.deepEqual(await selection(), cleared);
			await read(
				await sync('select', { themeId: a, expectedVersion: cleared.version, writeId: randomUUID() }),
				'new selection of deleted target refused',
				404
			);
			const clear = { themeId: null, expectedVersion: cleared.version, writeId: randomUUID() };
			const removed = parseThemeSelectionAcknowledgment(
				(await read(await sync('select', clear), 'explicit clear completes normally')).acknowledgment
			);
			assert.equal(removed.result.themeId, null);
			assert.deepEqual(await selection(), removed.result);
			evidence.complete = true;
		} finally {
			try {
				if (ownerId) {
					const response = await context.get('/api/v1/themes');
					assert.equal(response.status(), 200);
					for (const theme of (await response.json()).themes) {
						assert.ok(ids.has(theme.id));
						assert.equal((await context.post('/api/v1/themes/delete', { headers, data: { id: theme.id } })).status(), 200);
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
