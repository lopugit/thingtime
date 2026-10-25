import { recoveredProtectedRow } from './protectedRecovery';
import { captureThingChanges } from './thingChanges';
import { recordLocalThingChanges, type LocalMutationCapture } from './timeline';
import { normalizeSavedTheme } from '../theme/savedTheme';
import { snapshotTransferValue } from '../utils/thingTransfer/value';
import { isTransferTheme } from '../utils/thingTransfer/theme';
import type { LocalThing } from './things';
import type { LocalVersionUpdateWriter } from './timelineVersions';
import { type WorkspaceDatabase, WorkspaceError, type WorkspaceLease, type WorkspaceTransaction, type WorkspaceScope } from './storage';

export type LocalThemeInput = { id?: string; name?: unknown; theme?: unknown; visibility?: unknown; expectedUpdatedAt?: string };
export type LocalThemeOptions = {
	scope?: WorkspaceScope;
	now?: () => number;
	uuid?: () => string;
	onWrite?(
		tx: WorkspaceTransaction,
		row: LocalThing | null,
		previous: LocalThing | null,
		input?: LocalThemeInput,
		capture?: LocalMutationCapture
	): Promise<void>;
	onActive?(tx: WorkspaceTransaction, id: string | null): Promise<void>;
};
const project = (row: LocalThing) => ({
	id: row.id,
	name: row.crystal.name,
	theme: row.crystal.theme,
	visibility: 'private' as const,
	localOnly: true,
	createdAt: row.createdAt,
	updatedAt: row.updatedAt
});

