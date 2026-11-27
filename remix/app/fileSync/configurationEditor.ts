import { SYNC_INTERVALS } from './syncJobJournal';
import type { SyncResourceDraft } from '../components/Devices/syncResourceControlsBlocks';
import { parseFileSyncConfiguration, type FileSyncConfiguration } from './configuration';
import { readOwnedFileSyncConfiguration, type SavedFileSyncConfiguration } from './configuredPlan';
import { createEnrollmentDiagnostics, enrollmentDiagnosticsEnabled, type EnrollmentPhase, type EnrollmentFacts } from './syncEnrollmentDiagnostics';

export type PhotoAutomationDraft = { speed: string; speedUnit: 'Mbps' | 'MB/s'; data: string; dataUnit: 'MB' | 'GB'; notificationIntervalMs: string };
/** Explicit Save & sync authorization survives the boundary between the
 * verified cloud save and the device journal. The revision is set only from
 * exact private readback; retrying cannot arm an intervening edit. */
export type SyncEnrollmentIntent = { intervalMs: number; savedRevision?: string; transport?: 'local' | 'remote' };
export type ConfigurationDraft = {
	version: 1;
	id: string;
	baseUpdatedAt: string | null;
	configuration: FileSyncConfiguration;
	exclusions: string;
	pending: boolean;
	enrollment?: SyncEnrollmentIntent;
	resourceDraft?: SyncResourceDraft;
	photoAutomationDraft?: PhotoAutomationDraft;
};
export type ConfigurationEditorScope = { origin: string; ownerId: string; dataPlane: string; deviceId: string };
export const CONFIGURATION_DRAFT_PREFIX = 'tt:sync-editor:v1:';
export const SYNC_ENROLLMENT_RECOVERED_EVENT = 'tt:sync-enrollment-recovered';
export const SYNC_ENROLLMENT_WAKE_EVENT = 'tt:sync-enrollment-wake';
export const configurationDraftKey = (scope: ConfigurationEditorScope) => CONFIGURATION_DRAFT_PREFIX + JSON.stringify(scope);
const enrollmentClaims = new Map<string, { cancellation?: AbortController }>();
const enrollmentDiagnostics = enrollmentDiagnosticsEnabled ? createEnrollmentDiagnostics() : null;
if (enrollmentDiagnostics && typeof window !== 'undefined') Object.defineProperty(window, '__thingtimeSyncEnrollmentDiagnostics', {
	configurable: true, value: Object.freeze({ read: (scope: ConfigurationEditorScope, targetId?: string) => {
		if (scope?.origin !== window.location.origin) return [];
		return enrollmentDiagnostics.read(configurationDraftKey({ origin: scope.origin, ownerId: scope.ownerId, dataPlane: scope.dataPlane, deviceId: scope.deviceId }), targetId);
	} })
});
/** UI and background discovery share the same draft storage fence. */
export function claimSyncEnrollment(scope: ConfigurationEditorScope, cancellation?: AbortController, diagnosticTargetId?: string) {
	const key = configurationDraftKey(scope);
	if (enrollmentClaims.has(key)) return null;
	const claim = { cancellation };
	enrollmentClaims.set(key, claim);
	const diagnostic = enrollmentDiagnostics?.begin(key, cancellation?.signal, diagnosticTargetId);
	const release = () => {
		if (enrollmentClaims.get(key) === claim) { enrollmentClaims.delete(key); diagnostic?.release(); }
	};
	release.phase = (phase: EnrollmentPhase, signal?: AbortSignal, facts?: EnrollmentFacts) => { if (enrollmentClaims.get(key) === claim) diagnostic?.phase(phase, signal, facts); };
	release.failed = (cause: unknown) => { if (enrollmentClaims.get(key) === claim) diagnostic?.failed(cause); };
	return release;
}
export function cancelSyncEnrollmentRecovery(scope: ConfigurationEditorScope) {
	enrollmentClaims.get(configurationDraftKey(scope))?.cancellation?.abort();
}
const validId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(v);
export function readConfigurationDraft(raw: string | null, deviceId: string): ConfigurationDraft | null {
	if (raw === null) return null;
	const draft = JSON.parse(raw) as ConfigurationDraft;
	if (
		draft.version !== 1 ||
		!validId(draft.id) ||
		typeof draft.pending !== 'boolean' ||
		!(draft.baseUpdatedAt === null || (typeof draft.baseUpdatedAt === 'string' && Number.isFinite(Date.parse(draft.baseUpdatedAt)))) ||
		typeof draft.exclusions !== 'string' ||
		draft.exclusions.length > 16384 ||
		draft.configuration?.deviceId !== deviceId ||
		typeof draft.configuration?.localRootId !== 'string' ||
		typeof draft.configuration?.remoteFolderId !== 'string' ||
		typeof draft.configuration?.name !== 'string' ||
		draft.configuration.name.length > 120
	)
		throw Error('The saved connection draft needs recovery; it has not been replaced.');
	// Empty editable names/roots are allowed, but malformed persisted values are not.
	parseFileSyncConfiguration({
		...draft.configuration,
		name: 'Draft',
		localRootId: draft.configuration.localRootId || 'unselected',
		remoteFolderId: draft.configuration.remoteFolderId || 'unselected'
	});
	if (draft.resourceDraft !== undefined) {
		const fields = ['upload', 'uploadUnit', 'download', 'downloadUnit', 'transferConcurrency', 'indexingConcurrency', 'cpuPercent'];
		if (!draft.resourceDraft || fields.some(field => typeof (draft.resourceDraft as any)[field] !== 'string') ||
			!['Kbps', 'Mbps', 'Gbps'].includes(draft.resourceDraft.uploadUnit) || !['Kbps', 'Mbps', 'Gbps'].includes(draft.resourceDraft.downloadUnit))
			throw Error('The saved resource draft needs recovery; it has not been replaced.');
	}
	const photo = draft.photoAutomationDraft;
	if (photo !== undefined && (!photo || typeof photo.speed !== 'string' || typeof photo.data !== 'string' ||
		typeof photo.notificationIntervalMs !== 'string' || !['Mbps', 'MB/s'].includes(photo.speedUnit) ||
		!['MB', 'GB'].includes(photo.dataUnit))) throw Error('The saved Photos automation draft needs recovery; it has not been replaced.');
	const enrollment = draft.enrollment;
	if (enrollment !== undefined && (!draft.pending || !enrollment ||
		!SYNC_INTERVALS.some(interval => interval === enrollment.intervalMs) ||
		(enrollment.transport !== undefined && enrollment.transport !== 'local' && enrollment.transport !== 'remote') ||
		(enrollment.savedRevision !== undefined && (typeof enrollment.savedRevision !== 'string' || !Number.isFinite(Date.parse(enrollment.savedRevision))))))
		throw Error('The saved automatic sync request needs recovery; it has not been replaced.');
	if (draft.pending) canonicalDraftConfiguration(draft);
	return draft;
}
/** Keep the existing scoped key so legacy drafts migrate on the first verified
 * edit. Reading never removes or rewrites a legacy or damaged journal. */
