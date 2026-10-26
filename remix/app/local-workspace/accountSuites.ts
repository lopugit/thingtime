import { ALL_SUITES } from '../schemas/appSuites';
import { suiteBundleVersion, type InstallSuiteResult } from '../schemas/suiteInstallation';
import { snapshotTransferValue } from '../utils/thingTransfer/value';
import type { AccountThingSync } from './accountSync';
import { assertAccountSuiteAdmission } from './accountSuiteReconcile';
import { installSuiteInWriter } from './suites';
import type { LocalThing } from './things';
import { WorkspaceError, workspaceScopeKey, type WorkspaceDatabase, type WorkspaceLease, type WorkspaceScope, type WorkspaceTransaction } from './storage';

type AccountScope = Extract<WorkspaceScope, { kind: 'account' }>;
export const ACCOUNT_SUITE_INSTALLS = 'account-suite-installs';
export const ACCOUNT_SUITE_PARTS = 'account-suite-parts';
export type SuiteInstallRequest = { key: string; onlyMissing: true; requestId: string; bundleVersion: string };
export type AccountSuiteIntent = {
	key: string;
	request: SuiteInstallRequest;
	local: InstallSuiteResult;
	/** Exact admission revision distinguishes untouched bundled content from
	 * subsequent local edits, including edits made while the receipt was lost. */
	baseline: LocalThing[];
	createdIds: string[];
	state: 'pending' | 'syncing' | 'error' | 'synced';
	claim?: { token: string; expiresAt: number };
	attempts: number;
	retryAt: number;
	error?: string;
	errorCode?: string;
	remote?: InstallSuiteResult;
};
export type SuitePartHold = { key: string; requestId: string };
export type AccountSuiteTransport = { install(request: Readonly<SuiteInstallRequest>, signal: AbortSignal): Promise<InstallSuiteResult> };
export type ReconcileAccountSuite = (tx: WorkspaceTransaction, intent: Readonly<AccountSuiteIntent>, remote: InstallSuiteResult) => Promise<void>;
export const installedSuiteIds = (result: InstallSuiteResult) => [
	...Object.values(result.schemaIds), ...Object.values(result.componentIds),
	...Object.values(result.actionIds), ...result.dataIds, ...Object.values(result.pageIds)
];

/** One durable intent owns provisional suite identities. Ordinary Thing
 * uploads must respect ACCOUNT_SUITE_PARTS until the canonical mapping and
 * every dependent local binding commit atomically with its acknowledgement. */
