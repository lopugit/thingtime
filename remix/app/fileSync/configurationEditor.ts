import { parseFileSyncConfiguration, type FileSyncConfiguration } from './configuration';
import { readOwnedFileSyncConfiguration, type SavedFileSyncConfiguration } from './configuredPlan';

export type ConfigurationDraft = {
	version: 1;
	id: string;
	baseUpdatedAt: string | null;
	configuration: FileSyncConfiguration;
	exclusions: string;
	pending: boolean;
};
export type ConfigurationEditorScope = { origin: string; ownerId: string; dataPlane: string; deviceId: string };
export const configurationDraftKey = (scope: ConfigurationEditorScope) => 'tt:sync-editor:v1:' + JSON.stringify(scope);
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
	if (draft.pending) canonicalDraftConfiguration(draft);
	return draft;
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
	if (storage.getItem(key) !== previous) throw Error('This connection draft changed in another tab. Reload to recover it.');
	const raw = next === null ? null : JSON.stringify(next);
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
