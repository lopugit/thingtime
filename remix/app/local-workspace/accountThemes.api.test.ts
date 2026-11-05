import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { IDBFactory } from 'fake-indexeddb';
import { AccountThemeSync, parseAccountThemeSnapshot, type AccountThemeTransport } from './accountThemes';
import { WorkspaceDatabase, WorkspaceError } from './storage';
import { LocalThings } from './things';
import { validateTransfer } from '../utils/thingTransfer/format';
import { parseThemeWriteAcknowledgment } from '../api/utils/themes/themeSyncContract';
const base = process.env.TT_ACCOUNT_THEMES_API_URL,
	artifacts = process.env.TT_ACCOUNT_THEMES_ARTIFACTS,
	playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;
test(
	'device theme queue round-trips real private account writes, uncertain responses and reviewed copies',
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
		let ownerId = '',
			clock = Date.now();
		const db = new WorkspaceDatabase(new IDBFactory()),
			lease = { assertCurrent() {}, onInvalidate: () => () => {} };
		const read = async (response: any, label: string, status = 200) => {
			assert.equal(response.status(), status, label);
			evidence.checks.push(label);
			return response.json();
		};
		const command = async (operation: string, value?: unknown) => {
			const response = await context.post('/api/v1/themes/sync', {
				headers,
				data: { operation, expectedOwnerId: ownerId, ...(value ? { command: value } : {}) }
			});
			const body = await response.json();
			assert.equal(response.headers()['cache-control'], 'private, no-store');
			if (!response.ok()) throw new WorkspaceError('THEME_SYNC_REFUSED', 'Request refused', response.status());
			assert.equal(body.ownerId, ownerId);
			assert.equal(body.dataPlane, 'home');
			assert.equal(body.storagePlane, 'home');
			return body;
		};
		const transport: AccountThemeTransport = {
			snapshot: async () => {
				const result = await command('snapshot');
				assert.equal(result.complete, true);
				return parseAccountThemeSnapshot(result.themes);
			},
			write: async (value) => parseThemeWriteAcknowledgment((await command('write', value)).acknowledgment)
		};
		try {
			const health = await context.get('/api/v1/mongodb/status');
			assert.equal(health.status(), 200);
			const storage = await health.json();
			assert.equal(storage.host, '127.0.0.1:22463');
			assert.equal(storage.replicaSet, 'draftPreview');
			assert.equal(storage.custom, false);
			assert.equal(storage.connected, true);
			const username = 'devicetheme-' + randomUUID().slice(0, 8);
			ownerId = (
				await read(
					await context.post('/api/v1/auth/register', {
						headers,
						data: { username, email: username + '@example.test', password: randomUUID() + randomUUID() }
					}),
					'register disposable device-theme owner'
				)
			).user.id;
			const scope = { kind: 'account', origin, ownerId, dataPlane: 'home' } as const,
				device = new AccountThemeSync(db, scope, lease, () => clock, randomUUID);
			const local = (await device.save({ name: 'Device peach', theme: { colors: { accent: '#bb8866' } }, visibility: 'private' })).theme;
			ids.add(local.id);
			assert.equal((await device.status())[0].state, 'pending');
			assert.equal((await transport.snapshot(new AbortController().signal)).length, 0);
			evidence.checks.push('device save completes before any account write');
			let lose = true;
			const uncertain = {
				...transport,
				write: async (value: any, signal: AbortSignal) => {
					const result = await transport.write(value, signal);
					if (lose) {
						lose = false;
						throw Error('discard successful network reply');
					}
					return result;
				}
			};
			await device.sync(uncertain);
			const frozen = (await device.status())[0].pending!.command;
			assert.equal((await transport.snapshot(new AbortController().signal)).length, 1);
			assert.equal((await device.status())[0].state, 'pending');
			await device.save({ id: local.id, name: 'Newer device peach', theme: { colors: { accent: '#cc9988' } }, visibility: 'private' });
			clock += 100_000;
			assert.deepEqual((await device.status())[0].pending!.command, frozen);
			await device.sync(transport);
			assert.equal((await device.status())[0].state, 'synced');
			assert.equal((await transport.snapshot(new AbortController().signal))[0].name, 'Newer device peach');
			evidence.checks.push('uncertain create replays once before a later device edit');
			await device.refresh(transport);
			const row = (await device.list()).themes[0];
			await device.save({ id: row.id, name: 'Local branch', theme: row.theme, visibility: 'private' });
			await read(
				await context.post('/api/v1/themes', {
					headers,
					data: { id: row.id, name: 'Account original', theme: { colors: { accent: '#775544' } }, visibility: 'private' }
				}),
				'normal editor changes same protected theme'
			);
			await device.sync(transport);
			assert.equal((await device.status())[0].state, 'conflict');
			const review = await device.inspect(row.id, transport),
				copy = await device.resolve(review, 'copy', transport);
			assert.ok(copy.copyId);
			ids.add(copy.copyId!);
			await device.sync(transport);
			const catalog = await transport.snapshot(new AbortController().signal);
			assert.equal(catalog.length, 2);
			assert.equal(catalog.find((x) => x.id === row.id)?.name, 'Account original');
			assert.match(catalog.find((x) => x.id === copy.copyId)?.name ?? '', /Local branch/);
			evidence.checks.push('reviewed independent copy preserves account original');
			await read(await anonymous.get('/api/v1/themes/shared', { params: { id: copy.copyId } }), 'device-synchronized copy stays private', 404);
			const exported = await new LocalThings(db, scope, lease).export([copy.copyId!]);
			validateTransfer(exported.manifest);
			assert.equal(exported.manifest.things.length, 1);
			assert.ok(!JSON.stringify(exported.manifest).includes('baseVersion'));
			await mkdir(artifacts!, { recursive: true });
			await writeFile(artifacts + '/theme.transfer.json', JSON.stringify(exported.manifest, null, 2));
			evidence.checks.push('normal canonical export excludes queue and account authority');
			const copyOnDevice = (await device.list()).themes.find((x) => x.id === copy.copyId)!;
			await device.remove(copyOnDevice.id);
			await device.sync(transport);
			assert.equal((await transport.snapshot(new AbortController().signal)).length, 1);
			evidence.checks.push('device deletion synchronizes independently');
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
				await db.close();
				await context.dispose();
				await anonymous.dispose();
			}
		}
	}
);
