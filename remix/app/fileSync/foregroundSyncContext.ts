import { parseFileSyncConfiguration } from './configuration';
import { planConfiguredFileSync, readOwnedFileSyncConfiguration, type SavedFileSyncConfiguration } from './configuredPlan';
import { inventorySyncEntry, parseCloudInventory } from './cloudInventory';
import { sameSyncScope, validSyncEntry, validSyncPath, type SyncScope } from './reconcile';
import type { CloudTransportRuntime } from './cloudTransport';
import type { ForegroundSyncInput } from './foregroundSync';

export class SyncConditionsWait extends Error {
	constructor(readonly reason: 'paused' | 'offline' | 'network' | 'charging') {
		super({ paused: 'This connection is paused.', offline: 'Waiting for an internet connection.',
			network: 'Waiting for the selected network.', charging: 'Waiting for this device to charge.' }[reason]);
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
	const authorize = async () => {
		check();
		const current = readOwnedFileSyncConfiguration(await input.readConfiguration(), scope.ownerId);
		check();
		await input.authorizeDevice();
		check();
		const conditions = await input.conditions();
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
		if (result.status === 'waiting') throw new SyncConditionsWait(result.reason);
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
	const runtime: CloudTransportRuntime = {
		...input.runtime,
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
	return { configuration, approved, check, authorize, scan, scanCloud, readLocal, runtime, localTarget };
}
