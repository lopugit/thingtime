import { AccountThemeSelection } from './themeSelection';
import { LocalThemes, type LocalThemeInput } from './themes';
import type { LocalThing } from './things';
import { WorkspaceError, type WorkspaceDatabase, type WorkspaceLease, type WorkspaceScope, type WorkspaceTransaction } from './storage';
import {
	parseThemeWrite,
	parseThemeWriteAcknowledgment,
	validThemeVersion,
	type ThemeWrite,
	type ThemeWriteAcknowledgment
} from '../api/utils/themes/themeSyncContract';
import { normalizeSavedTheme, MAX_SAVED_THEMES } from '../theme/savedTheme';
import { copyBoundedJson } from '../utils/boundedJson';
import { accountSyncDeadline, type SyncState } from './accountSync';
import { isTransferTheme } from '../utils/thingTransfer/theme';

type Scope = Extract<WorkspaceScope, { kind: 'account' }>;
export type AccountThemeSnapshot = {
	id: string;
	name: string;
	theme: Record<string, unknown>;
	visibility: 'private' | 'public';
	folderId: string | null;
	version: string;
	createdAt: string;
	updatedAt: string;
};
export type AccountThemeTransport = {
	snapshot(signal: AbortSignal): Promise<AccountThemeSnapshot[]>;
	write(command: ThemeWrite, signal: AbortSignal): Promise<ThemeWriteAcknowledgment>;
};
type State = {
	id: string;
	revision: number;
	base: AccountThemeSnapshot | null;
	baseVersion: string | null;
	visibility: 'private' | 'public';
	state: SyncState;
	deleted: boolean;
	placementKnown?: boolean;
	pending?: { command: ThemeWrite; revision: number };
	claim?: { token: string; expiresAt: number };
	retryAt: number;
	attempts: number;
	error?: string;
};
const collection = 'account-theme-sync',
	catalogKey = 'account-theme-catalog';
type Catalog = { epoch: number; read: number; complete: boolean };
const blankCatalog = (): Catalog => ({ epoch: 0, read: 0, complete: false });
const fail = (message: string, code = 'THEME_SYNC_CONFLICT', status = 409): never => {
	throw new WorkspaceError(code, message, status);
};
const stable = (value: unknown) =>
	JSON.stringify(copyBoundedJson(value, { maxBytes: 8 * 1024 * 1024, maxDepth: 12, maxNodes: 250_000, sortKeys: true }));

/** Validate a complete catalogue before a transaction can infer a removal. */
export function parseAccountThemeSnapshot(input: unknown): AccountThemeSnapshot[] {
	const rows = copyBoundedJson(input, { maxBytes: 8 * 1024 * 1024, maxDepth: 12, maxNodes: 250_000 });
	if (!Array.isArray(rows) || rows.length > MAX_SAVED_THEMES) return fail('Invalid account theme catalogue.', 'INVALID_THEME_SNAPSHOT', 502);
	const seen = new Set<string>();
	return rows.map((raw) => {
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('Invalid account theme.', 'INVALID_THEME_SNAPSHOT', 502);
		const row = raw as Record<string, any>,
			normalized = normalizeSavedTheme({ name: row.name, theme: row.theme });
		if (
			typeof row.id !== 'string' ||
			!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(row.id) ||
			row.id.startsWith('timeline-') ||
			seen.has(row.id) ||
			!validThemeVersion(row.version) ||
			!normalized.ok ||
			!['private', 'public'].includes(row.visibility) ||
			(row.folderId !== null && (typeof row.folderId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(row.folderId))) ||
			typeof row.createdAt !== 'string' ||
			!Number.isFinite(Date.parse(row.createdAt)) ||
			typeof row.updatedAt !== 'string' ||
			!Number.isFinite(Date.parse(row.updatedAt))
		)
			return fail('Invalid account theme.', 'INVALID_THEME_SNAPSHOT', 502);
		seen.add(row.id);
		return {
			id: row.id,
			version: row.version,
			name: normalized.name,
			theme: normalized.theme as unknown as Record<string, unknown>,
			visibility: row.visibility,
			folderId: row.folderId,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt
		};
	});
}

/** Device edits use the same local theme writer as anonymous workspaces. This
 * account-only adapter adds scoped retry metadata, never a second content store. */