export class AccountSuiteSync {
	constructor(private db: WorkspaceDatabase, readonly scope: AccountScope, private lease: WorkspaceLease,
		private content: Pick<AccountThingSync, 'things'>, private reconcile: ReconcileAccountSuite,
		private now = () => Date.now(), private uuid = () => crypto.randomUUID()) {
		if (scope.kind !== 'account') throw new WorkspaceError('ACCOUNT_REQUIRED', 'Anonymous suites never upload', 403);
		if (workspaceScopeKey(scope) !== workspaceScopeKey(content.things.scope))
			throw new WorkspaceError('WORKSPACE_CHANGED', 'Suite content belongs to a different account workspace.', 409);
	}
	private tx<T>(mode: IDBTransactionMode, run: (tx: WorkspaceTransaction) => Promise<T>) {
		return this.db.transaction(this.scope, mode, this.lease, run);
	}
	async install(key: string): Promise<InstallSuiteResult> {
		this.lease.assertCurrent();
		const suite = ALL_SUITES.find(suite => suite.key === key);
		if (!suite) throw new WorkspaceError('NOT_FOUND', 'This suite is not in the bundled catalogue', 404);
		const bundleVersion = await suiteBundleVersion(suite);
		this.lease.assertCurrent();
		return this.content.things.atomic(async writer => {
			const previous = await writer.tx.get<AccountSuiteIntent>(ACCOUNT_SUITE_INSTALLS, key);
			if (previous) return previous.local;
			const before = new Set((await writer.snapshot()).map(row => row.id));
			// An incomplete cache cannot establish that a missing definition is
			// absent remotely. Materialize without refreshing cached user content.
			const local = await installSuiteInWriter(writer, key, { onlyMissing: true });
			const ids = new Set(installedSuiteIds(local));
			const baseline = (await writer.snapshot()).filter(row => ids.has(row.id));
			if (baseline.length !== ids.size) throw new WorkspaceError('SUITE_CONTENT_MISSING', 'The local suite graph is incomplete.', 409);
			await assertAccountSuiteAdmission(writer.tx, ids);
			const request: SuiteInstallRequest = { key, onlyMissing: true, requestId: this.uuid(), bundleVersion };
			for (const row of baseline) {
				const state = await writer.tx.get<{ base?: unknown; pending?: unknown; claim?: unknown }>('thing-sync', row.id);
				if (!state) throw new WorkspaceError('SYNC_BASE_MISSING', 'Suite content requires the account sync adapter.', 409);
				// Never reinterpret an already frozen ordinary create as a suite
				// operation: its outcome could be uncertain in another tab.
				if (state.pending || state.claim) throw new WorkspaceError('SUITE_WRITE_IN_FLIGHT', 'A matching device definition is still syncing. Its original operation must finish before suite installation.', 409);
				const held = await writer.tx.get<SuitePartHold>(ACCOUNT_SUITE_PARTS, row.id);
				if (held && held.key !== key) throw new WorkspaceError('SUITE_IDENTITY_CONFLICT', 'A different suite is resolving this definition.', 409);
				await writer.tx.put(ACCOUNT_SUITE_PARTS, row.id, { key, requestId: request.requestId } satisfies SuitePartHold);
			}
			await writer.tx.put(ACCOUNT_SUITE_INSTALLS, key, {
				key, request, local, baseline, createdIds: baseline.filter(row => !before.has(row.id)).map(row => row.id),
				state: 'pending', attempts: 0, retryAt: 0
			} satisfies AccountSuiteIntent);
			return local;
		});
	}
	async status() {
		return this.tx('readonly', async tx => (await tx.list<AccountSuiteIntent>(ACCOUNT_SUITE_INSTALLS)).map(({ value }) => ({
			id: value.key, state: value.state, retryAt: value.retryAt, attempts: value.attempts, error: value.error, errorCode: value.errorCode
		})));
	}
	async retry(key: string) {
		return this.tx('readwrite', async tx => {
			const value = await tx.get<AccountSuiteIntent>(ACCOUNT_SUITE_INSTALLS, key);
			if (value?.errorCode === 'SUITE_BUNDLE_CHANGED') throw new WorkspaceError(value.errorCode, value.error!, 409);
			if (value && value.state !== 'synced') await tx.put(ACCOUNT_SUITE_INSTALLS, key, { ...value, state: 'pending', retryAt: 0, error: undefined, errorCode: undefined });
		});
	}
	private validate(intent: AccountSuiteIntent, remote: InstallSuiteResult) {
		const receipt = remote?.receipt;
		if (!remote?.ok || remote.suite !== intent.key || !receipt || receipt.requestId !== intent.request.requestId ||
			receipt.ownerId !== this.scope.ownerId || receipt.origin !== this.scope.origin || receipt.dataPlane !== this.scope.dataPlane ||
			receipt.bundleVersion !== intent.request.bundleVersion || !Array.isArray(receipt.snapshots))
			throw new WorkspaceError('INVALID_SUITE_RECEIPT', 'The suite receipt does not match this account workspace and operation.', 502);
		for (const group of ['schemaIds', 'componentIds', 'actionIds', 'pageIds'] as const)
			if (!remote[group] || JSON.stringify(Object.keys(remote[group]).sort()) !== JSON.stringify(Object.keys(intent.local[group]).sort()))
				throw new WorkspaceError('INVALID_SUITE_RECEIPT', 'The suite receipt has an incomplete definition mapping.', 502);
		if (!Array.isArray(remote.dataIds) || remote.dataIds.length !== intent.local.dataIds.length)
			throw new WorkspaceError('INVALID_SUITE_RECEIPT', 'The suite receipt has an incomplete sample mapping.', 502);
		const ids = installedSuiteIds(remote);
		if (ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length ||
			!Object.values(remote.pageIds).includes(remote.entryPageId) || remote.entryPageKey !== intent.local.entryPageKey ||
			receipt.snapshots.length !== ids.length || new Set(receipt.snapshots.map(row => row?.id)).size !== ids.length ||
			receipt.snapshots.some(row => !ids.includes(row?.id) || row.author?.id !== this.scope.ownerId))
			throw new WorkspaceError('INVALID_SUITE_RECEIPT', 'The suite receipt does not contain the exact owned graph.', 502);
		// Owner projections may contain hidden-link bearer keys or grant
		// metadata. The durable suite journal retains only sync content and its
		// verified audience; it is never a credential or authority cache.
		const snapshots = receipt.snapshots.map(row => ({
			id: row.id, thingtime: row.thingtime, crystal: row.crystal, extended: row.extended ?? null,
			tags: row.tags || [], folderId: row.folderId || null, targetId: row.targetId || null,
			author: { id: this.scope.ownerId }, acl: row.acl, visibility: row.visibility,
			createdAt: row.createdAt, updatedAt: row.updatedAt
		}));
		return snapshotTransferValue({
			ok: true, suite: remote.suite, title: remote.title, created: remote.created, updated: remote.updated,
			schemaIds: remote.schemaIds, componentIds: remote.componentIds, actionIds: remote.actionIds,
			pageIds: remote.pageIds, dataIds: remote.dataIds, entryPageId: remote.entryPageId, entryPageKey: remote.entryPageKey,
			receipt: { requestId: receipt.requestId, ownerId: receipt.ownerId, origin: receipt.origin,
				dataPlane: receipt.dataPlane, bundleVersion: receipt.bundleVersion, snapshots }
		}) as InstallSuiteResult;
	}
	async sync(transport: AccountSuiteTransport, signal = new AbortController().signal) {
		let completed = 0;
		// A finite batch permits independent queues and later wakeups to run.
		for (let count = 0; count < 5; count++) {
			this.lease.assertCurrent(); signal.throwIfAborted();
			const intent = await this.tx('readwrite', async tx => {
				const value = (await tx.list<AccountSuiteIntent>(ACCOUNT_SUITE_INSTALLS)).map(row => row.value).find(row =>
					['pending', 'syncing'].includes(row.state) && row.retryAt <= this.now() && (!row.claim || row.claim.expiresAt <= this.now()));
				if (!value) return null;
				const claimed: AccountSuiteIntent = { ...value, state: 'syncing', claim: { token: this.uuid(), expiresAt: this.now() + 60_000 } };
				await tx.put(ACCOUNT_SUITE_INSTALLS, value.key, claimed);
				return claimed;
			});
			if (!intent) break;
			const retired = new AbortController(), off = this.lease.onInvalidate(() => retired.abort());
			const child = AbortSignal.any([signal, retired.signal, AbortSignal.timeout(45_000)]);
			try {
				const raw = snapshotTransferValue(intent.request);
				if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.onlyMissing !== true || raw.key !== intent.key ||
					typeof raw.key !== 'string' || typeof raw.requestId !== 'string' || !raw.requestId || typeof raw.bundleVersion !== 'string' || !raw.bundleVersion ||
					Object.keys(raw).some(key => !['key', 'onlyMissing', 'requestId', 'bundleVersion'].includes(key)))
					throw new WorkspaceError('INVALID_SUITE_REQUEST', 'The saved suite request is invalid. Its device content is preserved for recovery.', 400);
				const request: Readonly<SuiteInstallRequest> = Object.freeze({ key: raw.key, onlyMissing: true, requestId: raw.requestId, bundleVersion: raw.bundleVersion });
				const remote = this.validate(intent, intent.remote || await transport.install(request, child));
				this.lease.assertCurrent(); child.throwIfAborted();
				// Retain a validated receipt before reconciliation. A quota failure
				// or tab crash cannot turn its retry into a new server installation.
				await this.tx('readwrite', async tx => {
					const latest = await tx.get<AccountSuiteIntent>(ACCOUNT_SUITE_INSTALLS, intent.key);
					if (latest?.claim?.token === intent.claim!.token) await tx.put(ACCOUNT_SUITE_INSTALLS, intent.key, { ...latest, remote });
				});
				const acknowledged = await this.tx('readwrite', async tx => {
					const latest = await tx.get<AccountSuiteIntent>(ACCOUNT_SUITE_INSTALLS, intent.key);
					if (latest?.claim?.token !== intent.claim!.token) return false;
					await this.reconcile(tx, latest, remote);
					for (const id of installedSuiteIds(latest.local)) {
						const held = await tx.get<SuitePartHold>(ACCOUNT_SUITE_PARTS, id);
						if (held?.requestId === latest.request.requestId) await tx.delete(ACCOUNT_SUITE_PARTS, id);
					}
					await tx.put(ACCOUNT_SUITE_INSTALLS, intent.key, { ...latest, local: remote, remote, state: 'synced', claim: undefined, attempts: 0, retryAt: 0, error: undefined, errorCode: undefined });
					return true;
				});
				if (acknowledged) completed++;
			} catch (error) {
				this.lease.assertCurrent();
				await this.tx('readwrite', async tx => {
					const latest = await tx.get<AccountSuiteIntent>(ACCOUNT_SUITE_INSTALLS, intent.key);
					if (latest?.claim?.token !== intent.claim!.token) return;
					const status = Number((error as { status?: number })?.status), refused = [400, 401, 403, 404, 409, 410, 413, 422, 507].includes(status);
					const safe = error instanceof WorkspaceError && ['SUITE_RECONCILE_CONFLICT', 'SUITE_IDENTITY_CONFLICT', 'SUITE_WRITE_IN_FLIGHT',
						'SUITE_BUNDLE_CHANGED', 'INVALID_SUITE_REQUEST', 'INVALID_SUITE_RECEIPT', 'SYNC_IDENTITY', 'INVALID_SYNC_THING', 'INVALID_AUDIENCE', 'LOCAL_QUOTA'].includes(error.code);
					await tx.put(ACCOUNT_SUITE_INSTALLS, intent.key, { ...latest, state: refused ? 'error' : 'pending', claim: undefined,
						attempts: latest.attempts + 1, retryAt: this.now() + Math.min(60_000, 1000 * 2 ** Math.min(latest.attempts, 6)),
						errorCode: safe ? error.code : undefined,
						error: safe ? error.message : refused ? 'Account suite sync was refused. Reconnect and retry after account access is restored. Your editable device suite is preserved.' : 'Suite saved on this device; waiting to sync.' });
				});
				break;
			} finally { off(); }
		}
		return { completed };
	}
}
