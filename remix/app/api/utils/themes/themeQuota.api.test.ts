import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.TT_THEME_SYNC_API_URL,
	artifacts = process.env.TT_THEME_SYNC_API_ARTIFACTS,
	playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;
test(
	'concurrent normal theme creates exceed the former count limit and drain bounded pages',
	{ skip: !base || !artifacts || !playwrightPath, timeout: 240_000 },
	async () => {
		const origin = new URL(base!).origin;
		assert.ok(['localhost', '127.0.0.1'].includes(new URL(base!).hostname));
		const { request } = await import(playwrightPath!),
			context = await request.newContext({ baseURL: origin });
		const headers = { Origin: origin };
		let registered = false;
		const fixtureCount = 103;
		const evidence: { statuses?: number[]; count?: number; complete?: boolean; cleanup?: boolean } = {};
		const listAll = async () => {
			const rows: any[] = [];
			let cursor: string | null = null;
			do {
				const response = await context.get('/api/v1/themes?page=1' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
				assert.equal(response.status(), 200);
				const page = await response.json();
				assert.ok(page.themes.length <= 64);
				rows.push(...page.themes);
				cursor = page.nextCursor;
			} while (cursor);
			return rows;
		};
		const save = (index: number) =>
			context.post('/api/v1/themes', { headers, data: { name: 'Quota fixture ' + index, theme: {}, visibility: 'private' } });
		try {
			const health = await context.get('/api/v1/mongodb/status');
			assert.equal(health.status(), 200);
			const storage = await health.json();
			assert.equal(storage.host, '127.0.0.1:22463');
			assert.equal(storage.replicaSet, 'draftPreview');
			assert.equal(storage.custom, false);
			assert.equal(storage.connected, true);
			const username = 'themequota-' + randomUUID().slice(0, 8);
			const response = await context.post('/api/v1/auth/register', {
				headers,
				data: { username, email: username + '@example.test', password: randomUUID() + randomUUID() }
			});
			assert.equal(response.status(), 200);
			registered = true;
			for (let index = 0; index < fixtureCount - 2; index++) {
				const response = await save(index);
				assert.equal(response.status(), 200, 'seed only disposable owner through normal theme API');
			}
			const contenders = await Promise.all([save(fixtureCount - 2), save(fixtureCount - 1)]);
			evidence.statuses = contenders.map((x) => x.status()).sort();
			evidence.count = (await listAll()).length;
			assert.deepEqual(evidence.statuses, [200, 200]);
			assert.equal(evidence.count, fixtureCount);
			evidence.complete = true;
		} finally {
			try {
				if (registered) {
					const themes = await listAll();
					for (const theme of themes) {
						assert.ok(theme.name.startsWith('Quota fixture '));
						assert.equal((await context.post('/api/v1/themes/delete', { headers, data: { id: theme.id } })).status(), 200);
					}
					assert.deepEqual(await listAll(), []);
					evidence.cleanup = true;
				}
				await mkdir(artifacts!, { recursive: true });
				await writeFile(artifacts + '/quota-verification.json', JSON.stringify(evidence, null, 2));
			} finally {
				await context.dispose();
			}
		}
	}
);
