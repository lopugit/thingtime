import { SYNC_RETRY_DELAY_MS, SYNC_RETRY_MAX_MS } from './syncConnectionWait';
import { isSyncJobFailure, syncJobFailure, SyncJobConfigurationChanged, type SyncJobFailure } from './syncJobFailure';
import { PHOTO_AUTOMATION_INTERVAL_MS, parseFileSyncConfiguration } from './configuration';
import { PHOTO_SETTINGS_STORES, parkPhotoSettings, type PreviousPhotoSettings } from './photoSettingsJournal';
import { photoSettingsChanged, samePhotoBackupSource } from './photoSettingsPolicy';
import { isSyncWaitReason, type SyncWaitReason } from './foregroundSyncContext';
import type { SavedFileSyncConfiguration } from './configuredPlan';
import { journalScope, type JournalAccess } from './journalScope';
import { syncScopeKey, type SyncScope } from './reconcile';
import { INVENTORY_PIN_STORE, inventoryIdentity, type InventoryIdentity } from './inventoryJournal';

const STORE = 'sync-admitted-jobs';
export const SYNC_JOB_PAGE_SIZE = 32;
export const MAX_SYNC_JOBS_PER_ACCOUNT = 256;
export const SYNC_INTERVALS = [60_000, 300_000, 900_000, 3_600_000] as const;
export const SYNC_JOBS_CHANGED_EVENT = 'tt:sync-jobs-changed';
export type SyncJob = {
	version: 1; key: string; id: string; revision: number;
	scope: SyncScope; reviewed: SavedFileSyncConfiguration;
	state: 'runnable' | 'scheduled' | 'paused' | 'attention' | 'complete';
	/** Absent on one-shot admissions. */
	intervalMs?: number;
	/** Save & Sync while the native lane was busy. No scan, transfer or
	 * write approval is authorized until current native validation succeeds. */
	pendingFolderValidation?: true;
	/** A user paused a saved folder before its next admission. */
	folderSetupPaused?: true;
	/** Fixed allowlisted diagnostic only; legacy jobs have no recorded reason. */
	failureReason?: SyncJobFailure;
	nextRunAt?: number;
	/** Durable not-before time for an unfinished transiently interrupted attempt. */
	retryAt?: number;
	waitReason?: SyncWaitReason;
	minimumPartBytes?: number;
	/** Revision whose automatic recovery requires attention. */
	automaticPhotoRevision?: string;
	/** Bound by this job's full scope and immutable reviewed revision/settings. */
	nativeCaptureId?: string;
	/** Retained until exact native cleanup is confirmed, including after Stop. */
	strictCaptureId?: string;
	/** At most one fresh strict scan for an otherwise unclassified interruption. */
	strictCaptureRetries?: 1;
	nativeCaptureGeneration?: string;
	nativeCaptureRestarts?: number;
	/** One resumable ordering pass over the current authorized Photos membership. */
	photoQueueEpoch?: string;
	/** A committed import prefix belongs to this exact admission and purpose. */
	localImport?: { purpose: 'initial' | 'review'; inventory: InventoryIdentity };
};
export const syncJobCanPause = (job: SyncJob | null) => !!job && ['runnable', 'scheduled', 'attention'].includes(job.state);
export const syncJobEnabled = (job: SyncJob) => job.intervalMs !== undefined && ['runnable', 'scheduled'].includes(job.state);
export const syncJobDue = (job: SyncJob, now: number, wakeConditions = false) => {
	const canWake = wakeConditions && job.waitReason !== undefined && !['paused', 'data-budget'].includes(job.waitReason);
	return Number.isSafeInteger(now) && (job.state === 'runnable' || job.state === 'scheduled') &&
		(job.retryAt === undefined || now >= job.retryAt || canWake) &&
		(job.state === 'runnable' || now >= job.nextRunAt!);
};

/** Stop the admitted cycle even when completion just scheduled its next run.
 * A newer cycle/admission has a different ID and cannot be stopped by this
 * stale task callback. Every attempt still uses the journal's revision CAS. */
