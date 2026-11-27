import { deviceResourceKey, deviceSyncGovernor } from './deviceResourcePolicy';
import { parseFileSyncConfiguration, FILE_SYNC_UPLOAD_POLICY_REQUIREMENTS, FILE_SYNC_PHOTO_AUTOMATION_REQUIREMENTS, FILE_SYNC_IGNORE_REQUIREMENTS, FILE_SYNC_RESOURCE_REQUIREMENTS } from './configuration';
import { assertConfiguredSyncApproval, planConfiguredFileSync, readOwnedFileSyncConfiguration, type SyncConditions, type SavedFileSyncConfiguration } from './configuredPlan';
import { inventorySyncEntry, parseCloudInventory } from './cloudInventory';
import { sameSyncScope, validSyncEntry, validSyncPath, type SyncScope, type SyncEntry } from './reconcile';
import type { CloudTransportRuntime } from './cloudTransport';
import type { ForegroundSyncInput } from './foregroundSync';

export const LEGACY_NATIVE_INACTIVE_MESSAGE = 'Folder access paused. Try again when the app is active.';
const WAIT_MESSAGES = { paused: 'This connection is paused.', offline: 'Waiting for an internet connection.',
	network: 'Waiting for the selected network.', wifi: 'Waiting for Wi-Fi. Connect this device to Wi-Fi to continue.',
	charging: 'Waiting for this device to charge.', inactive: 'Waiting for Thingtime to become active.',
	'data-budget': 'Waiting for the next upload data allowance.' } as const;
export type SyncWaitReason = keyof typeof WAIT_MESSAGES;
export const isSyncWaitReason = (reason: unknown): reason is SyncWaitReason =>
	typeof reason === 'string' && Object.prototype.hasOwnProperty.call(WAIT_MESSAGES, reason);
export class SyncConditionsWait extends Error {
	constructor(readonly reason: SyncWaitReason, readonly retryAt?: number, readonly minimumPartBytes?: number) {
		super(reason === 'data-budget' && minimumPartBytes !== undefined
			? `Set the hourly data allowance to at least ${minimumPartBytes.toLocaleString()} bytes for the next upload part.`
			: WAIT_MESSAGES[reason]);
	}
}

/** One live authorization policy shared by both journal formats. Saved pages,
 * reviews and receipts never replace current native/account/device approval. */