export function readConfigurationDrafts(raw: string | null, deviceId: string): ConfigurationDraft[] {
	if (raw === null) return [];
	const value = JSON.parse(raw);
	if (value?.version === 1) return [readConfigurationDraft(raw, deviceId)!];
	if (value?.version !== 2 || !Array.isArray(value.drafts))
		throw Error('The saved connection drafts need recovery; they have not been replaced.');
	const drafts = value.drafts.map((draft: unknown) => readConfigurationDraft(JSON.stringify(draft), deviceId)!);
	if (new Set(drafts.map((draft: ConfigurationDraft) => draft.id)).size !== drafts.length)
		throw Error('The saved connection drafts contain duplicate identities; they have not been replaced.');
	return drafts;
}
export function persistConfigurationDrafts(
	storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
	key: string,
	previous: string | null,
	drafts: ConfigurationDraft[]
): string | null {
	return persistDraftJournal(storage, key, previous, drafts.length ? JSON.stringify({ version: 2, drafts }) : null);
}
export function canonicalDraftConfiguration(draft: ConfigurationDraft) {
	return parseFileSyncConfiguration({ ...draft.configuration, excludedPaths: draft.exclusions.split(/\r?\n/).filter((path) => path !== '') });
}
/** Synchronous draft persistence with read-back verification. A failed write must
 * prevent HTTP dispatch; best-effort UI caches cannot serve as a write journal.
 * The API's fixed ID and revision guard remain the authority across tabs. */
export function persistConfigurationDraft(
	storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
	key: string,
	previous: string | null,
	next: ConfigurationDraft | null
): string | null {
	return persistDraftJournal(storage, key, previous, next === null ? null : JSON.stringify(next));
}
function persistDraftJournal(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, key: string, previous: string | null, raw: string | null) {
	if (storage.getItem(key) !== previous) throw Error('This connection draft changed in another tab. Reload to recover it.');
	if (raw === null) storage.removeItem(key);
	else storage.setItem(key, raw);
	if (storage.getItem(key) !== raw) throw Error('Could not preserve this draft on the device. Free storage and try again.');
	return raw;
}
export type ConfigurationEditorTransport = {
	get(id: string): Promise<unknown>;
	create(id: string, configuration: FileSyncConfiguration): Promise<unknown>;
	update(id: string, configuration: FileSyncConfiguration, expectedUpdatedAt: string): Promise<unknown>;
	verifyDeviceRoot(deviceId: string, localRootId: string): Promise<void>;
	assertCurrent(): void;
};
export class ConfigurationConflict extends Error {
	constructor(public latest: SavedFileSyncConfiguration | null) {
		super('This connection changed elsewhere. Your draft is preserved; review the saved version before editing again.');
	}
}
export function readOwnedSyncFolder(value: unknown, ownerId: string): { id: string; name: string } {
	const row = value as any;
	if (
		!row ||
		!validId(row.id) ||
		row.author?.id !== ownerId ||
		!Array.isArray(row.thingtime) ||
		!row.thingtime.includes('folder') ||
		row.targetId != null ||
		!Array.isArray(row.acl) ||
		row.acl.length !== 1 ||
		row.acl[0] !== 'tt:user'
	)
		throw Error('Choose a private cloud folder owned by this account.');
	return { id: row.id, name: typeof row.crystal?.name === 'string' ? row.crystal.name : 'Untitled folder' };
}
const status = (error: unknown) => (error as { status?: number })?.status;
/** Reopening setup never writes cloud settings again or follows a newer
 * revision. A different save must be reviewed and explicitly enrolled. */
