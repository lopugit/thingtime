import { parseFileSyncConfiguration, type FileSyncConfiguration } from './configuration';
import type { SavedFileSyncConfiguration } from './configuredPlan';
import type { openSyncJournal } from './journal.client';
import type { JournalAccess } from './journalScope';
import type { PreviousPhotoSettings } from './photoSettingsJournal';
import { photoSettingsChanged, samePhotoBackupSource } from './photoSettingsPolicy';
import { SyncJobConfigurationChanged } from './syncJobFailure';
import type { SyncJob } from './syncJobJournal';

type Journal = Awaited<ReturnType<typeof openSyncJournal>>;
type Recovery = { previous: SyncJob | null; transfers: PreviousPhotoSettings };

/** Called only for explicit Start, under the root lock and after native Photos
 * source access is established. Plan locally before making any cancellation. */
export async function preparePhotoSettingsRecovery(
	journal: Journal, access: JournalAccess, prior: SyncJob | null, saved: SavedFileSyncConfiguration,
	port: { verify(): Promise<void>; disarm(): Promise<void>; check(): void }
): Promise<Recovery | undefined> {
	const current = parseFileSyncConfiguration(saved.configuration);
	if (current.sourceKind !== 'photos' || current.paused) return;
	const [active, draft, legacy] = await Promise.all([
		journal.pagedRuns(access).active(), journal.reviewDrafts(access).active(), journal.read(access.scope)
	]);
	port.check();
	const same = (configuration: FileSyncConfiguration | undefined) => JSON.stringify(configuration) === JSON.stringify(current);
	const reviewedChanged = !!prior && photoSettingsChanged(prior.reviewed, { ...saved, configuration: current });
	const park = (configuration: FileSyncConfiguration | undefined) => !!configuration &&
		samePhotoBackupSource(configuration, current) && (reviewedChanged || !same(configuration));
	const previous = prior?.reviewed.configuration;
	const pagedConfig = active?.spec.configuration, draftConfig = draft?.spec.configuration;
	let legacyConfig: FileSyncConfiguration | undefined;
	if (legacy?.version === 1) {
		const value = (legacy as { configuration?: unknown }).configuration;
		if (value !== undefined) legacyConfig = parseFileSyncConfiguration(value);
	}
	const transfers: PreviousPhotoSettings = {
		...(active ? { paged: { id: active.spec.id, park: park(pagedConfig) } } : {}),
		...(draft ? { review: { id: draft.spec.id, park: park(draftConfig) } } : {}),
		...(legacy ? { legacy: { id: legacy.id, park: park(legacyConfig) } } : {})
	};
	if (!reviewedChanged && !Object.values(transfers).some(transfer => transfer.park)) return;
	if ((active && !transfers.paged!.park && !same(pagedConfig)) ||
		(draft && !transfers.review!.park && !same(draftConfig)) ||
		(previous && !reviewedChanged && !same(previous))) throw new SyncJobConfigurationChanged();
	// A legacy unfinished run without exact matching settings remains guarded
	// when there is no paged work to supersede it in the runner.
	if (legacy && (!active || transfers.paged!.park) && (!draft || transfers.review!.park) &&
		!transfers.legacy!.park && !same(legacyConfig) &&
		(legacy.version === 2 || legacy.operations.some(operation => !operation.confirmed))) throw new SyncJobConfigurationChanged();
	await port.verify(); port.check();
	await port.disarm(); port.check();
	await port.verify(); port.check();
	return { previous: prior, transfers };
}
