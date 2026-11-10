import test from 'node:test';
import assert from 'node:assert/strict';
import { stageMobileCopy } from './mobileStaging.client';
import { parseMobileFolderResult, supportsMobileStaging, type FolderRequest, type FolderResult } from './mobileFolders.client';
import { fingerprintSource } from './contentFingerprint';
import type { LocalStagedCopy } from './localSyncTarget';
import type { SyncOperation } from './execute';
const scope = { ownerId: 'owner', origin: 'https://sync.test', dataPlane: 'home', rootId: 'config', deviceId: 'device' };
const rootId = '00d18514-f501-4b1a-a232-7b1fc5e5bef2';
async function fixture() {
	const bytes = new Uint8Array(2 * 1024 * 1024 + 3).fill(7),
		ranges: [number, number][] = [];
	const source = {
		size: bytes.length,
		check: () => {},
		read: async (o: number, n: number) => {
			ranges.push([o, n]);
			return bytes.slice(o, o + n);
		}
	};
	const fingerprint = await fingerprintSource(source);
	ranges.length = 0;
	const operation = {
		id: 'f877a2c5-1aaf-4e45-a39d-bf1250bc0419',
		confirmed: false,
		mutation: {
			kind: 'copy',
			from: 'remote',
			path: 'file',
			expectedTarget: null,
			source: { path: 'file', id: 'cloud-file', version: 'r1', kind: 'file', size: bytes.length, sha256: null, fingerprint }
		}
	} satisfies SyncOperation;
	const destination = new Uint8Array(bytes.length);
	let received = 0,
		lost = true,
		writes = 0,
		stage: LocalStagedCopy | undefined;
	const expected = { requestId: 'request', ownerId: scope.ownerId, origin: scope.origin };
	const request = async (_owner: string, input: FolderRequest): Promise<FolderResult> => {
		assert.ok(input.action.startsWith('stage-'));
		if (input.action === 'stage-append' || input.action === 'stage-range' || input.action === 'stage-download') {
			assert.equal(input.offset, received);
			const data =
				input.action === 'stage-download'
					? bytes.slice(input.offset, input.offset + input.length)
					: input.action === 'stage-range'
					? input.bytes
					: Uint8Array.from(atob(input.data), (c) => c.charCodeAt(0));
			assert.ok(data.length <= (input.action !== 'stage-append' ? 2 * 1024 * 1024 : 65_536));
			destination.set(data, received);
			received += data.length;
			writes++;
			if (lost) {
				lost = false;
				throw Error('lost acknowledged native chunk reply');
			}
		}
		if (input.action === 'stage-finish') {
			assert.equal(received, bytes.length);
			assert.deepEqual(destination, bytes);
			assert.deepEqual(await fingerprintSource({ size: received, check: () => {}, read: async (o, n) => destination.slice(o, o + n) }), fingerprint);
			stage = {
				operationId: operation.id,
				scope,
				token: 'a'.repeat(64),
				entry: { ...operation.mutation.source, id: 'native-file', version: 'native-v1' }
			};
		}
		return parseMobileFolderResult(
			{ type: 'mobile-files-result', payload: { ...expected, rootId, roots: [], staging: { received, ...(stage ? { stage } : {}) } } },
			expected,
			input
		)!;
	};
	return { bytes, source, ranges, operation, request, count: () => writes, received: () => received, expected };
}
test('native staging resumes an acknowledged chunk after reply loss, bounds bridge messages and checks final bytes', async () => {
	const f = await fixture(),
		signal = new AbortController().signal;
	await assert.rejects(stageMobileCopy(scope, rootId, f.operation, f.source, signal, f.request), /lost acknowledged/);
	assert.equal(f.received(), 65_536);
	f.ranges.length = 0;
	const stage = await stageMobileCopy(scope, rootId, f.operation, f.source, signal, f.request);
	assert.equal(f.ranges[0][0], 65_536);
	assert.ok(f.ranges.every(([, n]) => n <= 2 * 1024 * 1024));
	assert.equal(stage.operationId, f.operation.id);
	const before = f.count(),
		reads = f.ranges.length;
	assert.deepEqual(await stageMobileCopy(scope, rootId, f.operation, f.source, signal, f.request), stage);
	assert.equal(f.count(), before);
	assert.equal(f.ranges.length, reads);
});
test('native staging rejects false proofs, unnegotiated capabilities, invalid offsets and cancelled work', async () => {
	const f = await fixture();
	assert.equal(supportsMobileStaging({ isNativeWebView: true, platform: 'ios', fileAccessVersion: '1.1.0' } as any), false);
	assert.equal(
		supportsMobileStaging({ isNativeWebView: true, platform: 'ios', fileAccessVersion: '1.1.0', fileStagingVersion: '1.0.0' } as any),
		true
	);
	assert.equal(
		supportsMobileStaging({ isNativeWebView: true, platform: 'ios', fileAccessVersion: '1.1.0', fileStagingVersion: '2.0.0' } as any),
		false
	);
	const input: FolderRequest = { action: 'stage-finish', rootId, transfer: { scope, rootId, operation: f.operation } };
	const payload = { ...f.expected, rootId, roots: [], staging: { received: f.bytes.length } };
	assert.throws(() => parseMobileFolderResult({ type: 'mobile-files-result', payload }, f.expected, input), /not been verified/);
	assert.equal(parseMobileFolderResult({ type: 'mobile-files-result', payload: { ...payload, ownerId: 'other' } }, f.expected, input), null);
	for (const received of [-1, f.bytes.length + 1, 1.5]) {
		await assert.rejects(
			stageMobileCopy(scope, rootId, f.operation, f.source, new AbortController().signal, async () => ({ roots: [], staging: { received } })),
			/Invalid staged offset/
		);
	}
	const abort = new AbortController();
	abort.abort();
	await assert.rejects(
		stageMobileCopy(scope, rootId, f.operation, f.source, abort.signal, async () => {
			throw Error('must not send');
		}),
		{ name: 'AbortError' }
	);
	let called = false;
	await assert.rejects(
		stageMobileCopy(
			scope,
			rootId,
			f.operation,
			{
				...f.source,
				check: () => {
					throw Error('source changed');
				}
			},
			new AbortController().signal,
			async () => {
				called = true;
				return { roots: [] };
			}
		),
		/source changed/
	);
	assert.equal(called, false);
});