export async function readPendingSyncEnrollment(draft: ConfigurationDraft, scope: ConfigurationEditorScope,
	api: Pick<ConfigurationEditorTransport, 'get' | 'assertCurrent'>): Promise<SavedFileSyncConfiguration> {
	const saved = await readSavedSyncEnrollment(draft, scope, api);
	if (!saved) throw Error('No confirmed automatic sync setup is available.');
	return saved;
}

export async function readSavedSyncEnrollment(
	draft: ConfigurationDraft,
	scope: ConfigurationEditorScope,
	api: Pick<ConfigurationEditorTransport, 'get' | 'assertCurrent'>
): Promise<SavedFileSyncConfiguration | null> {
	const intent = draft.enrollment, revision = intent?.savedRevision;
	if (!draft.pending || !intent || draft.configuration.deviceId !== scope.deviceId)
		throw Error('No automatic sync setup is available.');
	api.assertCurrent();
	let value: unknown;
	try { value = await api.get(draft.id); }
	catch (cause) {
		api.assertCurrent();
		if (status(cause) === 404) {
			if (!revision && draft.baseUpdatedAt === null) return null;
			throw new ConfigurationConflict(null);
		}
		throw cause;
	}
	api.assertCurrent();
	const saved = readOwnedFileSyncConfiguration(value, scope.ownerId);
	if (saved.id !== draft.id || saved.configuration.deviceId !== scope.deviceId) throw Error('The selected sync config changed.');
	const matches = JSON.stringify(saved.configuration) === JSON.stringify(canonicalDraftConfiguration(draft));
	if ((revision && saved.updatedAt !== revision) || !matches) {
		// The original write may never have left the browser. Never write on
		// startup; keep the exact immutable draft for an explicit save retry.
		if (!revision && saved.updatedAt === draft.baseUpdatedAt) return null;
		throw new ConfigurationConflict(saved);
	}
	return saved;
}

/** Only call with a durably saved, immutable pending draft. Retrying reads the
 * fixed ID before writing. Lost replies never mint a new ID or bypass CAS.
 * Read-back equality confirms current state, not an immutable operation receipt. */
export async function saveConfigurationDraft(
	draft: ConfigurationDraft,
	scope: ConfigurationEditorScope,
	api: ConfigurationEditorTransport
): Promise<SavedFileSyncConfiguration> {
	if (!draft.pending) throw Error('Preserve the pending save before sending it.');
	const configuration = canonicalDraftConfiguration(draft);
	if (configuration.deviceId !== scope.deviceId) throw Error('The selected device changed.');
	const read = async () => {
		api.assertCurrent();
		try {
			const row = await api.get(draft.id);
			api.assertCurrent();
			const saved = readOwnedFileSyncConfiguration(row, scope.ownerId);
			if (saved.id !== draft.id) throw Error('The server returned a different connection.');
			return saved;
		} catch (error) {
			api.assertCurrent();
			if (status(error) === 404) return null;
			throw error;
		}
	};
	const equal = (saved: SavedFileSyncConfiguration | null) => saved !== null && JSON.stringify(saved.configuration) === JSON.stringify(configuration);
	const before = await read();
	if (equal(before)) return before!;
	if (draft.baseUpdatedAt === null ? before !== null : before?.updatedAt !== draft.baseUpdatedAt) throw new ConfigurationConflict(before);
	await api.verifyDeviceRoot(scope.deviceId, configuration.localRootId);
	api.assertCurrent();
	const folder = readOwnedSyncFolder(await api.get(configuration.remoteFolderId), scope.ownerId);
	api.assertCurrent();
	if (folder.id !== configuration.remoteFolderId) throw Error('The cloud destination changed.');
	let failure: unknown;
	try {
		if (draft.baseUpdatedAt === null) await api.create(draft.id, configuration);
		else await api.update(draft.id, configuration, draft.baseUpdatedAt);
	} catch (error) {
		failure = error;
	}
	api.assertCurrent();
	const after = await read();
	if (equal(after)) return after!;
	if (draft.baseUpdatedAt === null ? after !== null : after?.updatedAt !== draft.baseUpdatedAt) throw new ConfigurationConflict(after);
	throw failure ?? Error('The save is not confirmed yet. Retry to check the same connection.');
}
