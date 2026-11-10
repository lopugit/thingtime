import { parseFileSyncConfiguration, type FileSyncConfiguration } from './configuration';
import { validateSyncRun, type SyncRun } from './execute';
import { samePhotoBackupSource } from './photoSettingsPolicy';
import { PAGED_RUN_HEADS, PAGED_RUN_STORES, parsePagedRunSpec, validatePagedRunHeader, type PagedRunHeader } from './pagedRunJournal';
import { REVIEW_DRAFT_HEADS, REVIEW_DRAFT_STORES, parseReviewDraftSpec, validateReviewDraftHeader, type ReviewDraftHeader } from './pagedReviewDraft';
import { sameSyncScope, type SyncScope } from './reconcile';
import { SyncJobConfigurationChanged } from './syncJobFailure';

export const PHOTO_SETTINGS_STORES = [PAGED_RUN_HEADS, PAGED_RUN_STORES[0], REVIEW_DRAFT_HEADS, REVIEW_DRAFT_STORES[0], 'runs'] as const;
type PreviousTransfer = { id: string; park: boolean };
// Preserve the persisted key used by destination-only recovery.
export const previousPhotoRunKey = (key: string, id: string) => [key, 'previous-photo-destination', id];
export type PreviousPhotoSettings = { paged?: PreviousTransfer; review?: PreviousTransfer; legacy?: PreviousTransfer };

/** Archive pointers, never the operation rows themselves. An archived pointer
 * cannot claim, confirm, or advance a run. Keep its plans/receipts attached to
 * the original IDs; canonical cloud history is independent of these records. */
export function parkPhotoSettings(
	tx: IDBTransaction, scope: SyncScope, key: string, current: FileSyncConfiguration,
	expected: PreviousPhotoSettings, reviewedChanged: boolean, done: () => void, fail: (error: unknown) => void
) {
	let pending = 3;
	const finish = () => { if (--pending === 0) done(); };
	const read = <T>(store: IDBObjectStore, id: IDBValidKey, consume: (value: T) => void) => {
		const request = store.get(id);
		request.onsuccess = () => { try { consume(request.result); } catch (error) { fail(error); } };
	};
	const matches = (id: string, configuration: FileSyncConfiguration | undefined, prior: string | undefined) => {
		if (id !== prior || !configuration || !samePhotoBackupSource(configuration, current) ||
			(!reviewedChanged && JSON.stringify(configuration) === JSON.stringify(current))) throw new SyncJobConfigurationChanged();
		return configuration.remoteFolderId;
	};
	const parkHead = (store: IDBObjectStore, id: string, folder: string) => {
		store.add(id, [key, 'previous-photo-destination', folder, id]);
		store.delete(key);
		finish();
	};
	const paged = tx.objectStore(PAGED_RUN_HEADS);
	read<string | undefined>(paged, key, id => {
		if (id !== expected.paged?.id) throw new SyncJobConfigurationChanged();
		if (!expected.paged?.park || id === undefined) {
			finish(); return;
		}
		read<PagedRunHeader>(tx.objectStore(PAGED_RUN_STORES[0]), [key, id], header => {
			const spec = parsePagedRunSpec(header?.spec);
			validatePagedRunHeader(header, spec, scope);
			parkHead(paged, id, matches(spec.id, spec.configuration, id));
		});
	});
	const drafts = tx.objectStore(REVIEW_DRAFT_HEADS);
	read<string | undefined>(drafts, key, id => {
		if (id !== expected.review?.id) throw new SyncJobConfigurationChanged();
		if (!expected.review?.park || id === undefined) {
			finish(); return;
		}
		read<ReviewDraftHeader>(tx.objectStore(REVIEW_DRAFT_STORES[0]), [key, id], header => {
			const spec = parseReviewDraftSpec(header?.spec);
			validateReviewDraftHeader(header, spec, key);
			parkHead(drafts, id, matches(spec.id, spec.configuration, id));
		});
	});
	const legacy = tx.objectStore('runs');
	read<(SyncRun & { configuration?: unknown }) | undefined>(legacy, key, run => {
		if (run?.id !== expected.legacy?.id) throw new SyncJobConfigurationChanged();
		if (!expected.legacy?.park) {
			finish(); return;
		}
		if (!run || run.version !== 1 || !sameSyncScope(scope, run.scope)) throw new SyncJobConfigurationChanged();
		validateSyncRun(run);
		matches(run.id, parseFileSyncConfiguration(run.configuration), expected.legacy.id);
		legacy.add(run, previousPhotoRunKey(key, run.id));
		legacy.delete(key);
		finish();
	});
}
