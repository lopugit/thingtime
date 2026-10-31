import assert from 'node:assert/strict';
import { foregroundFixture, scope } from './foregroundSync.fixture';
import { fingerprintSource, type FingerprintSource } from './contentFingerprint';
import { cloudFileSyncEntry, type CloudFile } from './cloudFile';
import type { ForegroundSyncInput } from './foregroundSync';

/** A real byte path through multipart upload and guarded publication, with an
 * independent object-store byte map for streaming orchestration regressions. */
const json = (value: object, init?: ResponseInit) => Response.json({ ok: true, ...value }, init);
export async function streamingFileFixture() {
	const base = await foregroundFixture(),
		files = new Map<string, CloudFile>(),
		receipts = new Map<string, CloudFile>(),
		objects = new Map<string, Uint8Array>();
	let bytes = new Uint8Array([1, 2, 3]),
		version = 1,
		publications = 0,
		puts = 0;
	const fingerprint = async (value: Uint8Array) =>
		fingerprintSource({
			size: value.length,
			check() {},
			async read(offset, length) {
				return new Uint8Array(value.slice(offset, offset + length));
			}
		});
	let entry = {
		path: 'first.bin',
		id: 'native-file',
		version: String(version),
		kind: 'file' as const,
		size: bytes.length,
		sha256: null,
		fingerprint: await fingerprint(bytes)
	};
	const input: ForegroundSyncInput = base.input();
	input.inspectLocal = async (path) => (path === entry.path ? structuredClone(entry) : null);
	input.scanLocal = async () => [structuredClone(entry)];
	input.source = async (expected) => {
		const sourceVersion = entry.version;
		const source: FingerprintSource = {
			size: bytes.length,
			check() {
				assert.equal(entry.version, sourceVersion);
			},
			async read(offset, length) {
				return new Uint8Array(bytes.slice(offset, offset + length));
			}
		};
		assert.equal(expected.version, sourceVersion);
		return source;
	};
	input.runtime = {
		...input.runtime,
		fetch: async (target, init) => {
			const url = new URL(String(target)),
				body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
			if (url.origin === 'https://objects.test') {
				puts++;
				objects.set(url.pathname.slice(1), new Uint8Array(init!.body as Uint8Array));
				return new Response(null);
			}
			if (url.pathname === '/api/v1/files') {
				if (body) {
					const old = receipts.get(body.operationId);
					if (old) return json({ file: old, replayed: true });
					const current = files.get(body.id);
					assert.equal(body.expectedRevision, current?.revision ?? null);
					const data = objects.get(body.attachmentId)!;
					const file: CloudFile = {
						id: body.id,
						revision: 'revision-' + ++publications,
						name: body.name,
						folderId: body.folderId,
						trashed: false,
						content: { attachmentId: body.attachmentId, version: body.contentVersion, size: data.length, fingerprint: await fingerprint(data) }
					};
					files.set(file.id, file);
					receipts.set(body.operationId, file);
					return json({ file, replayed: false });
				}
				if (url.searchParams.has('rootId')) {
					const path = url.searchParams.get('path')!,
						file = [...files.values()].find((f) => f.name === path);
					return json({
						observation: {
							version: 1,
							complete: true,
							rootId: 'cloud-root',
							rootRevision: 'root',
							path,
							entry: file ? cloudFileSyncEntry(file, path) : null
						}
					});
				}
				if (url.searchParams.has('operationId')) {
					const file = receipts.get(url.searchParams.get('operationId')!);
					return json({ receipt: file ? { file } : null });
				}
				const file = files.get(url.searchParams.get('id')!);
				return file ? json({ file }) : json({}, { status: 404 });
			}
			if (url.pathname.endsWith('/uploads'))
				return json({
					upload: { id: 'upload-' + body.requestId, partSizeBytes: entry.fingerprint.partSizeBytes, partCount: entry.fingerprint.partCount }
				});
			if (url.pathname.endsWith('/parts'))
				return json({
					parts: [{ partNumber: 1, url: 'https://objects.test/' + body.uploadId, headers: { 'x-amz-checksum-sha256': body.parts[0].checksumSha256 } }]
				});
			if (url.pathname.endsWith('/complete')) return json({ ok: true });
			if (url.pathname.endsWith('/content') && url.searchParams.has('range')) {
				const id = url.searchParams.get('id')!,
					data = objects.get(id)!,
					offset = Number(url.searchParams.get('offset')),
					length = Number(url.searchParams.get('length'));
				return new Response(new Uint8Array(data.slice(offset, offset + length)), {
					status: 206,
					headers: {
						ETag: '"' + url.searchParams.get('version') + '"',
						'Content-Range': `bytes ${offset}-${offset + length - 1}/${data.length}`,
						'Content-Length': String(length),
						'Content-Type': 'application/octet-stream'
					}
				});
			}
			if (url.pathname.endsWith('/content')) {
				const id = url.searchParams.get('id')!,
					data = objects.get(id)!;
				return json({ id, version: 'a'.repeat(64), size: data.length, fingerprint: await fingerprint(data) });
			}
			throw Error('Unexpected file fixture request: ' + url.pathname);
		}
	};
	return {
		input,
		scope,
		journal: base.journal,
		entry: () => structuredClone(entry),
		files,
		objects,
		publications: () => publications,
		puts: () => puts,
		async revise(value: number[], revision?: string) {
			bytes = new Uint8Array(value);
			entry = { ...entry, version: revision ?? String(++version), size: bytes.length, fingerprint: await fingerprint(bytes) };
		}
	};
}