export class AccountThemeSync {
	readonly themes: LocalThemes;
	readonly selection: AccountThemeSelection;
	constructor(
		private db: WorkspaceDatabase,
		readonly scope: Scope,
		private lease: WorkspaceLease,
		private now = () => Date.now(),
		private uuid = () => crypto.randomUUID()
	) {
		if (scope.kind !== 'account') throw new WorkspaceError('ACCOUNT_REQUIRED', 'Anonymous themes never synchronize.', 403);
		this.selection = new AccountThemeSelection(db, scope, lease, now, uuid);
		this.themes = new LocalThemes(db, lease, {
			scope,
			now,
			uuid,
			onWrite: (tx, row, previous, input) => this.mutated(tx, row, previous, input),
			onActive: async (tx, id) => {
				await this.selection.setIn(tx, id);
				await this.bump(tx);
			}
		});
	}
	private tx<T>(mode: IDBTransactionMode, run: (tx: WorkspaceTransaction) => Promise<T>, signal?: AbortSignal) {
		const lease: WorkspaceLease = signal
			? {
					assertCurrent: () => {
						this.lease.assertCurrent();
						signal.throwIfAborted();
					},
					onInvalidate: (callback) => {
						const off = this.lease.onInvalidate(callback);
						signal.addEventListener('abort', callback, { once: true });
						return () => {
							off();
							signal.removeEventListener('abort', callback);
						};
					}
			  }
			: this.lease;
		return this.db.transaction(this.scope, mode, lease, run);
	}
	private async bump(tx: WorkspaceTransaction) {
		const catalog = (await tx.get<Catalog>('settings', catalogKey)) ?? blankCatalog();
		await tx.put('settings', catalogKey, { ...catalog, epoch: catalog.epoch + 1 });
	}
	private async mutated(tx: WorkspaceTransaction, row: LocalThing | null, previous: LocalThing | null, input?: LocalThemeInput) {
		const id = row?.id ?? previous!.id,
			old = await tx.get<State>(collection, id);
		if (previous && !old) return fail('Refresh this account theme before editing it.');
		if (!row && old?.baseVersion === null && !old.pending) {
			await tx.delete(collection, id);
			await this.bump(tx);
			return;
		}
		if (input?.visibility !== undefined && !['private', 'public'].includes(String(input.visibility)))
			return fail('Invalid theme visibility.', 'INVALID_THEME', 400);
		const state: State = {
			id,
			revision: (old?.revision ?? 0) + 1,
			base: old?.base ?? null,
			baseVersion: old?.baseVersion ?? null,
			visibility: (input?.visibility as State['visibility']) ?? old?.visibility ?? 'private',
			state: old?.state === 'conflict' || old?.state === 'error' ? old.state : 'pending',
			deleted: !row,
			placementKnown: old?.placementKnown ?? (!old?.base || old.base.folderId !== undefined),
			pending: old?.pending,
			claim: old?.claim,
			attempts: old?.attempts ?? 0,
			retryAt: old?.retryAt ?? 0,
			error: old?.error
		};
		await tx.put(collection, id, state);
		await this.bump(tx);
	}
	async list() {
		return this.tx('readonly', async (tx) => {
			const states = new Map((await tx.list<State>(collection)).map(({ id, value }) => [id, value]));
			const themes = (await tx.list<LocalThing>('things'))
				.filter(({ value }) => isTransferTheme(value))
				.map(({ value }) => {
					const state = states.get(value.id);
					return {
						id: value.id,
						name: value.crystal.name,
						theme: value.crystal.theme,
						visibility: state?.visibility ?? 'private',
						createdAt: value.createdAt,
						updatedAt: value.updatedAt,
						localOnly: false,
						localSaved: true,
						syncState: state?.state ?? 'error',
						syncError: state?.error
					};
				})
				.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
			return {
				ok: true,
				themes,
				activeThemeId: (await tx.get<string>('settings', 'active-theme')) ?? null,
				complete: (await tx.get<Catalog>('settings', catalogKey))?.complete === true
			};
		});
	}
	async save(input: LocalThemeInput) {
		const result = await this.themes.save(input);
		return { ok: true, theme: (await this.list()).themes.find((row) => row.id === result.theme.id)! };
	}
	remove(id: string) {
		return this.themes.remove(id);
	}
	setActive(id: string | null) {
		return this.themes.setActive(id);
	}
	async status() {
		return this.tx('readonly', async (tx) => (await tx.list<State>(collection)).map(({ value }) => value));
	}
	/** Only the dedicated owned state admits a portable theme. The generic
	 * exporter may compose these rows with other retained content, but cannot
	 * turn an arbitrary protected cache row into export authority. */
	async exportSnapshot() {
		return this.tx('readonly', async (tx) => {
			const states = (await tx.list<State>(collection)).map((row) => row.value);
			const things: LocalThing[] = [];
			for (const state of states) {
				if (state.deleted) continue;
				const row = await tx.get<LocalThing>('things', state.id);
				if (!row || !isTransferTheme(row)) return fail('Retained theme content is incomplete.', 'LOCAL_THEME_INCOMPLETE');
				things.push({
					id: row.id,
					thingtime: ['theme'],
					crystal: { name: row.crystal.name, theme: row.crystal.theme },
					...(row.folderId ? { folderId: row.folderId } : {}),
					createdAt: row.createdAt,
					updatedAt: row.updatedAt,
					revision: row.revision
				});
			}
			return {
				things,
				records: states.map((state) => ({
					id: state.id,
					state: state.state,
					remote: state.baseVersion !== null,
					deleted: state.deleted,
					complete: state.placementKnown === true || (!!state.base && state.base.folderId !== undefined)
				}))
			};
		});
	}
	async assertExportReadable(ids: Iterable<string>) {
		return this.tx('readonly', async (tx) => {
			for (const id of ids) {
				const state = await tx.get<State>(collection, id),
					row = await tx.get<LocalThing>('things', id);
				if (!state || state.deleted || !row || !isTransferTheme(row))
					return fail('This theme is no longer available for export.', 'EXPORT_ACCESS_REFUSED');
			}
		});
	}
	async beginRead() {
		return this.tx('readwrite', async (tx) => {
			const old = (await tx.get<Catalog>('settings', catalogKey)) ?? blankCatalog();
			const next = { ...old, read: old.read + 1 };
			await tx.put('settings', catalogKey, next);
			return { read: next.read, epoch: next.epoch };
		});
	}
	private async install(tx: WorkspaceTransaction, remote: AccountThemeSnapshot, old?: State) {
		const row = await tx.get<LocalThing>('things', remote.id);
		if (row && (!isTransferTheme(row) || !old)) return fail('Account theme identity collides with another device Thing.');
		const next: LocalThing = {
			...row,
			id: remote.id,
			thingtime: ['theme'],
			crystal: { ...row?.crystal, name: remote.name, theme: remote.theme as any },
			folderId: remote.folderId,
			createdAt: row?.createdAt ?? remote.createdAt,
			updatedAt: new Date(Math.max(Date.parse(remote.updatedAt), row ? Date.parse(row.updatedAt) + 1 : 0)).toISOString(),
			revision: (row?.revision ?? 0) + 1
		};
		await tx.put('things', remote.id, next);
		await tx.put(collection, remote.id, {
			id: remote.id,
			revision: (old?.revision ?? 0) + 1,
			base: remote,
			placementKnown: true,
			baseVersion: remote.version,
			visibility: remote.visibility,
			state: 'synced',
			deleted: false,
			retryAt: 0,
			attempts: 0
		} satisfies State);
	}
	async remember(input: unknown, ticket: { read: number; epoch: number }, signal?: AbortSignal) {
		const remote = parseAccountThemeSnapshot(input);
		return this.tx(
			'readwrite',
			async (tx) => {
				const catalog = (await tx.get<Catalog>('settings', catalogKey)) ?? blankCatalog();
				if (catalog.read !== ticket.read || catalog.epoch !== ticket.epoch) return false;
				const states = new Map((await tx.list<State>(collection)).map(({ id, value }) => [id, value]));
				const present = new Set(remote.map((row) => row.id));
				const dependents = new Set((await tx.list<LocalThing>('things')).flatMap(({ value }) => [value.folderId, value.targetId].filter(Boolean)));
				for (const row of remote) {
					const old = states.get(row.id);
					if (!old || old.state === 'synced') {
						if (!old || old.baseVersion !== row.version || !old.placementKnown) await this.install(tx, row, old);
					} else if (old.baseVersion === row.version && !old.placementKnown) {
						// Upgrade retained metadata without replacing a pending device edit.
						const local = await tx.get<LocalThing>('things', row.id);
						if (local && isTransferTheme(local)) {
							await tx.put('things', row.id, { ...local, folderId: row.folderId, revision: local.revision + 1 });
							await tx.put(collection, row.id, { ...old, base: row, placementKnown: true });
						}
					}
				}
				for (const [id, state] of states)
					if (!present.has(id) && state.state === 'synced') {
						if (dependents.has(id)) {
							await tx.put(collection, id, {
								...state,
								state: 'conflict',
								revision: state.revision + 1,
								error: 'The account theme was removed. Review its related device Things before discarding the retained copy.'
							});
							continue;
						}
						await tx.delete('things', id);
						await tx.delete(collection, id);
						if ((await tx.get('settings', 'active-theme')) === id) await tx.delete('settings', 'active-theme');
					}
				if ((await tx.list<LocalThing>('things')).filter(({ value }) => isTransferTheme(value)).length > MAX_SAVED_THEMES)
					return fail('Retaining this catalogue exceeds the device theme limit. Device changes are preserved.', 'LOCAL_QUOTA', 413);
				await tx.put('settings', catalogKey, { ...catalog, complete: true, epoch: catalog.epoch + 1 });
				return true;
			},
			signal
		);
	}
	async refresh(transport: AccountThemeTransport, signal = new AbortController().signal) {
		const ticket = await this.beginRead();
		const remote = await accountSyncDeadline((s) => transport.snapshot(s), signal);
		this.lease.assertCurrent();
		signal.throwIfAborted();
		return this.remember(remote, ticket, signal);
	}
	async sync(transport: AccountThemeTransport, signal = new AbortController().signal, maxWrites = 25) {
		let completed = 0;
		for (let i = 0; i < Math.min(100, maxWrites) && !signal.aborted; i++) {
			const claimed = await this.tx('readwrite', async (tx) => {
				for (const { value: row } of await tx.list<State>(collection)) {
					if (!['pending', 'syncing'].includes(row.state) || row.retryAt > this.now() || (row.claim && row.claim.expiresAt > this.now())) continue;
					let pending = row.pending;
					if (!pending) {
						const thing = await tx.get<LocalThing>('things', row.id);
						const common = { id: row.id, writeId: this.uuid(), expectedVersion: row.baseVersion };
						const command = parseThemeWrite(
							row.deleted
								? { ...common, action: 'delete' }
								: { ...common, action: 'save', name: thing?.crystal.name, theme: thing?.crystal.theme, visibility: row.visibility }
						);
						pending = { command, revision: row.revision };
					}
					const next = { ...row, pending, state: 'syncing' as const, claim: { token: this.uuid(), expiresAt: this.now() + 60_000 } };
					await tx.put(collection, row.id, next);
					return next;
				}
				return null;
			});
			if (!claimed) break;
			const controller = new AbortController(),
				off = this.lease.onInvalidate(() => controller.abort()),
				abort = () => controller.abort();
			signal.addEventListener('abort', abort, { once: true });
			if (signal.aborted) abort();
			try {
				const command = claimed.pending!.command,
					acknowledgment = parseThemeWriteAcknowledgment(await accountSyncDeadline((s) => transport.write(command, s), controller.signal));
				if (
					acknowledgment.id !== command.id ||
					acknowledgment.writeId !== command.writeId ||
					acknowledgment.action !== command.action ||
					acknowledgment.expectedVersion !== command.expectedVersion
				)
					return fail('Theme acknowledgment does not match the saved operation.', 'INVALID_THEME_ACK', 502);
				await this.tx('readwrite', async (tx) => {
					const row = await tx.get<State>(collection, claimed.id);
					if (row?.claim?.token !== claimed.claim!.token) return;
					if (command.action === 'delete' && row.deleted && row.revision === claimed.pending!.revision) {
						await tx.delete(collection, row.id);
						await this.bump(tx);
						return;
					}
					await tx.put(collection, row.id, {
						...row,
						baseVersion: acknowledgment.resultVersion,
						pending: undefined,
						claim: undefined,
						state: row.revision === claimed.pending!.revision ? 'synced' : 'pending',
						attempts: 0,
						retryAt: 0,
						error: undefined
					});
					await this.bump(tx);
				});
				completed++;
			} catch (error) {
				this.lease.assertCurrent();
				await this.tx('readwrite', async (tx) => {
					const row = await tx.get<State>(collection, claimed.id);
					if (row?.claim?.token !== claimed.claim!.token) return;
					const status = Number((error as any)?.status),
						state: SyncState =
							status === 409 && !['WORKSPACE_CHANGED', 'ACCOUNT_UNCONFIRMED'].includes((error as any)?.code)
								? 'conflict'
								: [400, 401, 403, 404, 410, 413, 422].includes(status)
								? 'error'
								: 'pending';
					await tx.put(collection, row.id, {
						...row,
						claim: undefined,
						state,
						attempts: row.attempts + 1,
						retryAt:
							this.now() +
							Math.max(Math.min(60_000, 1000 * 2 ** Math.min(row.attempts, 6)), Math.min(86_400_000, Number((error as any)?.retryAfterMs) || 0)),
						error:
							state === 'conflict'
								? 'Account theme changed. Review before synchronizing.'
								: state === 'error'
								? 'Account save was refused. Device changes are preserved.'
								: 'Saved on this device; waiting to synchronize.'
					});
				});
				break;
			} finally {
				off();
				signal.removeEventListener('abort', abort);
			}
		}
		return { completed };
	}
	async retry(id: string) {
		return this.tx('readwrite', async (tx) => {
			const row = await tx.get<State>(collection, id);
			if (!row) return;
			if (row.state === 'conflict') return fail('Review the changed account theme before retrying.');
			if (row.claim && row.claim.expiresAt > this.now()) return;
			await tx.put(collection, id, { ...row, state: 'pending', retryAt: 0, error: undefined });
		});
	}
	async inspect(id: string, transport: AccountThemeTransport, signal = new AbortController().signal) {
		const remote = parseAccountThemeSnapshot(await accountSyncDeadline((s) => transport.snapshot(s), signal)).find((row) => row.id === id) ?? null;
		return this.tx(
			'readonly',
			async (tx) => {
				const state = await tx.get<State>(collection, id);
				if (!state || !['conflict', 'error'].includes(state.state) || state.claim) return fail('Theme is not ready for conflict review.');
				return { id, revision: state.revision, remote, local: (await tx.get<LocalThing>('things', id)) ?? null, visibility: state.visibility };
			},
			signal
		);
	}
	async resolve(
		review: Awaited<ReturnType<AccountThemeSync['inspect']>>,
		keep: 'local' | 'remote' | 'copy',
		transport: AccountThemeTransport,
		signal = new AbortController().signal
	) {
		if (!['local', 'remote', 'copy'].includes(keep)) return fail('Choose the device theme, account theme or independent copy.');
		const remote =
			parseAccountThemeSnapshot(await accountSyncDeadline((s) => transport.snapshot(s), signal)).find((row) => row.id === review.id) ?? null;
		if (stable(remote) !== stable(review.remote)) return fail('Account theme changed again. Review it again.');
		return this.tx(
			'readwrite',
			async (tx) => {
				const row = await tx.get<State>(collection, review.id),
					local = (await tx.get<LocalThing>('things', review.id)) ?? null;
				if (
					!row ||
					row.revision !== review.revision ||
					row.claim ||
					!['conflict', 'error'].includes(row.state) ||
					stable(local) !== stable(review.local)
				)
					return fail('Device theme changed. Review it again.');
				let copyId: string | undefined;
				const independent = keep === 'copy' || (keep === 'local' && !remote && !!local);
				if (independent) {
					if (!local || !isTransferTheme(local)) return fail('There is no device theme to copy.');
					const count = (await tx.list<LocalThing>('things')).filter(({ value }) => isTransferTheme(value)).length;
					if (count - (remote ? 0 : 1) + 1 > MAX_SAVED_THEMES) return fail('This workspace has reached its saved-theme limit.', 'LOCAL_QUOTA', 413);
					copyId = this.uuid();
					if ((await tx.get('things', copyId)) || (await tx.get(collection, copyId))) return fail('A new theme identity collided. Retry the copy.');
					const normalized = normalizeSavedTheme({ name: (String(local.crystal.name) + ' (device copy)').slice(0, 60), theme: local.crystal.theme });
					if (!normalized.ok) return fail('The device theme is invalid.');
					const stamp = new Date(this.now()).toISOString();
					const copy: LocalThing = {
						...local,
						id: copyId,
						crystal: { ...local.crystal, name: normalized.name, theme: normalized.theme as any },
						createdAt: stamp,
						updatedAt: stamp,
						revision: 1
					};
					await tx.put('things', copyId, copy);
					await this.mutated(tx, copy, null, { visibility: 'private' });
					if ((await tx.get('settings', 'active-theme')) === row.id) {
						await tx.put('settings', 'active-theme', copyId);
						await this.selection.setIn(tx, copyId);
					}
				}
				if (keep === 'remote' || independent) {
					if (remote) await this.install(tx, remote, row);
					else {
						if ((await tx.list<LocalThing>('things')).some(({ value }) => value.targetId === row.id || value.folderId === row.id))
							return fail('Keep related device Things before removing this theme.');
						await tx.delete('things', row.id);
						await tx.delete(collection, row.id);
						if ((await tx.get('settings', 'active-theme')) === row.id) {
							await tx.delete('settings', 'active-theme');
							await this.selection.setIn(tx, null);
						}
					}
				} else {
					if (!remote && !local) {
						await tx.delete(collection, row.id);
					} else
						await tx.put(collection, row.id, {
							...row,
							base: remote,
							baseVersion: remote!.version,
							pending: undefined,
							claim: undefined,
							revision: row.revision + 1,
							state: 'pending',
							retryAt: 0,
							attempts: 0,
							error: undefined
						});
				}
				await this.bump(tx);
				return { copyId };
			},
			signal
		);
	}
}
