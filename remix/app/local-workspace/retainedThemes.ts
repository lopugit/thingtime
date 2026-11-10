import { ACCOUNT_THEME_SYNC, type AccountThemeState, type AccountThemeSync } from './accountThemes';
import { ACCOUNT_THEME_SELECTION, type AccountThemeSelectionState } from './themeSelection';
import { copyBoundedJson } from '../utils/boundedJson';
import { isDataPlane } from '../utils/dataPlane';
import { transferChecksum } from '../utils/thingTransfer/archive';
import type { LocalThing } from './things';
import { WorkspaceError, type WorkspaceDatabase, type WorkspaceLease, type WorkspaceScope, type WorkspaceTransaction } from './storage';

type AccountScope = Extract<WorkspaceScope, { kind: 'account' }>;
export type RetainedThemeEntry = { dataPlane: string; id: string; kind: 'theme' | 'selection'; name: string; state: string };
type Snapshot =
	| { thing: LocalThing | null; state: AccountThemeState | null }
	| { selection: AccountThemeSelectionState | null; active: string | null };
export type RetainedThemeReview = RetainedThemeEntry & { snapshot: Snapshot };
const stable = (value: unknown) =>
	JSON.stringify(copyBoundedJson(value, { maxBytes: 4 * 1024 * 1024, maxDepth: 32, maxNodes: 100000, sortKeys: true }));
const stateLabel = (value: unknown) =>
	typeof value === 'string' && ['pending', 'syncing', 'synced', 'conflict', 'error'].includes(value) ? value : 'unverified';
const theme = (value: any): value is LocalThing => Array.isArray(value?.thingtime) && value.thingtime.length === 1 && value.thingtime[0] === 'theme';
const read = async (tx: WorkspaceTransaction, entry: Pick<RetainedThemeEntry, 'kind' | 'id'>): Promise<Snapshot> =>
	entry.kind === 'selection'
		? {
				selection: (await tx.get<AccountThemeSelectionState>('settings', ACCOUNT_THEME_SELECTION)) ?? null,
				active: (await tx.get<string>('settings', 'active-theme')) ?? null
			}
		: {
				thing: (await tx.get<LocalThing>('things', entry.id)) ?? null,
				state: (await tx.get<AccountThemeState>(ACCOUNT_THEME_SYNC, entry.id)) ?? null
			};

/** Read/recover retained variants without migration or remote requests. Every
 * lookup derives owner and origin from the current lease, never review input. */
export class RetainedAccountThemes {
	constructor(
		private db: WorkspaceDatabase,
		private selected: AccountScope,
		private lease: WorkspaceLease,
		private home: AccountThemeSync
	) {
		if (
			selected.kind !== 'account' ||
			home.scope.origin !== selected.origin ||
			home.scope.ownerId !== selected.ownerId ||
			home.scope.dataPlane !== 'home'
		)
			throw new WorkspaceError('INVALID_WORKSPACE', 'Confirm the account before reviewing retained themes.', 409);
	}
	private scope(entry: RetainedThemeEntry) {
		this.lease.assertCurrent();
		if (
			!isDataPlane(entry.dataPlane) ||
			entry.dataPlane === 'home' ||
			!['theme', 'selection'].includes(entry.kind) ||
			typeof entry.id !== 'string' ||
			!entry.id ||
			entry.id.length > 256 ||
			(entry.kind === 'selection' && entry.id !== ACCOUNT_THEME_SELECTION)
		)
			throw new WorkspaceError('INVALID_REVIEW', 'Choose a retained theme from this account.', 400);
		return { ...this.selected, dataPlane: entry.dataPlane };
	}
	async list(): Promise<RetainedThemeEntry[]> {
		const scopes = await this.db.accountScopes(this.selected, this.lease),
			result: RetainedThemeEntry[] = [];
		for (const scope of scopes) {
			if (scope.dataPlane === 'home') continue;
			await this.db.transaction(scope, 'readonly', this.lease, async (tx) => {
				const rows = new Map((await tx.list<LocalThing>('things')).filter((row) => theme(row.value)).map((row) => [row.id, row.value]));
				const states = new Map((await tx.list<AccountThemeState>(ACCOUNT_THEME_SYNC)).map((row) => [row.id, row.value]));
				for (const id of new Set([...rows.keys(), ...states.keys()])) {
					const row = rows.get(id),
						state = states.get(id);
					result.push({
						dataPlane: scope.dataPlane,
						id,
						kind: 'theme',
						name: typeof row?.crystal?.name === 'string' ? row.crystal.name.slice(0, 60) : 'Retained theme deletion',
						state: stateLabel(state?.state)
					});
				}
				const selection = await tx.get<AccountThemeSelectionState>('settings', ACCOUNT_THEME_SELECTION),
					active = await tx.get<string>('settings', 'active-theme');
				if (selection || active)
					result.push({
						dataPlane: scope.dataPlane,
						id: ACCOUNT_THEME_SELECTION,
						kind: 'selection',
						name: 'Retained theme choice',
						state: stateLabel(selection?.state)
					});
				if (result.length > 500)
					throw new WorkspaceError('RETAINED_THEME_LIMIT', 'Too many retained variants to review together. All saved content is preserved.', 413);
			});
		}
		this.lease.assertCurrent();
		return result;
	}
	async inspect(entry: RetainedThemeEntry): Promise<RetainedThemeReview> {
		const scope = this.scope(entry),
			snapshot = await this.db.transaction(scope, 'readonly', this.lease, (tx) => read(tx, entry));
		if (('thing' in snapshot && !snapshot.thing && !snapshot.state) || ('selection' in snapshot && !snapshot.selection && !snapshot.active))
			throw new WorkspaceError('REVIEW_CHANGED', 'This retained entry changed. Refresh the list.', 409);
		stable(snapshot);
		return { ...entry, snapshot };
	}
	async copy(review: RetainedThemeReview) {
		const entry = { ...review },
			scope = this.scope(entry),
			expected = stable(review.snapshot);
		if (entry.kind !== 'theme') throw new WorkspaceError('INVALID_REVIEW', 'Choose theme content to copy. Retained selections stay unchanged.', 400);
		const receipt = await transferChecksum(new TextEncoder().encode(JSON.stringify([scope.dataPlane, entry.id, expected])));
		return this.db.accountHomeTransaction(scope, 'readwrite', this.lease, async ({ selected, home }) => {
			const current = await read(selected, entry);
			if (stable(current) !== expected)
				throw new WorkspaceError('REVIEW_CHANGED', 'This retained entry changed. Review it again before copying.', 409);
			if (!('thing' in current) || !theme(current.thing) || current.state?.deleted)
				throw new WorkspaceError('NO_THEME_CONTENT', 'This retained entry has no theme content to copy.', 409);
			// Only portable theme content enters the private root copy. Original folder,
			// selection, pending command and all source records remain unchanged.
			const previous = await home.get<{ id: string }>('theme-recovery', receipt);
			if (previous) {
				const copy = typeof previous.id === 'string' ? await home.get<LocalThing>('things', previous.id) : null;
				if (!theme(copy))
					throw new WorkspaceError(
						'RECOVERED_COPY_REMOVED',
						'This version was already copied and its copy was removed. The retained original is unchanged.',
						409
					);
				return copy;
			}
			const copy = await this.home.copyIn(home, current.thing, { folderId: null });
			await home.put('theme-recovery', receipt, { id: copy.id });
			return copy;
		});
	}
}
