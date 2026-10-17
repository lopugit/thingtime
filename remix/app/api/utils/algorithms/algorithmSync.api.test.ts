import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { parseTransfer, serializeTransfer, validateTransfer } from '../../../utils/thingTransfer/format';
import { capabilitySatisfies, THINGTIME_CAPABILITY_MANIFEST_PATH } from '../capabilities/capabilityContract';
const base = process.env.TT_ALGORITHM_SYNC_API_URL,
	artifacts = process.env.TT_ALGORITHM_SYNC_API_ARTIFACTS,
	playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;
test(
	'algorithm sync uses canonical private storage, conditional content and immutable receipts',
	{ skip: !base || !artifacts || !playwrightPath, timeout: 180000 },
	async () => {
		const origin = new URL(base!).origin;
		assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
		const { request } = await import(playwrightPath!),
			owner = await request.newContext({ baseURL: origin }),
			guest = await request.newContext({ baseURL: origin }),
			other = await request.newContext({ baseURL: origin });
		const headers = { Origin: origin, 'X-Thingtime-Expected-Data-Plane': 'home' },
			ids = new Set<string>(),
			checks: string[] = [];
		let ownerId = '',
			complete = false;
		const read = async (response: any, label: string, status = 200) => {
			assert.equal(response.status(), status, label + ': ' + (await response.text()));
			checks.push(label);
			return response.json();
		};
		const sync = (data: unknown, extra = {}) => owner.post('/api/v1/algorithms/sync', { headers: { ...headers, ...extra }, data });
		const write = (command: unknown, extra = {}) => sync({ operation: 'write', expectedOwnerId: ownerId, command }, extra);
		const snapshot = async (extra = {}) => {
			const response = await sync({ operation: 'snapshot', expectedOwnerId: ownerId }, extra);
			assert.equal(response.headers()['cache-control'], 'private, no-store');
			const result = await read(response, 'complete home profile snapshot');
			assert.equal(result.complete, true);
			assert.equal(result.storagePlane, 'home');
			assert.equal(result.ownerId, ownerId);
			return result.algorithms;
		};
		try {
			const health = await read(await owner.get('/api/v1/mongodb/status'), 'isolated replica');
			assert.equal(health.host, '127.0.0.1:22463');
			assert.equal(health.replicaSet, 'draftPreview');
			assert.equal(health.custom, false);
			assert.equal(health.connected, true);
			const capabilities = await read(await guest.get(THINGTIME_CAPABILITY_MANIFEST_PATH), 'live origin capability discovery');
			const routes = await read(await guest.get('/api/v1/capabilities'), 'live route capability discovery');
			assert.equal(capabilities.origin, origin);
			for (const [feature, required] of [
				['api.algorithms-sync', '1.1.0'],
				['api.algorithms-delete', '1.0.1']
			]) {
				assert.ok(capabilitySatisfies(capabilities.features[feature]?.version, required));
				assert.ok(capabilitySatisfies(routes.features[feature], required));
			}
			const register = async (context: any) => {
				const username = 'algorithmsync-' + randomUUID().slice(0, 8);
				return (
					await read(
						await context.post('/api/v1/auth/register', {
							headers,
							data: { username, email: username + '@example.test', password: randomUUID() + randomUUID() }
						}),
						'register disposable account'
					)
				).user.id;
			};
			ownerId = await register(owner);
			const otherId = await register(other);
			const payload = { operation: 'snapshot', expectedOwnerId: ownerId };
			await read(await guest.post('/api/v1/algorithms/sync', { headers, data: payload }), 'anonymous refused', 401);
			await read(await other.post('/api/v1/algorithms/sync', { headers, data: payload }), 'different account refused', 409);
			await read(await sync(payload, { Origin: 'https://other.example' }), 'cross-origin refused', 403);
			await read(await sync(payload, { 'X-Thingtime-Expected-Data-Plane': 'custom-' + 'a'.repeat(64) }), 'changed selection refused', 409);
			assert.deepEqual(await snapshot(), []);
			const create = {
				action: 'save',
				id: randomUUID(),
				writeId: randomUUID(),
				expectedVersion: null,
				description: 'Created offline',
				content: {
					name: 'Offline reading',
					emoji: '🧠',
					weights: { types: { text: 0.5 }, tags: { kindness: 2 }, authors: {} },
					eventCount: 7,
					lastTrainedAt: '2026-10-18T00:00:00.000Z'
				}
			};
			ids.add(create.id);
			const first = (await read(await write(create), 'create exact portable profile')).acknowledgment;
			const row = (await snapshot())[0];
			assert.equal(row.version, first.resultVersion);
			assert.deepEqual(row.content, create.content);
			assert.equal(row.shared, false);
			assert.equal(row.listed, false);
			assert.deepEqual((await read(await write(create), 'exact lost-response replay')).acknowledgment, first);
			assert.equal((await snapshot()).length, 1);
			await read(await write({ ...create, description: 'Different retry' }), 'altered immutable command refused', 409);
			await read(await write({ ...create, shared: true }), 'sync cannot publish', 400);
			await read(await guest.get('/api/v1/algorithms/shared?id=' + create.id), 'private sharing preview refused', 404);
			await read(
				await owner.patch('/api/v1/things', { headers, data: { id: create.id, crystal: { weights: {} } } }),
				'generic protected writer refused',
				403
			);
			const custom = { 'x-tt-mongo-url': 'mongodb://127.0.0.1:22463/algorithm_sync_' + randomUUID().replace(/-/g, '') + '?replicaSet=draftPreview' };
			const root = await read(await owner.get('/api/root-data', { headers: { ...headers, ...custom } }), 'confirm isolated selected database');
			assert.match(root.dataPlane, /^custom-/);
			const selected = { ...custom, 'X-Thingtime-Expected-Data-Plane': root.dataPlane };
			assert.deepEqual((await read(await write(create, selected), 'home receipt survives verified selection change')).acknowledgment, first);
			assert.deepEqual((await snapshot(selected))[0].content, create.content);
			await read(
				await owner.post('/api/v1/algorithms/update', { headers, data: { id: create.id, name: 'Edited elsewhere' } }),
				'ordinary editor changes version'
			);
			await read(await write({ ...create, writeId: randomUUID(), expectedVersion: first.resultVersion }), 'stale offline profile refused', 409);
			const current = (await snapshot())[0];
			assert.equal(current.content.name, 'Edited elsewhere');
			const update = {
				...create,
				writeId: randomUUID(),
				expectedVersion: current.version,
				content: { ...create.content, name: 'Updated profile', eventCount: 9 }
			};
			const updated = (await read(await write(update), 'conditional profile replacement')).acknowledgment;
			assert.equal((await snapshot())[0].content.eventCount, 9);
			assert.deepEqual((await read(await write(update), 'training count is not applied twice')).acknowledgment, updated);
			assert.equal((await snapshot())[0].content.eventCount, 9);
			const contenders = [
				{ ...update, writeId: randomUUID(), expectedVersion: updated.resultVersion, description: 'First candidate' },
				{ ...update, writeId: randomUUID(), expectedVersion: updated.resultVersion, description: 'Second candidate' }
			];
			const raced = await Promise.all(contenders.map((command) => write(command)));
			assert.deepEqual(raced.map((response) => response.status()).sort(), [200, 409]);
			checks.push('concurrent divergent writes commit only one');
			const settled = (await snapshot())[0];
			const branch = {
				...create,
				id: randomUUID(),
				writeId: randomUUID(),
				parentId: create.id,
				content: { ...create.content, name: 'Independent branch' }
			};
			ids.add(branch.id);
			await read(await write(branch), 'branch retains owned lineage');
			assert.equal((await snapshot()).find((item: any) => item.id === branch.id).parentId, create.id);
			const exported = await read(
				await owner.post('/api/v1/things/export', { headers, data: { ids: [create.id], includeFiles: false } }),
				'normal canonical export'
			);
			const manifest = parseTransfer(serializeTransfer(validateTransfer({ format: 'thingtime.transfer', version: 1, ...exported.plan })));
			assert.equal(manifest.things.length, 1);
			assert.deepEqual(manifest.things[0].crystal, update.content);
			assert.deepEqual(Object.keys(manifest.things[0]).sort(), ['crystal', 'id', 'thingtime']);
			const imported = await read(
				await owner.post('/api/v1/things/import', { headers, data: { manifest, files: {} } }),
				'normal canonical import round trip'
			);
			const importedId = imported.ids[create.id];
			ids.add(importedId);
			assert.notEqual(importedId, create.id);
			assert.deepEqual(imported.roots, [importedId]);
			const restored = (await snapshot()).find((item: any) => item.id === importedId);
			assert.ok(restored);
			assert.deepEqual(restored.content, update.content);
			assert.equal(restored.parentId, null);
			assert.equal(restored.shared, false);
			assert.equal(restored.listed, false);
			assert.equal((await read(await owner.get('/api/v1/auth/me'), 'import does not activate the profile')).user.activeFeedAlgorithmId, null);
			await mkdir(artifacts!, { recursive: true });
			await writeFile(artifacts + '/export.json', JSON.stringify(exported, null, 2));
			await writeFile(artifacts + '/profile.thingtime.json', serializeTransfer(manifest));
			const selection = async () =>
				(await read(await sync({ operation: 'selection', expectedOwnerId: ownerId }), 'private selection snapshot')).selection;
			const select = (command: unknown, extra = {}) => sync({ operation: 'select', expectedOwnerId: ownerId, command }, extra);
			const initialChoice = await selection();
			assert.equal(initialChoice.algorithmId, null);
			await read(
				await select({ algorithmId: randomUUID(), expectedVersion: initialChoice.version, writeId: randomUUID() }),
				'unavailable profile cannot be selected',
				404
			);
			const choice = { algorithmId: create.id, expectedVersion: initialChoice.version, writeId: randomUUID() };
			const chosen = (await read(await select(choice), 'conditional active profile selection')).acknowledgment;
			assert.equal(chosen.result.algorithmId, create.id);
			assert.equal((await selection()).algorithmId, create.id);
			assert.deepEqual((await read(await select(choice, selected), 'selection home receipt survives selected-plane change')).acknowledgment, chosen);
			await read(await select({ ...choice, algorithmId: branch.id }), 'changed selection receipt identity refused', 409);
			const otherChoice = (
				await read(
					await other.post('/api/v1/algorithms/sync', { headers, data: { operation: 'selection', expectedOwnerId: otherId } }),
					'other isolated selection'
				)
			).selection;
			await read(
				await other.post('/api/v1/algorithms/sync', {
					headers,
					data: {
						operation: 'select',
						expectedOwnerId: otherId,
						command: { algorithmId: create.id, expectedVersion: otherChoice.version, writeId: randomUUID() }
					}
				}),
				'private profile cannot be selected by another account',
				404
			);
			await read(
				await owner.post('/api/v1/algorithms/active', { headers, data: { algorithmId: 'hot' } }),
				'normal writer supersedes conditional selection'
			);
			assert.deepEqual((await read(await select(choice), 'old selection response replay')).acknowledgment, chosen);
			assert.equal((await selection()).algorithmId, 'hot');
			await read(
				await select({ ...choice, writeId: randomUUID(), expectedVersion: chosen.result.version }),
				'stale selection cannot overwrite newer choice',
				409
			);
			const beforeRace = await selection();
			const selections = await Promise.all(
				['new', null].map((algorithmId) => select({ algorithmId, expectedVersion: beforeRace.version, writeId: randomUUID() }))
			);
			assert.deepEqual(selections.map((r) => r.status()).sort(), [200, 409]);
			checks.push('concurrent selections commit only one');
			const beforeClear = await selection();
			await read(await select({ algorithmId: null, expectedVersion: beforeClear.version, writeId: randomUUID() }), 'conditional latest clearing');
			assert.equal((await selection()).algorithmId, null);
			await read(await owner.post('/api/v1/algorithms/active', { headers, data: { algorithmId: create.id } }), 'normal active selection');
			const deletion = { action: 'delete', id: create.id, writeId: randomUUID(), expectedVersion: settled.version };
			const removed = (await read(await write(deletion), 'atomic profile and active-pointer deletion')).acknowledgment;
			assert.equal(removed.resultVersion, null);
			assert.equal((await read(await owner.get('/api/v1/auth/me'), 'selection cleared')).user.activeFeedAlgorithmId, null);
			await read(
				await owner.post('/api/v1/algorithms/active', { headers, data: { algorithmId: branch.id } }),
				'select a different profile after deletion'
			);
			assert.deepEqual((await read(await write(deletion), 'exact deletion replay')).acknowledgment, removed);
			assert.equal(
				(await read(await owner.get('/api/v1/auth/me'), 'deletion replay preserves newer selection')).user.activeFeedAlgorithmId,
				branch.id
			);
			assert.deepEqual((await read(await select(choice), 'old selection receipt never reactivates a deleted profile')).acknowledgment, chosen);
			assert.equal((await selection()).algorithmId, branch.id);
			assert.deepEqual((await read(await write(create), 'old creation receipt never resurrects deleted profile')).acknowledgment, first);
			assert.equal(
				(await snapshot()).some((item: any) => item.id === create.id),
				false
			);
			const beforeDeleteRace = await selection();
			const deleteRace = await Promise.all([
				select({ algorithmId: importedId, expectedVersion: beforeDeleteRace.version, writeId: randomUUID() }),
				write({ action: 'delete', id: importedId, expectedVersion: restored.version, writeId: randomUUID() })
			]);
			assert.ok([200, 404, 409].includes(deleteRace[0].status()));
			assert.equal(deleteRace[1].status(), 200);
			assert.notEqual((await selection()).algorithmId, importedId);
			checks.push('concurrent selection and profile deletion cannot leave a dangling active pointer');
			complete = true;
		} finally {
			try {
				if (ownerId) {
					const result = await owner.get('/api/v1/algorithms');
					assert.equal(result.status(), 200);
					for (const row of (await result.json()).algorithms) {
						assert.ok(ids.has(row.id));
						await read(await owner.post('/api/v1/algorithms/delete', { headers, data: { id: row.id } }), 'cleanup fixture profile');
					}
				}
				await mkdir(artifacts!, { recursive: true });
				await writeFile(artifacts + '/verification.json', JSON.stringify({ complete, checks }, null, 2));
			} finally {
				await owner.dispose();
				await guest.dispose();
				await other.dispose();
			}
		}
	}
);