export async function pauseSyncJobAdmission(jobs: Pick<ReturnType<typeof syncJobJournal>, 'read' | 'pause'>, id: string) {
	for (let attempt = 0; attempt < 3; attempt++) {
		const current = await jobs.read();
		if (!current || current.id !== id || ['paused', 'complete'].includes(current.state)) return;
		if (await jobs.pause(current)) return;
	}
	throw Error('The sync job changed while stopping. Please retry.');
}
/** A lost cleanup reply cannot authorize replacing the native capture ID. */
export async function retireStrictCapture(
	jobs: Pick<ReturnType<typeof syncJobJournal>, 'strictCapture'>,
	job: SyncJob,
	cancel: (job: SyncJob) => Promise<void>,
) {
	if (!job.strictCaptureId) return job;
	await cancel(job);
	return jobs.strictCapture(job, null);
}

export function upgradeSyncJobJournal(db: IDBDatabase) {
	if (!db.objectStoreNames.contains(STORE)) {
		const store = db.createObjectStore(STORE, { keyPath: 'key' });
		store.createIndex('account', ['scope.ownerId', 'key'], { unique: true });
	}
}
function canonical(saved: SavedFileSyncConfiguration, scope: SyncScope): SavedFileSyncConfiguration {
	if (!saved || saved.id !== scope.rootId || typeof saved.updatedAt !== 'string' || !Number.isFinite(Date.parse(saved.updatedAt)))
		throw Error('The admitted sync connection changed.');
	const configuration = parseFileSyncConfiguration(saved.configuration);
	if (scope.dataPlane !== 'home' || configuration.deviceId !== scope.deviceId) throw Error('The admitted sync device changed.');
	return { id: saved.id, updatedAt: saved.updatedAt, configuration };
}
function validate(value: SyncJob): SyncJob {
	if (!value || value.version !== 1 || value.key !== syncScopeKey(value.scope) ||
		!Number.isSafeInteger(value.revision) || value.revision < 1 ||
		!['runnable', 'scheduled', 'paused', 'attention', 'complete'].includes(value.state) ||
		(value.folderSetupPaused !== undefined && (value.folderSetupPaused !== true || value.state !== 'paused' || value.reviewed?.configuration.sourceKind === 'photos')) ||
		(value.failureReason !== undefined && !isSyncJobFailure(value.failureReason)) ||
		(value.intervalMs !== undefined && !SYNC_INTERVALS.some(interval => interval === value.intervalMs)) ||
		(value.pendingFolderValidation !== undefined && (value.pendingFolderValidation !== true || value.intervalMs === undefined ||
			value.reviewed?.configuration.sourceKind === 'photos' || value.reviewed?.configuration.paused || value.state === 'complete' || value.state === 'scheduled')) ||
		(value.nextRunAt !== undefined && (!Number.isSafeInteger(value.nextRunAt) || value.nextRunAt < 0 || !['scheduled', 'paused', 'attention'].includes(value.state))) ||
		(value.state === 'scheduled' && (value.intervalMs === undefined || value.nextRunAt === undefined)) ||
		(value.minimumPartBytes !== undefined && (value.waitReason !== 'data-budget' || !Number.isSafeInteger(value.minimumPartBytes) || value.minimumPartBytes < 1)) ||
		(value.waitReason !== undefined && (!isSyncWaitReason(value.waitReason) || value.retryAt === undefined)) ||
		(value.automaticPhotoRevision !== undefined && (typeof value.automaticPhotoRevision !== 'string' || !Number.isFinite(Date.parse(value.automaticPhotoRevision)))) ||
		(value.strictCaptureRetries !== undefined && value.strictCaptureRetries !== 1) ||
		(value.retryAt !== undefined && (!Number.isSafeInteger(value.retryAt) || value.retryAt < 0)) ||
		(value.nativeCaptureId !== undefined && (typeof value.nativeCaptureId !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value.nativeCaptureId) || value.reviewed?.configuration.mode !== 'backup' || value.reviewed?.configuration.propagateDeletes !== false)) ||
		(value.strictCaptureId !== undefined && (value.nativeCaptureId !== undefined || typeof value.strictCaptureId !== 'string' ||
			!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value.strictCaptureId))) ||
		(value.nativeCaptureGeneration !== undefined && (!value.nativeCaptureId || typeof value.nativeCaptureGeneration !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value.nativeCaptureGeneration))) ||
		(value.nativeCaptureRestarts !== undefined && (!value.nativeCaptureGeneration || !Number.isSafeInteger(value.nativeCaptureRestarts) || value.nativeCaptureRestarts < 0 || value.nativeCaptureRestarts > 1)) ||
		(value.photoQueueEpoch !== undefined && (typeof value.photoQueueEpoch !== 'string' ||
			!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value.photoQueueEpoch) ||
			value.reviewed?.configuration.sourceKind !== 'photos' || value.reviewed?.configuration.mode !== 'backup')) ||
		typeof value.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value.id) ||
		JSON.stringify(canonical(value.reviewed, value.scope)) !== JSON.stringify(value.reviewed))
		throw Error('Invalid saved sync job.');
	if (value.localImport !== undefined && (!value.localImport || !['initial', 'review'].includes(value.localImport.purpose) ||
		inventoryIdentity(value.localImport.inventory).source !== 'local' || value.reviewed.configuration.mode !== 'backup' || value.reviewed.configuration.propagateDeletes))
		throw Error('Invalid saved local import.');
	return value;
}