/** Dedicated theme writer. Generic Thing mutations still reject protected kinds. */
export class LocalThemes {
	readonly scope: WorkspaceScope;
	constructor(private db: WorkspaceDatabase, private lease: WorkspaceLease, private options: LocalThemeOptions = {}) {
		this.scope = options.scope ?? { kind: 'anonymous' };
	}
	private transaction<T>(
		mode: IDBTransactionMode,
		run: (tx: WorkspaceTransaction) => Promise<T>,
		captures?: Map<string, LocalMutationCapture>,
		signal?: AbortSignal
	) {
		const lease: WorkspaceLease = signal
			? {
					assertCurrent: () => {
						this.lease.assertCurrent();
						signal.throwIfAborted();
					},
					onInvalidate: (cb) => {
						const off = this.lease.onInvalidate(cb);
						signal.addEventListener('abort', cb, { once: true });
						return () => {
							off();
							signal.removeEventListener('abort', cb);
						};
					}
			  }
			: this.lease;
		return this.db.transaction(this.scope, mode, lease, (tx) => {
			if (mode !== 'readwrite' || this.scope.kind !== 'anonymous') return run(tx);
			return captureThingChanges(tx, run, (transaction, changes) =>
				recordLocalThingChanges(
					transaction,
					changes,
					() => new Date(this.options.now?.() ?? Date.now()).toISOString(),
					this.options.uuid ?? (() => crypto.randomUUID()),
					captures
				)
			);
		});
	}
	private async read(tx: WorkspaceTransaction, id: string) {
		const row = await tx.get<LocalThing>('things', id);
		if (!row || !isTransferTheme(row)) throw new WorkspaceError('NOT_FOUND', 'Theme is not in this workspace', 404);
		return row;
	}
	async list() {
		return this.transaction('readonly', async (tx) => ({
			ok: true,
			themes: (await tx.list<LocalThing>('things'))
				.map((row) => row.value)
				.filter(isTransferTheme)
				.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
				.map(project),
			activeThemeId: (await tx.get<string>('settings', 'active-theme')) || null
		}));
	}
	async get(id: string) {
		return this.transaction('readonly', async (tx) => ({ ok: true, theme: project(await this.read(tx, id)) }));
	}
	async save(input: LocalThemeInput) {
		return this.transaction('readwrite', (tx) => this.saveIn(tx, input));
	}
	/** History supplies design content only; current sharing and organization
	 * remain owned by the dedicated theme writer. Captures are never public input. */
	async versionTransaction<T>(run: (writer: LocalVersionUpdateWriter) => Promise<T>, signal?: AbortSignal): Promise<T> {
		const captures = new Map<string, LocalMutationCapture>();
		return this.transaction(
			'readwrite',
			(tx) =>
				run({
					tx,
					update: async (input, capture) => {
						captures.set(input.id, capture);
						return this.saveIn(
							tx,
							{ id: input.id, name: input.crystal.name, theme: input.crystal.theme, expectedUpdatedAt: input.expectedUpdatedAt },
							capture
						);
					},
					recover: async (input, id, capture) => {
						const row = await recoveredProtectedRow(tx, this.scope, id, input, 'theme', new Date(this.options.now?.() ?? Date.now()).toISOString());
						const normalized = normalizeSavedTheme({ name: row.crystal.name, theme: row.crystal.theme });
						if (!normalized.ok) throw new WorkspaceError('INVALID_THEME', normalized.error, normalized.status);
						captures.set(id, capture);
						await tx.put('things', id, row);
						await this.options.onWrite?.(tx, row, null, { visibility: 'private' }, capture);
						return { ok: true, theme: project(row) };
					}
				}),
			captures,
			signal
		);
	}
	private async saveIn(tx: WorkspaceTransaction, input: LocalThemeInput, capture?: LocalMutationCapture) {
		if (this.scope.kind === 'anonymous' && input.visibility === 'public')
			throw new WorkspaceError('REMOTE_ACCOUNT_REQUIRED', 'Local themes stay on this device. Sign in to publish a separate account copy.', 401);
		const result = normalizeSavedTheme({ name: input.name, theme: snapshotTransferValue(input.theme ?? null) });
		if (!result.ok) throw new WorkspaceError('INVALID_THEME', result.error, result.status);
		const previous = input.id ? await this.read(tx, input.id) : null;
		if (previous && input.expectedUpdatedAt && previous.updatedAt !== input.expectedUpdatedAt)
			throw new WorkspaceError('WRITE_CONFLICT', 'This theme changed in another editor. Reload it before saving.', 409);
		const now = new Date(Math.max(this.options.now?.() ?? Date.now(), previous ? Date.parse(previous.updatedAt) + 1 : 0)).toISOString();
		const row: LocalThing = {
			...previous,
			id: previous?.id || `${this.scope.kind === 'anonymous' ? 'local-' : ''}${this.options.uuid?.() ?? crypto.randomUUID()}`,
			thingtime: ['theme'],
			crystal: snapshotTransferValue({ ...previous?.crystal, name: result.name, theme: result.theme }) as LocalThing['crystal'],
			createdAt: previous?.createdAt || now,
			updatedAt: now,
			revision: (previous?.revision || 0) + 1
		};
		await tx.put('things', row.id, row);
		await this.options.onWrite?.(tx, row, previous, input, capture);
		return { ok: true, theme: project(row) };
	}
	async setActive(themeId: string | null) {
		return this.transaction('readwrite', async (tx) => {
			if (themeId) {
				await this.read(tx, themeId);
				await tx.put('settings', 'active-theme', themeId);
			} else await tx.delete('settings', 'active-theme');
			await this.options.onActive?.(tx, themeId);
			return { ok: true, activeThemeId: themeId };
		});
	}
	async remove(id: string) {
		return this.transaction('readwrite', (tx) => this.removeIn(tx, id));
	}
	/** Shared with atomic account library batches. */
	async removeIn(tx: WorkspaceTransaction, id: string) {
		this.lease.assertCurrent();
		const previous = await this.read(tx, id);
		if ((await tx.list<LocalThing>('things')).some((row) => row.value.targetId === id || row.value.folderId === id))
			throw new WorkspaceError('HAS_CHILDREN', 'Remove the theme’s related local Things before deleting it.');
		await tx.delete('things', id);
		if ((await tx.get('settings', 'active-theme')) === id) {
			await tx.delete('settings', 'active-theme');
			await this.options.onActive?.(tx, null);
		}
		await this.options.onWrite?.(tx, null, previous);
		return { ok: true };
	}
}
