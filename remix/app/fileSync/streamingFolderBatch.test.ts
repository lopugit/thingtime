import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { foregroundFixture, saved, scope } from './foregroundSync.fixture';
import { streamOneWayForegroundSync } from './streamingForegroundSync';
import { sameSyncStamp, type SyncEntry } from './reconcile';
import { attachmentIdForRequest } from '../api/utils/attachments/attachments';
import type { ForegroundSyncInput } from './foregroundSync';
const seed = JSON.parse(readFileSync(new URL('./fixtures/uploadBatchDigest.v1.json', import.meta.url), 'utf8')).vectors[0].descriptor.members[0].write
	.operation.mutation.source;
test('actual consumer converges changed parent and unchanged descendant after parked recovery restart and folder capability loss', async () => {
	const f = await foregroundFixture(),
		root: SyncEntry = { path: 'A', id: 'root-inode', kind: 'folder', version: 'v1', size: 0, sha256: null },
		child: SyncEntry = { ...root, path: 'A/B', id: 'child-inode' },
		file: SyncEntry = { ...seed, path: 'A/B/file', id: 'file-inode' };
	const local = new Map([
			[root.path, root],
			[child.path, child],
			[file.path, file]
		]),
		folders = new Map<string, any>(),
		files = new Map<string, any>(),
		seen = new Map<string, Set<string>>();
	let releaseFailure!: () => void;
	const failed = new Promise<void>((r) => (releaseFailure = r));
	let first = true,
		parked = false,
		sourceComplete = false;
	const oldIDs = new Map<string, string>();
	const row = (write: any) => ({
		id: write.operation.id,
		name: write.operation.mutation.path.split('/').at(-1),
		folderId: write.folderId,
		revision: 'r1'
	});
	const node = (path: string): any => {
		const folder = [...folders.values()].find((v) => v.path === path);
		if (folder) return { kind: 'folder', path, id: folder.id, folderId: folder.folderId, revision: folder.revision };
		const value = [...files.values()].find((v) => v.path === path);
		return value ? { kind: 'file', path, file: value } : null;
	};
	const fetch = async (url: any, init: any = {}) => {
		const u = new URL(String(url)),
			body = init.body ? JSON.parse(String(init.body)) : undefined;
		if (body?.phase === 'observe')
			return Response.json({
				ok: true,
				version: 1,
				observations: body.paths.map((path: string) => ({ path, node: node(path), parent: node(path.split('/').slice(0, -1).join('/')) }))
			});
		if (body?.phase === 'folder-probe' || body?.phase === 'folder-commit') {
			const results = (body.ordinals ?? body.descriptor.members.map((m: any) => m.ordinal)).map((ordinal: number) => {
				const m = body.descriptor.members[ordinal],
					w = m.write,
					old = folders.get(w.operation.id);
				if (old) return { ordinal, status: 'confirmed', folder: old, replayed: true };
				if (body.phase === 'folder-probe') return { ordinal, status: 'source-required' };
				assert.equal(m.parent.kind === 'root' || folders.has(w.folderId), true);
				const folder = { ...row(w), path: w.operation.mutation.path };
				folders.set(folder.id, folder);
				return { ordinal, status: 'confirmed', folder, replayed: false };
			});
			return Response.json({
				ok: true,
				version: 1,
				batchId: body.descriptor.batchId,
				digest: body.digest,
				results: results.map((r: any) =>
					r.folder ? { ...r, folder: { id: r.folder.id, name: r.folder.name, folderId: r.folder.folderId, revision: r.folder.revision } } : r
				)
			});
		}
		if (body?.phase === 'commit') {
			const results = body.contents.map((c: any) => {
				const w = body.descriptor.members[c.ordinal].write;
				assert.ok(folders.has(w.folderId));
				const value = {
					id: w.operation.id,
					name: w.operation.mutation.path.split('/').at(-1),
					folderId: w.folderId,
					revision: 'f1',
					trashed: false,
					content: { attachmentId: c.uploadId, version: c.version, size: c.size, fingerprint: c.fingerprint },
					path: w.operation.mutation.path
				};
				files.set(value.id, value);
				return { ordinal: c.ordinal, status: 'confirmed', file: { ...value, path: undefined }, replayed: false };
			});
			return Response.json({ ok: true, version: 1, batchId: body.descriptor.batchId, digest: body.digest, results });
		}
		if (body?.kind === 'folder') {
			assert.ok(body.folderId === saved.configuration.remoteFolderId || folders.has(body.folderId));
			const old = folders.get(body.id),
				folder = old ?? { id: body.id, name: body.name, folderId: body.folderId, revision: 'r1', path: body.name === 'A' ? 'A' : 'A/B' };
			folders.set(folder.id, folder);
			return Response.json({
				ok: true,
				folder: { id: folder.id, name: folder.name, folderId: folder.folderId, revision: folder.revision },
				replayed: !!old
			});
		}
		if (u.searchParams.has('rootId')) {
			const path = u.searchParams.get('path')!,
				n = node(path);
			return Response.json({
				ok: true,
				observation: {
					version: 1,
					complete: true,
					rootId: saved.configuration.remoteFolderId,
					rootRevision: 'r1',
					path,
					entry: n ? { path, id: n.id ?? n.file.id, version: n.revision ?? n.file.revision, kind: n.kind, size: 0, sha256: null } : null
				}
			});
		}
		if (u.searchParams.has('folderId')) {
			const id = u.searchParams.get('folderId')!,
				folder = folders.get(id);
			if (!u.searchParams.has('operationId'))
				return folder
					? Response.json({ ok: true, folder: { id: folder.id, name: folder.name, folderId: folder.folderId, revision: folder.revision } })
					: Response.json({ ok: false }, { status: 404 });
			return Response.json({
				ok: true,
				receipt: folder ? { id: folder.id, name: folder.name, folderId: folder.folderId, revision: folder.revision } : null
			});
		}
		if (u.searchParams.has('operationId')) return Response.json({ ok: true, receipt: null });
		throw Error('Unexpected scalar effect in folder recovery regression');
	};
	let terminalState: { confirmed: number; operations: number; sequence: number } | undefined;
	let supportsFolders = true;
	let reservationHeld = false;
	let controller = new AbortController();
	const deadline = setTimeout(() => controller.abort(Error('Recovery regression deadline')), 15000);
	const input = (): ForegroundSyncInput => {
		const base = f.input(),
			journal = f.journal();
		return {
			...base,
			journal: {
				...journal,
				pagedRuns: (access: any) => {
					const runs = journal.pagedRuns(access);
					return {
						...runs,
						finishStream: async (...args: Parameters<typeof runs.finishStream>) => {
							const active = (await runs.active())!;
							const state = await runs.streamState(active.spec);
							terminalState = { confirmed: active.progress.confirmed, operations: active.progress.operations, sequence: state.sequence };
							return runs.finishStream(...args);
						},
						claimTransferBatch: async (...args: Parameters<typeof runs.claimTransferBatch>) => {
							if (!reservationHeld) {
								reservationHeld = true;
								for (;;) {
									access.signal?.throwIfAborted();
									if ((await runs.active())!.progress.operations === 3) break;
									await new Promise((r) => setTimeout(r, 0));
								}
							}
							return runs.claimTransferBatch(...args);
						},
						deferTargetRebind: async (...args: Parameters<typeof runs.deferTargetRebind>) => {
							await runs.deferTargetRebind(...args);
							if (!parked) {
								parked = true;
								controller.abort(Error('Controlled restart after durable dependency release'));
							}
						}
					};
				}
			},
			nativeOperationGuards: true,
			authorizeContext: async () => ({ network: 'wifi', charging: true }),
			inspectLocal: async (path) => local.get(path) ?? null,
			runtime: { ...base.runtime, fetch },
			folderBatch: supportsFolders
				? async (input) => {
						for (const m of input.descriptor.members) {
							let ids = seen.get(m.write.operation.mutation.path);
							if (!ids) seen.set(m.write.operation.mutation.path, (ids = new Set()));
							ids.add(m.write.operation.id);
							oldIDs.set(m.write.operation.mutation.path, oldIDs.get(m.write.operation.mutation.path) ?? m.write.operation.id);
						}
						if (first) {
							first = false;
							for (let i = 0; i < 100; i++) {
								const active = await journal.pagedRuns({ scope, currentScope: () => scope }).active();
								if (active!.progress.operations >= 3) break;
								await new Promise((r) => setTimeout(r, 0));
							}
							local.set(root.path, { ...root, version: 'v2' });
							releaseFailure();
						}
						return {
							ok: true,
							version: 1,
							batchId: input.descriptor.batchId,
							digest: input.digest,
							results: input.ordinals.map((ordinal) => {
								const source = input.descriptor.members[ordinal].write.operation.mutation;
								if (source.kind !== 'copy') throw Error('copy');
								return sameSyncStamp(local.get(source.path), source.source)
									? { ordinal, status: 'validated' as const }
									: { ordinal, status: 'failed' as const, code: 'source-changed' as const, retryable: false as const };
							})
						};
				  }
				: undefined,
			uploadBatch: async (input) => ({
				ok: true,
				version: 1,
				batchId: input.descriptor.batchId,
				digest: input.digest,
				results: input.descriptor.members.map(({ ordinal, write }) => {
					assert.equal(write.operation.mutation.kind, 'copy');
					if (write.operation.mutation.kind !== 'copy') throw Error('copy');
					assert.ok(sameSyncStamp(local.get(write.operation.mutation.path), write.operation.mutation.source));
					return {
						ordinal,
						status: 'verified',
						content: {
							ordinal,
							uploadId: attachmentIdForRequest(scope.ownerId, write.operation.id),
							version: 'b'.repeat(64),
							size: file.size,
							fingerprint: file.fingerprint!
						}
					};
				}),
				payloads: input.descriptor.members.map(({ ordinal }) => ({ ordinal, bytes: file.size }))
			}),
			streamLocalChanges: async function* (id, after, signal) {
				if (after < 3)
					yield {
						id,
						generation: id,
						state: 'running',
						revision: 3,
						nextSequence: 3,
						hasMore: false,
						changes: [root, child, file].map((entry, i) => ({ sequence: i + 1, revision: entry.version, entry }))
					};
				await failed;
				if (after < 4)
					yield {
						id,
						generation: id,
						state: 'running',
						revision: 4,
						nextSequence: 4,
						hasMore: false,
						changes: [{ sequence: 4, revision: 'v2', entry: local.get(root.path)! }]
					};
				// Keep producer live until all three canonical receipts, exercising drain.
				while (folders.size + files.size < 3) {
					signal.throwIfAborted();
					await new Promise((r) => setTimeout(r, 1));
				}
				sourceComplete = true;
				yield { id, generation: id, state: 'complete', revision: 4, nextSequence: 4, hasMore: false, changes: [] };
			}
		};
	};
	try {
		await assert.rejects(streamOneWayForegroundSync(saved, scope, input(), controller.signal), /Controlled restart/);
		assert.equal(parked, true);
		assert.equal(files.size, 0);
		assert.equal(folders.size, 0);
		await f.reload();
		controller = new AbortController();
		supportsFolders = false;
		await streamOneWayForegroundSync(saved, scope, input(), controller.signal);
		assert.deepEqual(terminalState, { confirmed: 3, operations: 3, sequence: 4 });
		assert.equal(folders.size, 2);
		assert.equal(files.size, 1);
		assert.equal(sourceComplete, true);
		assert.ok([...folders.values()].every((v) => v.id !== oldIDs.get(v.path)));
		assert.equal([...files.values()][0].folderId, [...folders.values()].find((v) => v.path === child.path).id);
	} finally {
		clearTimeout(deadline);
		controller.abort();
		f.journal().close();
	}
});
