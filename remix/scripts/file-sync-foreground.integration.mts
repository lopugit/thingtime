// Opt-in real cloud/API acceptance. Native grants/conditions are explicit test
// adapters; browser and native UI acceptance is tracked separately.
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { openSyncJournal } from '../app/fileSync/journal.client';
import { runForegroundCloudSync } from '../app/fileSync/foregroundSync';
import { readOwnedFileSyncConfiguration } from '../app/fileSync/configuredPlan';
import { newFileSyncConfiguration } from '../app/fileSync/configuration';
import { parseCloudInventory } from '../app/fileSync/cloudInventory';
import { fingerprintSource } from '../app/fileSync/contentFingerprint';
import { capabilitySatisfies } from '../app/api/utils/capabilities/capabilityContract';
const fixturePath = process.argv[2];
if (!fixturePath || (await stat(fixturePath)).mode & 0o077) throw Error('Pass a mode-0600 disposable fixture');
const fixture = JSON.parse(await readFile(fixturePath, 'utf8')),
	base = new URL(fixture.base);
assert.equal(base.protocol, 'http:');
assert.ok(['localhost', '127.0.0.1'].includes(base.hostname));
assert.equal(base.origin, fixture.base);
const cookies = new Map<string, string>();
const sessionFetch: typeof fetch = async (url, init = {}) => {
	const target = new URL(String(url), base),
		headers = new Headers(init.headers);
	if (target.origin === base.origin && init.credentials !== 'omit') {
		headers.set('Cookie', [...cookies].map(([k, v]) => k + '=' + v).join('; '));
		headers.set('Origin', base.origin);
	}
	const result = await fetch(target, { ...init, headers, redirect: 'error', signal: init.signal ?? AbortSignal.timeout(30_000) });
	if (target.origin === base.origin && init.credentials !== 'omit')
		for (const h of result.headers.getSetCookie()) {
			const pair = h.split(';')[0],
				i = pair.indexOf('=');
			cookies.set(pair.slice(0, i), pair.slice(i + 1));
		}
	return result;
};
async function api(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
	const result = await sessionFetch(new URL(path, base), {
		method,
		headers: { 'Content-Type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	assert.equal(result.status, 200, path.split('?')[0]);
	return result.json();
}
const deviceId = 'foreground-acceptance',
	localRootId = randomUUID(),
	factory = new IDBFactory();
let journal = await openSyncJournal(factory);
let rootId: string | null = null,
	configurationId: string | null = null,
	file: any = null,
	lost = true,
	failCheckpoint = true,
	puts = 0,
	bytes = new Uint8Array([1, 2, 3, 4]),
	version = 'local-1';
const source = () => ({ size: bytes.length, read: async (offset: number, length: number) => bytes.slice(offset, offset + length), check: () => {} });
await api('/api/v1/login', { username: fixture.username, password: fixture.password });
try {
	assert.equal((await api('/api/v1/auth/me')).user.id, fixture.userId);
	rootId = (await api('/api/v1/things', { thingtime: ['folder'], crystal: { name: 'Foreground sync acceptance ' + randomUUID() } })).thing.id;
	const configuration = {
		...newFileSyncConfiguration({ name: 'Foreground acceptance', deviceId, localRootId, remoteFolderId: rootId! }),
		mode: 'backup',
		paused: false
	};
	const row = (await api('/api/v1/things', { thingtime: ['file-sync'], crystal: configuration })).thing;
	configurationId = row.id;
	const saved = readOwnedFileSyncConfiguration(row, fixture.userId),
		scope = { origin: base.origin, ownerId: fixture.userId, dataPlane: 'home', deviceId, rootId: row.id };
	const runtime = {
		currentScope: () => scope,
		origin: () => base.origin,
		requireCapability: async (feature: string, minimum: string) => {
			const m = await api('/.well-known/thingtime-capabilities.json');
			assert.ok(capabilitySatisfies(m.features[feature]?.version, minimum));
		},
		fetch: async (url: any, init: any) => {
			if (init?.method === 'PUT') puts++;
			const result = await sessionFetch(url, init);
			if (new URL(String(url)).pathname === '/api/v1/files' && init?.method === 'POST' && result.ok && lost) {
				lost = false;
				await result.body?.cancel();
				throw Error('Lost accepted commit');
			}
			return result;
		}
	};
	const input = () => ({
		currentScope: () => scope,
		readConfiguration: async () => (await api('/api/v1/things?id=' + row.id)).thing,
		authorizeDevice: async () => {},
		conditions: async () => ({ network: 'wifi' as const, charging: true }),
		scanLocal: async () => [
			{
				path: 'sample.bin',
				id: 'local-file',
				version,
				kind: 'file' as const,
				size: bytes.length,
				sha256: null,
				fingerprint: await fingerprintSource(source())
			}
		],
		inventory: async () => parseCloudInventory((await api('/api/v1/files?rootId=' + rootId)).inventory, rootId!),
		source: async () => source(),
		journal: {
			...journal,
			complete: async (value: any) => {
				if (failCheckpoint) {
					failCheckpoint = false;
					throw Error('Checkpoint storage unavailable');
				}
				return journal.complete(value);
			}
		},
		runtime,
		progress: () => {}
	});
	await assert.rejects(runForegroundCloudSync(saved, scope, input(), new AbortController().signal), /Lost accepted commit/);
	const runId = (await journal.read(scope))!.id;
	journal.close();
	journal = await openSyncJournal(factory);
	const before = puts;
	await assert.rejects(runForegroundCloudSync(saved, scope, input(), new AbortController().signal), /Checkpoint storage unavailable/);
	assert.equal(puts, before);
	assert.equal((await journal.read(scope))!.id, runId);
	assert.ok((await journal.read(scope))!.operations.every((op) => op.confirmed));
	assert.equal(await journal.checkpoint(scope), null);
	const first = (await api('/api/v1/files?rootId=' + rootId)).inventory.nodes.find((node: any) => node.kind === 'file').file;
	bytes = new Uint8Array([5, 6, 7, 8, 9]);
	version = 'local-2';
	await runForegroundCloudSync(saved, scope, input(), new AbortController().signal);
	const cp = await journal.checkpoint(scope);
	assert.equal(cp!.baseline.entries[0].local.version, 'local-2');
	file = (await api('/api/v1/files?rootId=' + rootId)).inventory.nodes.find((node: any) => node.kind === 'file').file;
	assert.equal(file.id, first.id);
	assert.notEqual(file.revision, first.revision);
	const result = await sessionFetch(new URL('/api/v1/attachments/content?id=' + file.content.attachmentId + '&cache=bytes', base));
	assert.equal(result.status, 200);
	assert.equal(
		createHash('sha256')
			.update(new Uint8Array(await result.arrayBuffer()))
			.digest('hex'),
		createHash('sha256').update(bytes).digest('hex')
	);
	const count = puts;
	await runForegroundCloudSync(saved, scope, input(), new AbortController().signal);
	assert.equal(puts, count);
	console.log(
		'PASS: user-started configured upload; lost accepted commit and journal reopen; no byte reupload on retry; failed completion checkpoint; local edit recovered using immutable prior receipt; stable replacement and independent byte hash; repeat scan performs no upload.'
	);
} finally {
	try {
		if (rootId) {
			const inventory = await api('/api/v1/files?rootId=' + rootId);
			for (const node of inventory.inventory.nodes) {
				if (node.kind === 'file') {
					const f = node.file;
					await api('/api/v1/files', {
						id: f.id,
						operationId: randomUUID(),
						expectedRevision: f.revision,
						name: f.name,
						folderId: f.folderId,
						attachmentId: f.content.attachmentId,
						contentVersion: f.content.version,
						trashed: true
					});
					console.log('Tiny accounted versions retained in private Trash:', f.id);
				}
			}
		}
		if (configurationId) await api('/api/v1/things?id=' + configurationId, undefined, 'DELETE');
		if (rootId) await api('/api/v1/things?id=' + rootId, undefined, 'DELETE');
	} finally {
		journal.close();
		await api('/api/v1/auth/accounts/remove', { userId: fixture.userId });
	}
}
