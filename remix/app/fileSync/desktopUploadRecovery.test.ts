import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { openSyncJournal } from './journal.client';
import { newFileSyncConfiguration } from './configuration';
import { executeSyncOperation, type SyncRun, type SyncReceipt } from './execute';
import { cloudRequests } from './cloudTransport';
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
		let cloudStatus: number | undefined;
		let attempts: string[] = [];
		let now = Date.UTC(2026, 9, 20);
		const clock = mock.method(Date, 'now', () => now);
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
								lookup: async () => {
									const known = cloudStatus
										? (await cloudRequests(input.runtime, binding, signal).json('/api/v1/files?operationId=' + operation.id)).receipt
										: receipt;
									return known ? { status: 'complete', receipt: known } : { status: 'missing' };
								},
								read: async (side) => (side === 'local' ? entry : null),
								apply: async (op) => {
									if (cloudStatus) return (await cloudRequests(input.runtime, binding, signal).json('/api/v1/files', { operationId: op.id })).receipt;
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
			const enteredHttp = new Set<number>();
			for (const scenario of [
				{ message: retry },
				{ message: `Error invoking remote method 'thingtime-desktop:folder-sync': Error: ${retry}` },
				{ message: 'Upload rejected (403)' },
				{ message: 'TLS certificate verification failed' },
				{ message: 'Source file changed.' },
				{ status: 503 },
				{ status: 401 },
				{ status: 403 }
			]) {
				cloudStatus = scenario.status;
				attempts = [];
				const transient = cloudStatus === 503 || !!scenario.message?.includes(retry);
				failure = Error(scenario.message ?? 'fixture HTTP failure');
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
				const window = Object.assign(new EventTarget(), {
					location: { origin },
					thingtimeDesktop: bridge,
					fetch: async (_target: unknown, init?: RequestInit) => {
						if (init?.method !== 'POST') return Response.json({ ok: true, receipt });
						const body = JSON.parse(init.body as string);
						assert.ok(cloudStatus);
						enteredHttp.add(cloudStatus);
						attempts.push(body.operationId);
						if (cloudStatus === 503 || !failure) {
							if (!receipt) publications++;
							receipt = { operationId: body.operationId, scope, entry: { ...entry, id: 'cloud-file', version: 'cloud-1' } };
						}
						return failure
							? Response.json({ ok: false }, { status: cloudStatus, headers: { 'Retry-After': '120' } })
							: Response.json({ ok: true, receipt });
					}
				});
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
				let jobs = journal.jobs({ scope, currentScope: () => scope });
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
				const waitingJob = await jobs.read();
				if (transient) assert.equal(waitingJob?.retryAt, now + (cloudStatus ? 120_000 : 30_000));
				failure = undefined;
				for (const wake of ['online', 'pageshow', 'job-event']) {
					await resumeNativeSyncJobs(scope.ownerId, 0, new AbortController().signal);
					assert.equal(runnerCalls, 1, `${wake} cannot bypass durable backoff`);
				}
				journal.close();
				journal = await openSyncJournal();
				jobs = journal.jobs({ scope, currentScope: () => scope });
				if (transient) assert.equal((await journal.jobs({ scope, currentScope: () => scope }).read())?.retryAt, waitingJob!.retryAt);
				now = (waitingJob?.retryAt ?? now) + 1;
				await resumeNativeSyncJobs(scope.ownerId, 0, new AbortController().signal);
				assert.equal(runnerCalls, transient ? 2 : 1);
				assert.equal(publications, transient ? 1 : 0);
				assert.deepEqual(attempts, transient && !cloudStatus ? ['operation-original', 'operation-original'] : ['operation-original']);
				assert.equal((await journal.read(scope))?.operations[0].confirmed, transient);
				assert.equal((await jobs.read())?.id, admitted.id);
				assert.equal((await jobs.read())?.state, transient ? 'scheduled' : 'attention');
				await resumeNativeSyncJobs(scope.ownerId, 0, new AbortController().signal);
				assert.equal(publications, transient ? 1 : 0, 'completed operation cannot upload twice');
				await setDesktopSyncScheduled(false, bridge as any);
				nativeSyncTasks.invalidate();
				journal.close();
			}
			assert.deepEqual([...enteredHttp].sort(), [401, 403, 503], 'all real HTTP coordinator scenarios must execute');
		} finally {
			nativeSyncTasks.invalidate();
			clock.mock.restore();
			journal?.close();
			for (const [name, descriptor] of originals) {
				if (descriptor) Object.defineProperty(globalThis, name, descriptor);
				else Reflect.deleteProperty(globalThis, name);
			}
		}
	});
}
