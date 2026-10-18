import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { openSyncJournal } from './journal.client';
import { fingerprintSource } from './contentFingerprint';
import { newFileSyncConfiguration } from './configuration';
import { fileCommitEventId, fileRetentionEventId } from './fileVersions';
import type { CloudFile } from './cloudFile';
import type { SyncConflictReviewResult } from './conflictResolution';

export const scope = { origin: 'https://retain.test', ownerId: 'owner', dataPlane: 'home', deviceId: 'phone', rootId: 'connection' };
export async function retentionFixture() {
	const data = new Uint8Array([11, 22, 33]),
		factory = new IDBFactory();
	let sourceReads = 0,
		sourceOpens = 0,
		uploads = 0,
		puts = 0,
		retained = 0,
		publications = 0,
		reviews = 0;
	let localAvailable = true,
		localVersion = 'local-1',
		lost = false;
	const source = () => ({
		size: data.length,
		check: () => {
			if (!localAvailable) throw Error('Device source unavailable');
		},
		read: async (offset: number, length: number) => {
			sourceReads++;
			return data.slice(offset, offset + length);
		}
	});
	const fingerprint = await fingerprintSource(source());
	sourceReads = 0;
	let live: CloudFile = {
		id: randomUUID(),
		revision: 'cloud-1',
		name: 'report.bin',
		folderId: 'cloud-root',
		trashed: false,
		content: { attachmentId: 'cloud-original', version: 'a'.repeat(64), size: data.length, fingerprint: { ...fingerprint, sha256: 'b'.repeat(64) } }
	};
	const original = structuredClone(live);
	const receipts = new Map<string, { body: string; file: CloudFile }>(),
		ready = new Set<string>();
	let journal = await openSyncJournal(factory, 'thingtime-file-sync-v1', IDBKeyRange);
	const saved = {
		id: scope.rootId,
		updatedAt: '2026-10-17T00:00:00.000Z',
		configuration: {
			...newFileSyncConfiguration({
				name: 'Capture',
				deviceId: scope.deviceId,
				localRootId: 'native-root',
				remoteFolderId: 'cloud-root'
			}),
			mode: 'backup' as const,
			paused: false
		}
	};
	let review: () => Promise<SyncConflictReviewResult> = async () => ({ action: 'retain' });
	const runtime = {
		currentScope: () => scope,
		origin: () => scope.origin,
		requireCapability: async () => {},
		fetch: async (input: any, init: any) => {
			const url = new URL(String(input)),
				body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
			if (url.origin === 'https://objects.test') {
				puts++;
				assert.deepEqual(init.body, data);
				return new Response(null);
			}
			assert.equal(init.headers['X-Thingtime-Expected-Actor'], scope.ownerId);
			assert.equal(init.headers['X-Thingtime-Expected-Data-Plane'], 'home');
			if (url.pathname === '/api/v1/files') {
				if (!body) {
					if (url.searchParams.has('operationId')) {
						const key = `${url.searchParams.get('kind') ?? 'commit'}:${url.searchParams.get('operationId')}`;
						return Response.json({ ok: true, receipt: receipts.has(key) ? { file: receipts.get(key)!.file } : null });
					}
					return Response.json({ ok: true, file: live });
				}
				const isRetention = body.kind === 'retained-version',
					key = `${body.kind ?? 'commit'}:${body.operationId}`,
					prior = receipts.get(key);
				if (prior) {
					assert.equal(prior.body, JSON.stringify(body));
					return Response.json({ ok: true, file: prior.file, replayed: true, ...(isRetention ? { retained: true } : {}) });
				}
				if (body.expectedRevision !== live.revision) return Response.json({ ok: false }, { status: 409 });
				const file = {
					...live,
					revision: await (isRetention ? fileRetentionEventId : fileCommitEventId)(scope.ownerId, live.id, body.operationId),
					content: { attachmentId: body.attachmentId, version: body.contentVersion, size: data.length, fingerprint }
				};
				receipts.set(key, { body: JSON.stringify(body), file });
				if (isRetention) retained++;
				else {
					publications++;
					live = file;
				}
				if (lost) {
					lost = false;
					throw Error('Accepted retention reply lost');
				}
				return Response.json({ ok: true, file, replayed: false, ...(isRetention ? { retained: true } : {}) });
			}
			if (url.pathname === '/api/v1/attachments/uploads') {
				uploads++;
				return Response.json({
					ok: true,
					upload: {
						id: 'upload-' + body.requestId,
						partSizeBytes: fingerprint.partSizeBytes,
						partCount: fingerprint.partCount,
						...(ready.has('upload-' + body.requestId) ? { state: 'ready' } : {})
					}
				});
			}
			if (url.pathname.endsWith('/parts'))
				return Response.json({
					ok: true,
					parts: [{ partNumber: 1, url: 'https://objects.test/part', headers: { 'x-amz-checksum-sha256': body.parts[0].checksumSha256 } }]
				});
			if (url.pathname.endsWith('/complete')) {
				ready.add(body.uploadId);
				return Response.json({ ok: true });
			}
			if (url.pathname.endsWith('/content'))
				return Response.json({ ok: true, id: url.searchParams.get('id'), version: 'c'.repeat(64), size: data.length, fingerprint });
			throw Error('Unexpected request');
		}
	};
	const input = () => ({
		currentScope: () => scope,
		readConfiguration: async () => ({
			id: saved.id,
			updatedAt: saved.updatedAt,
			author: { id: scope.ownerId },
			thingtime: ['file-sync'],
			acl: ['tt:user'],
			crystal: saved.configuration
		}),
		authorizeDevice: async () => {},
		conditions: async () => ({ network: 'wifi' as const, charging: true }),
		scanLocal: async () => {
			if (!localAvailable) throw Error('Device source unavailable');
			return [{ path: 'report.bin', id: 'native-file', version: localVersion, kind: 'file' as const, size: data.length, sha256: null, fingerprint }];
		},
		inventory: async () => ({
			version: 1 as const,
			complete: true as const,
			rootId: 'cloud-root',
			rootRevision: 'root-1',
			nodes: [{ kind: 'file' as const, path: 'report.bin', file: live }]
		}),
		source: async () => {
			sourceOpens++;
			if (!localAvailable) throw Error('Device source unavailable');
			return source();
		},
		journal,
		runtime,
		progress: () => {},
		reviewConflicts: async () => {
			reviews++;
			return review();
		}
	});
	return {
		saved,
		input,
		original,
		live: () => live,
		journal: () => journal, factory,
		counts: () => ({ sourceReads, sourceOpens, uploads, puts, retained, publications, reviews }),
		lose: () => {
			lost = true;
		},
		removeSource: () => {
			localAvailable = false;
		},
		review: (next: typeof review) => {
			review = next;
		},
		edit: () => {
			localVersion = 'local-2';
		},
		reload: async () => {
			journal.close();
			journal = await openSyncJournal(factory, 'thingtime-file-sync-v1', IDBKeyRange);
		}
	};
}