for (const platform of ['macos', 'android'] as const)
	test(`${platform} staging 1.1 resumes after an accepted binary range without replaying its bytes`, async () => {
		const f = await fixture(),
			signal = new AbortController().signal;
		const bridge = { platform, fileAccessVersion: '1.2.0', fileStagingVersion: '1.1.0' };
		await assert.rejects(stageMobileCopy(scope, rootId, f.operation, f.source, signal, f.request, bridge), /lost acknowledged/);
		assert.equal(f.received(), 2 * 1024 * 1024);
		assert.equal(f.count(), 1);
		f.ranges.length = 0;
		const stage = await stageMobileCopy(scope, rootId, f.operation, f.source, signal, f.request, bridge);
		assert.deepEqual(f.ranges, [[2 * 1024 * 1024, 3]]);
		assert.equal(f.count(), 2);
		assert.equal(stage.operationId, f.operation.id);
		assert.deepEqual(await stageMobileCopy(scope, rootId, f.operation, f.source, signal, f.request, bridge), stage);
		assert.equal(f.count(), 2);
		const input: FolderRequest = { action: 'stage-range', rootId, transfer: { scope, rootId, operation: f.operation }, offset: 0, bytes: f.bytes };
		for (const received of [0, f.bytes.length - 1, f.bytes.length + 1]) {
			assert.throws(() =>
				parseMobileFolderResult(
					{ type: 'mobile-files-result', payload: { ...f.expected, rootId, roots: [], staging: { received } } },
					f.expected,
					input
				)
			);
		}
	});

test('iOS native cloud staging resumes accepted binary ranges without sending bytes through the WebView', async () => {
	const f = await fixture(),
		signal = new AbortController().signal;
	const bridge = { platform: 'ios' as const, fileAccessVersion: '1.1.1', fileStagingVersion: '1.2.0' };
	const source = {
		...f.source,
		nativeCloud: {
			scope,
			file: {
				id: 'cloud-file',
				revision: 'r1',
				name: 'file',
				folderId: null,
				trashed: false,
				content: { attachmentId: 'attachment', version: 'a'.repeat(64), size: f.bytes.length, fingerprint: f.operation.mutation.source.fingerprint }
			}
		},
		read: async (): Promise<Uint8Array<ArrayBuffer>> => {
			throw Error('Native cloud transfer must not read bytes in JavaScript');
		}
	};
	await assert.rejects(stageMobileCopy(scope, rootId, f.operation, source, signal, f.request, bridge), /lost acknowledged/);
	assert.equal(f.received(), 2 * 1024 * 1024);
	const stage = await stageMobileCopy(scope, rootId, f.operation, source, signal, f.request, bridge);
	assert.equal(stage.operationId, f.operation.id);
	assert.equal(f.count(), 2);
	assert.deepEqual(f.ranges, []);
	assert.deepEqual(await stageMobileCopy(scope, rootId, f.operation, source, signal, f.request, bridge), stage);
	assert.equal(f.count(), 2);
	for (const changed of [
		{ ...source.nativeCloud, scope: { ...scope, ownerId: 'other' } },
		{ ...source.nativeCloud, scope: { ...scope, origin: 'https://other.test' } },
		{ ...source.nativeCloud, file: { ...source.nativeCloud.file, revision: 'changed' } },
		{ ...source.nativeCloud, file: { ...source.nativeCloud.file, trashed: true } }
	])
		await assert.rejects(
			stageMobileCopy(
				scope,
				rootId,
				f.operation,
				{ ...source, nativeCloud: changed },
				signal,
				async () => {
					throw Error('must not send changed source');
				},
				bridge
			),
			/source changed|trashed/
		);
	const input: FolderRequest = {
		action: 'stage-download',
		rootId,
		transfer: { scope, rootId, operation: f.operation },
		offset: 0,
		length: 2 * 1024 * 1024,
		cloudFile: source.nativeCloud.file
	};
	for (const received of [0, 1, input.length - 1, input.length + 1])
		assert.throws(() =>
			parseMobileFolderResult(
				{ type: 'mobile-files-result', payload: { ...f.expected, rootId, roots: [], staging: { received } } },
				f.expected,
				input
			)
		);
});


test('download telemetry excludes retained offsets and repeated completed stages', async () => {
 const f = await fixture(), signal = new AbortController().signal;
 const bridge = { platform: 'macos' as const, fileAccessVersion: '1.2.0', fileStagingVersion: '1.1.0' };
 await assert.rejects(stageMobileCopy(scope, rootId, f.operation, f.source, signal, f.request, bridge), /lost acknowledged/);
 const transferred: number[] = [], received: number[] = [];
 const record = (bytes: number, total: number) => { transferred.push(bytes); received.push(total); };
 await stageMobileCopy(scope, rootId, f.operation, f.source, signal, f.request, bridge, record);
 assert.deepEqual(transferred, [0, 3]); assert.deepEqual(received, [2 * 1024 * 1024, f.bytes.length]);
 transferred.length = 0;
 await stageMobileCopy(scope, rootId, f.operation, f.source, signal, f.request, bridge, record);
 assert.deepEqual(transferred, [0]);
});