/** Explicit execution admission, not file history or native permission.
 * One bounded record per connection. All IO still rechecks the live account,
 * configuration and native grants. Call admission/resume under the root lock. */
export function syncJobJournal(db: IDBDatabase, access: JournalAccess, keyRange?: typeof IDBKeyRange) {
	const bound = journalScope(db, access, keyRange), ranges = keyRange ?? globalThis.IDBKeyRange;
	const accountRange = (after?: string) => ranges.bound([bound.scope.ownerId, ...(after ? [after] : [])], [bound.scope.ownerId, []], !!after);
	const read = () => bound.transaction<SyncJob | null>([STORE], 'readonly', (tx, done, fail) => {
		const request = tx.objectStore(STORE).get(bound.key);
		request.onsuccess = () => { try { done(request.result ? validate(request.result) : null); } catch (error) { fail(error); } };
	});
	const changed = <T>(value: T) => {
		if (typeof window !== 'undefined') window.dispatchEvent(new Event(SYNC_JOBS_CHANGED_EVENT));
		return value;
	};
	const pinImport = (tx: IDBTransaction, previous: SyncJob | null, next: SyncJob) => {
		const old = previous?.localImport?.inventory, current = next.localImport?.inventory;
		if (old && old.id !== current?.id) tx.objectStore(INVENTORY_PIN_STORE).delete([bound.key, old.id, 'admitted-import']);
		if (current) tx.objectStore(INVENTORY_PIN_STORE).put(true, [bound.key, current.id, 'admitted-import']);
	};
	const change = (expected: SyncJob, update: (current: SyncJob) => SyncJob | null) =>
		bound.transaction<SyncJob | null>([STORE, INVENTORY_PIN_STORE], 'readwrite', (tx, done, fail) => {
			validate(expected);
			if (expected.key !== bound.key) throw Error('Sync job scope changed.');
			const store = tx.objectStore(STORE), request = store.get(bound.key);
			request.onsuccess = () => {
				try {
					const current = request.result ? validate(request.result) : null;
					if (!current || current.id !== expected.id || current.revision !== expected.revision) { done(null); return; }
					const next = update(current);
					if (next) { validate(next); pinImport(tx, current, next); store.put(validate({ ...next, revision: current.revision + 1 })); }
					done(next ? { ...next, revision: current.revision + 1 } : null);
				} catch (error) { fail(error); }
			};
		}).then(value => value ? changed(value) : value);
	return {
		read,
		/** This attempt may defer only its own unchanged runnable admission. Stop,
		 * reapproval and a newer attempt all win through the existing revision CAS. */
		defer: (expected: SyncJob, now: number, delay = SYNC_RETRY_DELAY_MS, wait?: { reason: SyncWaitReason; retryAt?: number; minimumPartBytes?: number }, automaticPhoto = false) => change(expected, current => {
			if (!Number.isSafeInteger(now) || now < 0 || !Number.isFinite(delay)) throw Error('Invalid sync retry deadline.');
			if (!['runnable', 'scheduled'].includes(current.state) && !(automaticPhoto && current.state === 'attention')) return null;
			const cadence = automaticPhoto ? PHOTO_AUTOMATION_INTERVAL_MS : Math.round(Math.max(SYNC_RETRY_DELAY_MS, Math.min(SYNC_RETRY_MAX_MS, delay)));
			const retryAt = Math.max(now + cadence, wait?.retryAt ?? 0);
			if (!Number.isSafeInteger(retryAt)) throw Error('Invalid sync retry deadline.');
			const { waitReason: _wait, minimumPartBytes: _part, ...rest } = current;
			return { ...rest, retryAt, ...(wait ? { waitReason: wait.reason } : {}), ...(wait?.minimumPartBytes !== undefined ? { minimumPartBytes: wait.minimumPartBytes } : {}) };
		}),
  retryStrictCapture: (expected: SyncJob, now: number) => change(expected, current => {
   if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(now + SYNC_RETRY_DELAY_MS)) throw Error('Invalid sync retry deadline.');
   if (current.state !== 'runnable' || current.strictCaptureRetries) return null;
   const { waitReason: _wait, minimumPartBytes: _part, ...rest } = current;
   return { ...rest, strictCaptureRetries: 1, retryAt: now + SYNC_RETRY_DELAY_MS };
  }),
		photoQueue: (expected: SyncJob, epoch: string | null) => change(expected, current => {
			if (current.state !== 'runnable' || current.reviewed.configuration.sourceKind !== 'photos') return null;
			const { photoQueueEpoch: _old, ...rest } = current;
			return epoch === null ? rest : { ...rest, photoQueueEpoch: epoch };
		}),
		beginImport: (expected: SyncJob, purpose: 'initial' | 'review', inventory: InventoryIdentity) => change(expected, current => {
			if (current.state !== 'runnable') return null;
			if (current.localImport?.purpose === purpose) return current;
			if (current.localImport) throw Error('The previous local import has not been handed off.');
			return { ...current, localImport: { purpose, inventory: inventoryIdentity(inventory) } };
		}),
		finishImport: (expected: SyncJob, inventory: InventoryIdentity) => change(expected, current => {
			if (current.state !== 'runnable' || JSON.stringify(current.localImport?.inventory) !== JSON.stringify(inventoryIdentity(inventory))) return null;
			const { localImport: _import, nativeCaptureId: _capture, nativeCaptureGeneration: _generation, nativeCaptureRestarts: _restarts, ...rest } = current;
			return rest;
		}),
		capture: (expected: SyncJob, id: string | null) => change(expected, current => {
			if (id !== null && current.state !== 'runnable') return null;
			const { nativeCaptureId: _old, nativeCaptureGeneration: _generation, nativeCaptureRestarts: _restarts, ...rest } = current;
			return { ...rest, ...(id === null ? {} : { nativeCaptureId: id }) };
		}),
		strictCapture: (expected: SyncJob, id: string | null) => change(expected, current => {
			if (id !== null && (current.state !== 'runnable' || current.strictCaptureId !== undefined)) return null;
			const { strictCaptureId: _old, ...rest } = current;
			return id === null ? rest : { ...rest, strictCaptureId: id };
		}),
		observeCapture: (expected: SyncJob, generation: string) => change(expected, current => {
			if (current.state !== 'runnable' || !current.nativeCaptureId) return null;
			const restarts = (current.nativeCaptureRestarts ?? 0) + (current.nativeCaptureGeneration && current.nativeCaptureGeneration !== generation ? 1 : 0);
			if (restarts > 1) throw Error('Backup indexing was repeatedly interrupted. Check folder access and local storage before retrying.');
			const { localImport, ...rest } = current;
			return { ...rest, ...(localImport && (!current.nativeCaptureGeneration || current.nativeCaptureGeneration === generation) ? { localImport } : {}),
				nativeCaptureGeneration: generation, nativeCaptureRestarts: restarts };
		}),
		/** Discovery is account-scoped across origins/devices. Each candidate is
		 * independently checked against the native selected origin before IO. */
		list: (after?: string) => bound.transaction<{ jobs: SyncJob[]; next?: string }>([STORE], 'readonly', (tx, done, fail) => {
			if (after !== undefined && (typeof after !== 'string' || after.length > 4096)) throw Error('Invalid sync job cursor.');
			const request = tx.objectStore(STORE).index('account').openCursor(accountRange(after));
			const jobs: SyncJob[] = [];
			request.onsuccess = () => {
				try {
					const cursor = request.result;
					if (!cursor) { done({ jobs }); return; }
					if (jobs.length === SYNC_JOB_PAGE_SIZE) { done({ jobs, next: jobs.at(-1)!.key }); return; }
					const job = validate(cursor.value);
					if (job.scope.ownerId !== bound.scope.ownerId) throw Error('Sync job account changed.');
					jobs.push(job); cursor.continue();
				} catch (error) { fail(error); }
			};
		}),
		admit: (saved: SavedFileSyncConfiguration, id: string, intervalMs?: number,
			photoSettings?: { previous: SyncJob | null; transfers: PreviousPhotoSettings }, automatic?: { previous: SyncJob | null }, enrollment?: { previous: SyncJob | null; pendingFolderValidation?: true }) =>
			bound.transaction<SyncJob>([STORE, INVENTORY_PIN_STORE, ...(photoSettings ? PHOTO_SETTINGS_STORES : [])], 'readwrite', (tx, done, fail) => {
				const reviewed = canonical(saved, bound.scope), store = tx.objectStore(STORE), request = store.get(bound.key);
				request.onsuccess = () => {
					try {
						const previous = request.result ? validate(request.result) : null;
						if (automatic && (previous?.id !== automatic.previous?.id || previous?.revision !== automatic.previous?.revision || previous?.state === 'paused' || reviewed.configuration.paused)) throw Error('The saved sync job changed while preparing automatic Photos backup.');
						if (enrollment && (previous?.id !== enrollment.previous?.id || previous?.revision !== enrollment.previous?.revision)) throw Error('This sync config changed while enabling automation. Review its current status.');
							if (previous?.strictCaptureId) throw Error('Confirm the previous strict inventory cleanup before admitting a new scan.');
						if (photoSettings && (previous?.id !== photoSettings.previous?.id || previous?.revision !== photoSettings.previous?.revision))
							throw Error('The sync job changed while stopping. Please retry.');
						const unfinished = previous && previous.state !== 'complete' && !previous.folderSetupPaused && previous.nextRunAt === undefined;
						const policyChanged = !!unfinished && JSON.stringify(previous.reviewed.configuration) !== JSON.stringify(reviewed.configuration);
						const replacingPhotos = !!photoSettings && !!previous && photoSettingsChanged(previous.reviewed, reviewed);
						if (photoSettings && !replacingPhotos && !Object.values(photoSettings.transfers).some(transfer => transfer.park))
							throw new SyncJobConfigurationChanged();
						if (policyChanged && previous.state !== 'paused' && !replacingPhotos) throw new SyncJobConfigurationChanged();
						const resume = unfinished && !policyChanged && !photoSettings;
						const sameReviewed = resume && JSON.stringify(previous.reviewed) === JSON.stringify(reviewed);
						const repeat = intervalMs ?? (previous && (syncJobEnabled(previous) || previous.state === 'attention') ? previous.intervalMs : undefined);
						const job = validate({ version: 1, key: bound.key, id: resume ? previous.id : id,
							revision: (previous?.revision ?? 0) + 1, scope: bound.scope, reviewed, state: 'runnable',
							...(repeat === undefined ? {} : { intervalMs: repeat }),
								...(enrollment?.pendingFolderValidation ? { pendingFolderValidation: true as const } : {}),
							...(sameReviewed && previous.photoQueueEpoch ? { photoQueueEpoch: previous.photoQueueEpoch } : {}),
							...(sameReviewed && previous.localImport ? { localImport: previous.localImport } : {}),
							...(sameReviewed && previous.nativeCaptureId ? { nativeCaptureId: previous.nativeCaptureId, ...(previous.nativeCaptureGeneration ? { nativeCaptureGeneration: previous.nativeCaptureGeneration, nativeCaptureRestarts: previous.state === 'runnable' ? previous.nativeCaptureRestarts ?? 0 : 0 } : {}) } : {}) });
						const count = store.index('account').count(accountRange());
						count.onsuccess = () => {
							if (!previous && count.result >= MAX_SYNC_JOBS_PER_ACCOUNT) { fail(Error('This account has reached its saved sync job limit.')); return; }
							const commit = () => { bound.check(); pinImport(tx, previous, job); store.put(job); done(job); };
							try {
								if (photoSettings) parkPhotoSettings(tx, bound.scope, bound.key, reviewed.configuration, photoSettings.transfers, replacingPhotos, commit, fail);
								else commit();
							} catch (error) { fail(error); }
						};
					} catch (error) { fail(error); }
				};
			}).then(changed),
		/** CAS prevents an old discovery or late completion from reviving a
		 * stopped job, replacing a newer attempt, or replaying completed work. */
		transition: (expected: SyncJob, state: 'runnable' | 'paused' | 'attention' | 'complete') => change(expected,
			current => {
				if (current.state !== 'runnable') return null;
				if (state !== 'complete') return { ...current, state };
				if (current.strictCaptureId) throw Error('Strict inventory cleanup has not been confirmed.');
				const { localImport: _import, nativeCaptureId: _capture, nativeCaptureGeneration: _generation, nativeCaptureRestarts: _restarts, ...rest } = current;
				return { ...rest, state };
			}),
		begin: (expected: SyncJob, now: number, id: string, photo?: { wakeConditions: boolean }, wakeConditions = false) => change(expected, current => {
			if (!syncJobDue(current, now, photo?.wakeConditions ?? wakeConditions)) return null;
			const { retryAt: _retry, waitReason: _wait, minimumPartBytes: _part, automaticPhotoRevision: _blocked, nextRunAt: _due, pendingFolderValidation: _validation, nativeCaptureId, nativeCaptureGeneration, nativeCaptureRestarts, localImport, ...rest } = current;
			return { ...rest, id: current.state === 'scheduled' ? id : current.id, state: 'runnable', ...(photo ? { intervalMs: PHOTO_AUTOMATION_INTERVAL_MS } : {}), ...(current.state === 'runnable' && localImport ? { localImport } : {}), ...(current.state === 'runnable' && nativeCaptureId ? { nativeCaptureId, ...(nativeCaptureGeneration ? { nativeCaptureGeneration, nativeCaptureRestarts: nativeCaptureRestarts ?? 0 } : {}) } : {}) };
		}),
		finish: (expected: SyncJob, now: number) => change(expected, current => {
			if (current.state !== 'runnable') return null;
			if (current.strictCaptureId) throw Error('Strict inventory cleanup has not been confirmed.');
			if (!Number.isSafeInteger(now) || now < 0) throw Error('Invalid sync completion time.');
			const { retryAt: _retry, waitReason: _wait, minimumPartBytes: _part, automaticPhotoRevision: _blocked, strictCaptureRetries: _strictRetries, nativeCaptureId: _capture, nativeCaptureGeneration: _generation, nativeCaptureRestarts: _restarts, localImport: _import, photoQueueEpoch: _photoQueue, ...rest } = current;
			return current.intervalMs === undefined ? { ...rest, state: 'complete' } :
				{ ...rest, state: 'scheduled', nextRunAt: now + current.intervalMs };
		}),
		/** A verified Pause before admission must survive reopening the app.
		 * Replace only absence or an already finished one-shot marker. Never
		 * drop an unfinished transfer's capture or journal here. */
		pauseFolderSetup: (saved: SavedFileSyncConfiguration, id: string) =>
			bound.transaction<SyncJob | null>([STORE], 'readwrite', (tx, done, fail) => {
				const reviewed = canonical(saved, bound.scope);
				if (reviewed.configuration.sourceKind === 'photos') throw Error('Use Photos backup controls to pause this source.');
				const store = tx.objectStore(STORE), request = store.get(bound.key);
				request.onsuccess = () => {
					try {
						const prior = request.result ? validate(request.result) : null;
						if (prior?.state === 'paused') { done(prior); return; }
						if (prior && prior.state !== 'complete') { done(null); return; }
						const next = validate({ version: 1, key: bound.key, id, revision: (prior?.revision ?? 0) + 1,
							scope: bound.scope, reviewed, state: 'paused', folderSetupPaused: true });
						const save = () => { bound.check(); store.put(next); done(next); };
						if (prior) save();
						else {
							const count = store.index('account').count(accountRange());
							count.onsuccess = () => {
								try {
									if (count.result >= MAX_SYNC_JOBS_PER_ACCOUNT) throw Error('This account has reached its saved sync job limit.');
									save();
								} catch (error) { fail(error); }
							};
						}
					} catch (error) { fail(error); }
				};
			}).then(changed),
		/** Denial-only pause can exist before automatic Photos admits its first run. */
		pausePhoto: (saved: SavedFileSyncConfiguration, id: string) =>
			bound.transaction<SyncJob>([STORE], 'readwrite', (tx, done, fail) => {
				const reviewed = canonical(saved, bound.scope);
				const enabled = { ...reviewed.configuration, paused: false };
				if (!samePhotoBackupSource(enabled, enabled)) throw Error('Only Photos backup can be paused before admission.');
				const store = tx.objectStore(STORE), request = store.get(bound.key);
				request.onsuccess = () => {
					try {
						const prior = request.result ? validate(request.result) : null;
						if (prior?.state === 'paused') { done(prior); return; }
						if (prior && !samePhotoBackupSource(prior.reviewed.configuration, enabled))
							throw Error('This saved job uses a different native source.');
						const next = prior ? { ...prior, state: 'paused' as const, revision: prior.revision + 1 } :
							{ version: 1 as const, key: bound.key, id, revision: 1, scope: bound.scope, reviewed, state: 'paused' as const };
						const save = () => { bound.check(); store.put(validate(next)); done(next); };
						if (prior) save();
						else {
							const count = store.index('account').count(accountRange());
							count.onsuccess = () => {
								try {
									if (count.result >= MAX_SYNC_JOBS_PER_ACCOUNT) throw Error('This account has reached its saved sync job limit.');
									save();
								} catch (error) { fail(error); }
							};
						}
					} catch (error) { fail(error); }
				};
			}).then(changed),
		/** Sole native Resume lifts the local denial without re-admitting old
		 * browser transfers or dropping their native cleanup and receipt pins. */
		resumePhotoPause: (expected: SyncJob) => change(expected, current => {
			if (current.state !== 'paused' || current.reviewed.configuration.sourceKind !== 'photos') return null;
			return { ...current, state: current.nextRunAt === undefined ? 'runnable' : 'scheduled' };
		}),
		pause: (expected: SyncJob) => change(expected, current =>
			syncJobCanPause(current) ? { ...current, state: 'paused' } : null),
		attention: (expected: SyncJob, cause?: unknown, automaticPhotoRevision?: string) => change(expected, current =>
			(['runnable', 'scheduled'].includes(current.state) || (current.state !== 'paused' && automaticPhotoRevision !== undefined)) ? { ...current, state: 'attention', failureReason: syncJobFailure(cause), ...(automaticPhotoRevision ? { automaticPhotoRevision } : {}) } : null)
	};
}