export function foregroundSyncContext(reviewed: SavedFileSyncConfiguration, scope: SyncScope, input: ForegroundSyncInput, signal: AbortSignal) {
	const configuration = parseFileSyncConfiguration(reviewed.configuration);
	if (
		['download', 'two-way'].includes(configuration.mode) &&
		(!input.localTarget || (configuration.propagateDeletes && (!input.localTarget.trash || !input.localTarget.trashExpected)))
	)
		throw Error('Downloads and two-way sync require native write approval; deletion propagation requires recoverable native Trash.');
	const approved = { ...structuredClone(reviewed), configuration, scope: { ...scope } };
	const empty = { scope, complete: true, entries: [] };
	const check = () => {
		signal.throwIfAborted();
		if (!sameSyncScope(scope, input.currentScope())) throw Error('Sync context changed.');
	};
	const authorize = async (observe?: () => Promise<SyncConditions>) => {
		check();
		if (configuration.uploadPolicy) for (const [feature, minimum] of Object.entries(FILE_SYNC_UPLOAD_POLICY_REQUIREMENTS)) await input.runtime.requireCapability(feature, minimum);
		if (configuration.photoAutomation) for (const [feature, minimum] of Object.entries(FILE_SYNC_PHOTO_AUTOMATION_REQUIREMENTS)) await input.runtime.requireCapability(feature, minimum);
		if (configuration.resourceLimits) for (const [feature, minimum] of Object.entries(FILE_SYNC_RESOURCE_REQUIREMENTS)) await input.runtime.requireCapability(feature, minimum);
		if (configuration.ignoreRules) await input.runtime.requireCapability('api.things', FILE_SYNC_IGNORE_REQUIREMENTS['api.things']);
		check();
		const current = readOwnedFileSyncConfiguration(await input.readConfiguration(), scope.ownerId);
		check();
		// A verified current pause can only deny work, including when a remote
		// settings edit changed the approved revision. Never reuse that revision.
		if (current.id === reviewed.id && current.configuration.deviceId === scope.deviceId && current.configuration.paused)
			throw new SyncConditionsWait('paused');
		if (observe) assertConfiguredSyncApproval(current, approved, scope, configuration.localRootId, configuration.remoteFolderId);
			const conditions = observe ? await observe() : input.authorizeContext ? await input.authorizeContext() : await (async () => {
			await input.authorizeDevice(); check(); return input.conditions();
		})();
		check();
		const result = planConfiguredFileSync({
			saved: current,
			approval: approved,
			local: empty,
			remote: empty,
			baseline: { scope, entries: [] },
			localRootId: configuration.localRootId,
			remoteFolderId: configuration.remoteFolderId,
			conditions
		});
		if (result.status === 'waiting') throw new SyncConditionsWait(configuration.network === 'wifi' && (result.reason === 'network' || result.reason === 'offline') ? 'wifi' : result.reason);
		return conditions;
	};
	const scanCloud = async () => {
		check();
		const inventory = parseCloudInventory(await input.inventory(), configuration.remoteFolderId);
		check();
		return inventory;
	};
	const scan = async () => {
		const entries = await input.scanLocal();
		check();
		const inventory = await scanCloud();
		return {
			local: { scope, complete: true, entries },
			remote: { scope, complete: true, entries: inventory.nodes.map(inventorySyncEntry) },
			inventory
		};
	};
	const readLocal = async (path: string) => {
		check();
		if (!validSyncPath(path)) throw Error('Invalid local sync path.');
		const entry = input.inspectLocal ? await input.inspectLocal(path) : (await input.scanLocal()).find(row => row.path === path) ?? null;
		check();
		if (entry !== null && (!validSyncEntry(entry) || entry.path !== path)) throw Error('Native path observation changed.');
		return entry === null ? null : structuredClone(entry);
	};
	const readLocalUploadSource = async (expected: SyncEntry) => {
		check();
		if (!validSyncEntry(expected) || expected.kind !== 'file' || !validSyncPath(expected.path)) throw Error('Invalid saved upload source.');
		if (!input.inspectLocalStamp || !expected.fingerprint || expected.symbolicLink) return readLocal(expected.path);
		// A matching native stamp validates the saved capture's source identity,
		// not its bytes. The canonical upload still requires its original digest
		// from uploaded bytes or a verified retained content object.
		await authorize();
		const stamp = await input.inspectLocalStamp(expected.path);
		check();
		if (stamp === null || stamp.path !== expected.path || stamp.id !== expected.id || stamp.version !== expected.version ||
			stamp.kind !== 'file' || stamp.size !== expected.size) return null;
		return structuredClone(expected);
	};
	const observeLocal = input.observeLocal ? async (path: string, parent: string) => {
		check();
		if (!validSyncPath(path) || parent !== path.split('/').slice(0, -1).join('/')) throw Error('Invalid observation paths.');
		let result: Awaited<ReturnType<NonNullable<ForegroundSyncInput['observeLocal']>>> | undefined;
		await authorize(async () => { result = await input.observeLocal!(path, parent, approved); check(); return result.conditions; });
		check();
		const paths = parent ? [path, parent] : [path];
		if (!result || result.entries.length !== paths.length || result.entries.some((entry, i) => entry !== null && (!validSyncEntry(entry) || entry.path !== paths[i]))) throw Error('Native path observation changed.');
		return structuredClone(result.entries);
	} : undefined;
	const openSource = async (entry: SyncEntry) => {
		check();
		if (!input.nativeOperationGuards) await authorize();
		check();
		const source = await input.source(entry);
		check();
		return source;
	};
	const runtime: CloudTransportRuntime = {
		...input.runtime,
		resources: input.runtime.resources ?? deviceSyncGovernor(deviceResourceKey(scope.origin, scope.ownerId, scope.deviceId), configuration.resourceLimits),
		// Custom mutation policies must remain in the shared per-part path.
		nativeUploadApproval: input.runtime.authorizeMutation ? undefined : approved,
		currentScope: input.currentScope,
		authorizeMutation: async () => {
			check();
			await input.runtime.authorizeMutation?.(signal);
			await authorize();
			check();
		},
		fetch: async (url, init) => {
			check();
			const result = await input.runtime.fetch(url, init);
			check();
			return result;
		}
	};
	const localTarget = input.localTarget ? {
		reportsTransferBytes: input.localTarget.reportsTransferBytes,
		lookup: input.localTarget.lookup.bind(input.localTarget),
		...(input.localTarget.trash ? { trash: async (...args: Parameters<NonNullable<typeof input.localTarget.trash>>) => {
			await authorize(); return input.localTarget!.trash!(...args);
		} } : {}),
		...(input.localTarget.trashExpected ? { trashExpected: async (...args: Parameters<NonNullable<typeof input.localTarget.trashExpected>>) => {
			await authorize(); return input.localTarget!.trashExpected!(...args);
		} } : {}),
		stage: async (...args: Parameters<typeof input.localTarget.stage>) => { await authorize(); return input.localTarget!.stage(...args); },
		publish: async (...args: Parameters<typeof input.localTarget.publish>) => { await authorize(); return input.localTarget!.publish(...args); }
	} : undefined;
	return { configuration, approved, check, authorize, scan, scanCloud, readLocal, readLocalUploadSource, observeLocal, openSource, runtime, localTarget };
}
