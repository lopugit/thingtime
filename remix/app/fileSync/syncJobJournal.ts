import { parseFileSyncConfiguration } from './configuration';
import type { SavedFileSyncConfiguration } from './configuredPlan';
import { journalScope, type JournalAccess } from './journalScope';
import { syncScopeKey, type SyncScope } from './reconcile';

const STORE = 'sync-admitted-jobs';
export const SYNC_JOB_PAGE_SIZE = 32;
export const MAX_SYNC_JOBS_PER_ACCOUNT = 256;
export const SYNC_INTERVALS = [60_000, 300_000, 900_000, 3_600_000] as const;
export const SYNC_JOBS_CHANGED_EVENT = 'tt:sync-jobs-changed';
export type SyncJob = {
	version: 1; key: string; id: string; revision: number;
	scope: SyncScope; reviewed: SavedFileSyncConfiguration;
	state: 'runnable' | 'scheduled' | 'paused' | 'attention' | 'complete';
	/** Absent on existing one-shot admissions. Editable Things cannot opt in. */
	intervalMs?: number;
	nextRunAt?: number;
};
export const syncJobEnabled = (job: SyncJob) => job.intervalMs !== undefined && ['runnable', 'scheduled'].includes(job.state);
export const syncJobDue = (job: SyncJob, now: number) => job.state === 'runnable' ||
	(job.state === 'scheduled' && Number.isSafeInteger(now) && now >= job.nextRunAt!);

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
		(value.intervalMs !== undefined && !SYNC_INTERVALS.some(interval => interval === value.intervalMs)) ||
		(value.nextRunAt !== undefined && (!Number.isSafeInteger(value.nextRunAt) || value.nextRunAt < 0 || !['scheduled', 'paused', 'attention'].includes(value.state))) ||
		(value.state === 'scheduled' && (value.intervalMs === undefined || value.nextRunAt === undefined)) ||
		typeof value.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value.id) ||
		JSON.stringify(canonical(value.reviewed, value.scope)) !== JSON.stringify(value.reviewed))
		throw Error('Invalid saved sync job.');
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
	const change = (expected: SyncJob, update: (current: SyncJob) => SyncJob | null) =>
		bound.transaction<SyncJob | null>([STORE], 'readwrite', (tx, done, fail) => {
			validate(expected);
			if (expected.key !== bound.key) throw Error('Sync job scope changed.');
			const store = tx.objectStore(STORE), request = store.get(bound.key);
			request.onsuccess = () => {
				try {
					const current = request.result ? validate(request.result) : null;
					if (!current || current.id !== expected.id || current.revision !== expected.revision) { done(null); return; }
					const next = update(current);
					if (next) store.put(validate({ ...next, revision: current.revision + 1 }));
					done(next ? { ...next, revision: current.revision + 1 } : null);
				} catch (error) { fail(error); }
			};
		}).then(value => value ? changed(value) : value);
	return {
		read,
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
		admit: (saved: SavedFileSyncConfiguration, id: string, intervalMs?: number) => bound.transaction<SyncJob>([STORE], 'readwrite', (tx, done, fail) => {
			const reviewed = canonical(saved, bound.scope), store = tx.objectStore(STORE), request = store.get(bound.key);
			request.onsuccess = () => {
				try {
					const previous = request.result ? validate(request.result) : null;
					const unfinished = previous && previous.state !== 'complete' && previous.nextRunAt === undefined;
					if (unfinished && JSON.stringify(previous.reviewed.configuration) !== JSON.stringify(reviewed.configuration))
						throw Error('An unfinished sync job belongs to different settings. Restore its settings before retrying.');
					const repeat = intervalMs ?? (previous && syncJobEnabled(previous) ? previous.intervalMs : undefined);
					const job = validate({ version: 1, key: bound.key, id: unfinished ? previous.id : id,
						revision: (previous?.revision ?? 0) + 1, scope: bound.scope, reviewed, state: 'runnable',
						...(repeat === undefined ? {} : { intervalMs: repeat }) });
					const count = store.index('account').count(accountRange());
					count.onsuccess = () => {
						if (!previous && count.result >= MAX_SYNC_JOBS_PER_ACCOUNT) { fail(Error('This account has reached its saved sync job limit.')); return; }
						store.put(job); done(job);
					};
				} catch (error) { fail(error); }
			};
		}).then(changed),
		/** CAS prevents an old discovery or late completion from reviving a
		 * stopped job, replacing a newer attempt, or replaying completed work. */
		transition: (expected: SyncJob, state: 'runnable' | 'paused' | 'attention' | 'complete') => change(expected,
			current => current.state === 'runnable' ? { ...current, state } : null),
		begin: (expected: SyncJob, now: number, id: string) => change(expected, current => {
			if (!syncJobDue(current, now)) return null;
			const { nextRunAt: _due, ...rest } = current;
			return { ...rest, id: current.state === 'scheduled' ? id : current.id, state: 'runnable' };
		}),
		finish: (expected: SyncJob, now: number) => change(expected, current => {
			if (current.state !== 'runnable') return null;
			if (!Number.isSafeInteger(now) || now < 0) throw Error('Invalid sync completion time.');
			return current.intervalMs === undefined ? { ...current, state: 'complete' } :
				{ ...current, state: 'scheduled', nextRunAt: now + current.intervalMs };
		}),
		pause: (expected: SyncJob) => change(expected, current =>
			['runnable', 'scheduled', 'attention'].includes(current.state) ? { ...current, state: 'paused' } : null),
		attention: (expected: SyncJob) => change(expected, current =>
			['runnable', 'scheduled'].includes(current.state) ? { ...current, state: 'attention' } : null)
	};
}
