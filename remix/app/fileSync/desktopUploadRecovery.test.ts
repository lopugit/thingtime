import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { openSyncJournal } from './journal.client';
import { newFileSyncConfiguration } from './configuration';
import { executeSyncOperation, type SyncRun, type SyncReceipt } from './execute';
import { SyncConnectionWait } from './syncConnectionWait';
import type { ForegroundSyncInput } from './foregroundSync';

// Isolate module mocks and browser globals from other file-sync tests. Only the
// paged planner/byte pipeline is replaced; discovery, admission, native host,
// task classification, durable operation execution and retry eligibility are real.
if (!process.execArgv.includes('--experimental-test-module-mocks')) {
	test('desktop upload retry reaches automatic saved-job discovery and preserves original operation', () => {
		const childEnvironment = { ...process.env };
		delete childEnvironment.NODE_TEST_CONTEXT;
		const result = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--import', 'tsx', '--test', fileURLToPath(import.meta.url)], {
			cwd: process.cwd(),
			encoding: 'utf8',
			timeout: 30_000,
			env: childEnvironment
		});
		assert.equal(result.status, 0, result.stdout + result.stderr);
		assert.match(result.stdout, /automatic discovery retries transient host upload failures/);
		assert.match(result.stdout, /(?:pass 1|# pass 1)/);
	});
} else {
	test('automatic discovery retries transient host upload failures using the original durable operation; terminal failures require review', async () => {
		const origin = 'https://upload-recovery.test',
			rootId = '00000000-0000-4000-8000-000000000001';
		const scope = { origin, ownerId: 'owner', dataPlane: 'home', deviceId: 'device', rootId: 'connection' };
		const entry = { path: 'file.bin', id: 'native-file', version: 'native-1', kind: 'file' as const, size: 3, sha256: 'a'.repeat(64) };
		const retry = '[folder_upload_retry] Folder upload is temporarily unavailable. Retry after reconnecting.';
		let journal!: Awaited<ReturnType<typeof openSyncJournal>>,
			receipt: SyncReceipt | null = null,
			failure: unknown;
		let runnerCalls = 0,
			publications = 0,
			runnerError: unknown;
		await (mock as any).module(new URL('./pagedForegroundSync.ts', import.meta.url).href, {
			namedExports: {
				runPagedForegroundCloudSync: async (_saved: unknown, binding: typeof scope, input: ForegroundSyncInput, signal: AbortSignal) => {
					runnerCalls++;
					const run = (await journal.read(binding))!;
					assert.ok(run, 'operation must already be durable before automatic discovery');
					const operation = run.operations[0];
					try {
						const confirmed = await executeSyncOperation(
							operation,
							binding,
							{
								currentScope: () => binding,
								lookup: async () => (receipt ? { status: 'complete', receipt } : { status: 'missing' }),
								read: async (side) => (side === 'local' ? entry : null),
								apply: async (op) => {
									const source = await input.source(entry);
									assert.ok(source.uploadPart, 'production desktop adapter must negotiate native upload parts');
									await source.uploadPart({ uploadId: 'upload-original', requestId: op.id, partNumber: 1, offset: 0, length: 3 }, signal);
									publications++;
									receipt = { operationId: op.id, scope: binding, entry: { ...entry, id: 'cloud-file', version: 'cloud-1' } };
									return receipt;
								}
							},
							signal
						);
						operation.confirmed = true;
						await journal.persist(run);
						assert.equal(confirmed.operationId, operation.id);
						input.progress({ stage: 'complete', confirmed: 1, total: 1 });
					} catch (error) {
						runnerError = error;
						throw error;
					}
				}
			}
		});
		const { resumeNativeSyncJobs } = await import('./NativeSyncBootstrap');
		const { nativeSyncTasks } = await import('./nativeSyncTasks.client');
		const { setDesktopSyncScheduled } = await import('./desktopSyncWindow.client');
		const globals = ['window', 'document', 'navigator', 'indexedDB', 'IDBKeyRange'] as const;
		const originals = new Map(globals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
		const install = (name: string, value: unknown) => Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
		try {
			for (const hostMessage of [
				retry,
				`Error invoking remote method 'thingtime-desktop:folder-sync': Error: ${retry}`,
				'Upload rejected (403)',
				'TLS certificate verification failed',
				'Source file changed.'
			]) {
				const transient = hostMessage.includes(retry),
					attempts: string[] = [];
				failure = Error(hostMessage);
				receipt = null;
				runnerCalls = publications = 0;
				runnerError = undefined;
				const bridge = {
					platform: 'darwin',
					folderSyncTaskVersion: '1.0.0',
					setFolderSyncActive: async () => {},
					folderSyncRequest: async (request: any) => {
						if (request.action === 'upload-part') {
							attempts.push(request.upload.requestId);
							if (failure) throw failure;
						}
						return {
							...request,
							origin,
							roots: [{ id: rootId, name: 'Fixture' }],
							capabilities: { fileAccessVersion: '1.11.0', fileUploadVersion: '1.0.0' },
							apiCapabilities: { schemaVersion: 1, origin, features: { 'api.things': { version: '1.38.0' } } },
							uploadedPart: request.upload ? { ...request.upload, version: entry.version, size: entry.size, sha256: 'b'.repeat(64) } : undefined
						};
					}
				};
				const window = Object.assign(new EventTarget(), { location: { origin }, thingtimeDesktop: bridge });
				install('window', window);
				install('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
				install('navigator', { locks: { request: async (_name: string, _options: unknown, work: () => Promise<unknown>) => work() } });
				install('indexedDB', new IDBFactory());
				install('IDBKeyRange', IDBKeyRange);
				journal = await openSyncJournal();
				const saved = {
					id: scope.rootId,
					updatedAt: '2026-10-20T00:00:00.000Z',
					configuration: {
						...newFileSyncConfiguration({ name: 'Fixture', deviceId: scope.deviceId, localRootId: rootId, remoteFolderId: 'cloud-root' }),
						mode: 'upload' as const,
						paused: false
					}
				};
				const jobs = journal.jobs({ scope, currentScope: () => scope });
				const admitted = await jobs.admit(saved, 'job-original', 60_000);
				const run: SyncRun = {
					version: 1,
					id: 'run-original',
					scope,
					operations: [
						{
							id: 'operation-original',
							confirmed: false,
							mutation: { kind: 'copy', from: 'local', path: entry.path, source: entry, expectedTarget: null }
						}
					]
				};
				await journal.persist(run);
				// These are the production coordinator's normal bounded discovery passes,
				// used by the shell's online/visibility/30s callbacks, not upload calls.
				await resumeNativeSyncJobs(scope.ownerId, 0, new AbortController().signal);
				assert.equal(runnerCalls, 1);
				assert.equal(runnerError instanceof SyncConnectionWait, transient);
				assert.equal(nativeSyncTasks.read()?.status, transient ? 'paused' : 'error');
				assert.equal(nativeSyncTasks.read()?.waiting, transient);
				assert.equal((await jobs.read())?.state, transient ? 'runnable' : 'attention');
				assert.equal((await journal.read(scope))?.operations[0].confirmed, false);
				failure = undefined;
				await resumeNativeSyncJobs(scope.ownerId, 0, new AbortController().signal);
				assert.equal(runnerCalls, transient ? 2 : 1);
				assert.equal(publications, transient ? 1 : 0);
				assert.deepEqual(attempts, transient ? ['operation-original', 'operation-original'] : ['operation-original']);
				assert.equal((await journal.read(scope))?.operations[0].confirmed, transient);
				assert.equal((await jobs.read())?.id, admitted.id);
				assert.equal((await jobs.read())?.state, transient ? 'scheduled' : 'attention');
				await resumeNativeSyncJobs(scope.ownerId, 0, new AbortController().signal);
				assert.equal(publications, transient ? 1 : 0, 'completed operation cannot upload twice');
				await setDesktopSyncScheduled(false, bridge as any);
				nativeSyncTasks.invalidate();
				journal.close();
			}
		} finally {
			nativeSyncTasks.invalidate();
			journal?.close();
			for (const [name, descriptor] of originals) {
				if (descriptor) Object.defineProperty(globalThis, name, descriptor);
				else Reflect.deleteProperty(globalThis, name);
			}
		}
	});
}
