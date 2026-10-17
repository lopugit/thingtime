import { MAX_SAVED_THEMES } from '../theme/savedTheme';
import { isDataPlane } from '../utils/dataPlane';
import { parseThemeWrite } from '../api/utils/themes/themeSyncContract';
import { parseThemeSelectionWrite } from '../api/utils/themes/themeSelectionContract';
import { ACCOUNT_THEME_CATALOG, ACCOUNT_THEME_SYNC, type AccountThemeState } from './accountThemes';
import { ACCOUNT_THEME_SELECTION, type AccountThemeSelectionState } from './themeSelection';
import type { LocalThing } from './things';
import { WorkspaceError, type WorkspaceDatabase, type WorkspaceLease, type WorkspaceScope, type WorkspaceTransaction } from './storage';

type AccountScope = Extract<WorkspaceScope, { kind: 'account' }>;
type Reason = 'in-flight' | 'identity-collision' | 'different-device-version' | 'local-dependencies' | 'invalid-state' | 'unresolved-theme';
export type HomeThemeMigrationIssue = { kind: 'theme' | 'selection'; id: string; reason: Reason };
export type HomeThemeMigration = { moved: string[]; deduplicated: string[]; selectionMoved: boolean; issues: HomeThemeMigrationIssue[] };
export type AccountHomeThemeMigration = { dataPlane: string; result: HomeThemeMigration }[];
const isTheme = (row: LocalThing | undefined) => row?.thingtime?.length === 1 && row.thingtime[0] === 'theme';
const active = (state: { claim?: { expiresAt: number } } | undefined, now: number) => !!state?.claim && state.claim.expiresAt > now;
const stable = (value: unknown): string =>
	JSON.stringify(value, (_key, input) =>
		input && typeof input === 'object' && !Array.isArray(input)
			? Object.fromEntries(
					Object.keys(input)
						.sort()
						.map((key) => [key, input[key]])
				)
			: input
	);
const content = (row: LocalThing | undefined) => {
	if (!row) return null;
	const { revision: _revision, updatedAt: _updatedAt, createdAt: _createdAt, ...value } = row;
	return value;
};
function preserveReceipt<T extends { pending?: { receiptPlane?: string } }>(state: T, originalPlane: string): T {
	if (!state.pending) return state;
	const receiptPlane = state.pending.receiptPlane ?? originalPlane;
	if (!isDataPlane(receiptPlane)) throw new Error('Invalid original receipt plane');
	return { ...state, pending: { ...state.pending, receiptPlane } };
}
const invalidateCatalogue = async (tx: WorkspaceTransaction) => {
	const before = await tx.get<{ epoch: number; read: number; complete: boolean }>('settings', ACCOUNT_THEME_CATALOG);
	await tx.put('settings', ACCOUNT_THEME_CATALOG, { epoch: (before?.epoch ?? 0) + 1, read: before?.read ?? 0, complete: false });
};

/** Relocate only unambiguous legacy theme records. No network, new identity,
 * content rewrite or choice between competing edits occurs here. Unresolved
 * source records remain intact and must be surfaced before a runtime switches
 * to the home adapter. Old tabs may write again, so every call scans afresh. */
export async function migrateSelectedThemesHome(
	db: WorkspaceDatabase,
	scope: AccountScope,
	lease: WorkspaceLease,
	now = Date.now()
): Promise<HomeThemeMigration> {
	if (scope.kind !== 'account' || !isDataPlane(scope.dataPlane))
		throw new WorkspaceError('INVALID_WORKSPACE', 'Confirm the account workspace before migrating themes.', 409);
	return db.accountHomeTransaction(scope, 'readwrite', lease, async ({ selected, home }) => {
		const result: HomeThemeMigration = { moved: [], deduplicated: [], selectionMoved: false, issues: [] };
		if (selected === home) return result;
		const sourceRows = await selected.list<LocalThing>('things');
		const sourceThings = sourceRows.map((row) => row.value);
		const byId = new Map(sourceRows.map((row) => [row.id, row.value]));
		const dependents = new Set(sourceThings.flatMap((row) => [row.folderId, row.targetId].filter((id) => id && id !== row.id)));
		const states = await selected.list<AccountThemeState>(ACCOUNT_THEME_SYNC);
		const stateIds = new Set(states.map((row) => row.id));
		const blocked = new Set<string>();
		const issue = (id: string, reason: Reason) => {
			blocked.add(id);
			result.issues.push({ kind: 'theme', id, reason });
		};
		for (const row of sourceRows) if (isTheme(row.value) && !stateIds.has(row.id)) issue(row.id, 'invalid-state');
		for (const { id, value: original } of states) {
			const source = byId.get(id);
			let state: AccountThemeState;
			try {
				if (
					original.id !== id ||
					!Number.isSafeInteger(original.revision) ||
					original.revision < 1 ||
					!['pending', 'syncing', 'conflict', 'error', 'synced'].includes(original.state) ||
					!['private', 'public'].includes(original.visibility) ||
					typeof original.deleted !== 'boolean' ||
					(!original.deleted && !isTheme(source)) ||
					(source && (source.id !== id || !isTheme(source)))
				)
					throw Error('Invalid theme state');
				if (original.pending && parseThemeWrite(original.pending.command).id !== id) throw Error('Invalid pending identity');
				state = preserveReceipt(original, scope.dataPlane);
			} catch {
				issue(id, 'invalid-state');
				continue;
			}
			if (active(state, now)) {
				issue(id, 'in-flight');
				continue;
			}
			if (await selected.get('thing-sync', id)) {
				issue(id, 'identity-collision');
				continue;
			}
			// A selected-plane folder is a different local identity domain, even
			// when home happens to contain a folder with the same ID. Never detach
			// its theme or silently bind it to that unrelated home folder.
			const parent = source?.folderId ? await home.get<LocalThing>('things', source.folderId) : undefined;
			if (dependents.has(id) || (source?.folderId && (byId.has(source.folderId) || !parent?.thingtime?.includes('folder')))) {
				issue(id, 'local-dependencies');
				continue;
			}
			const target = await home.get<LocalThing>('things', id),
				existing = await home.get<AccountThemeState>(ACCOUNT_THEME_SYNC, id);
			if ((await home.get('thing-sync', id)) || (target && (!isTheme(target) || !existing)) || (existing && existing.id !== id)) {
				issue(id, 'identity-collision');
				continue;
			}
			if (active(existing, now)) {
				issue(id, 'in-flight');
				continue;
			}
			if (existing) {
				// Only equivalent, acknowledged caches may collapse. Frozen or conflicting
				// intent is never discarded even when the visible tokens happen to match.
				if (
					state.state !== 'synced' ||
					existing.state !== 'synced' ||
					state.pending ||
					existing.pending ||
					state.deleted ||
					existing.deleted ||
					state.baseVersion !== existing.baseVersion ||
					stable(state.base) !== stable(existing.base) ||
					state.visibility !== existing.visibility ||
					state.placementKnown !== existing.placementKnown ||
					state.titleKnown !== existing.titleKnown ||
					stable(content(source)) !== stable(content(target))
				) {
					issue(id, 'different-device-version');
					continue;
				}
				result.deduplicated.push(id);
			} else {
				if (source) await home.put('things', id, source);
				await home.put(ACCOUNT_THEME_SYNC, id, state);
				result.moved.push(id);
			}
			await selected.delete('things', id);
			await selected.delete(ACCOUNT_THEME_SYNC, id);
		}
		const selection = await selected.get<AccountThemeSelectionState>('settings', ACCOUNT_THEME_SELECTION);
		const sourceActive = (await selected.get<string>('settings', 'active-theme')) ?? null;
		if (selection || sourceActive) {
			let reason: Reason | undefined;
			let state: AccountThemeSelectionState | undefined;
			try {
				if (!selection || selection.desired !== sourceActive) throw Error('Selection content is incomplete');
				if (selection.pending) parseThemeSelectionWrite(selection.pending.command);
				state = preserveReceipt(selection, scope.dataPlane);
			} catch {
				reason = 'invalid-state';
			}
			const target = await home.get<AccountThemeSelectionState>('settings', ACCOUNT_THEME_SELECTION);
			const targetActive = (await home.get<string>('settings', 'active-theme')) ?? null;
			if (!reason && state) {
				if (active(state, now) || active(target, now)) reason = 'in-flight';
				else if ([state.desired, state.pending?.command.themeId].some((id) => id && blocked.has(id))) reason = 'unresolved-theme';
				else if (target && target.desired !== targetActive) reason = 'invalid-state';
				else if (
					(target || targetActive) &&
					!(
						target?.state === 'synced' &&
						state.state === 'synced' &&
						!target.pending &&
						!state.pending &&
						targetActive === sourceActive &&
						stable(target.base) === stable(state.base)
					)
				)
					reason = 'different-device-version';
				else {
					if (!target) await home.put('settings', ACCOUNT_THEME_SELECTION, state);
					if (!target && sourceActive) await home.put('settings', 'active-theme', sourceActive);
					await selected.delete('settings', ACCOUNT_THEME_SELECTION);
					await selected.delete('settings', 'active-theme');
					result.selectionMoved = true;
				}
			}
			if (reason) result.issues.push({ kind: 'selection', id: ACCOUNT_THEME_SELECTION, reason });
		}
		if ((await home.list<LocalThing>('things')).filter((row) => isTheme(row.value)).length > MAX_SAVED_THEMES)
			throw new WorkspaceError('LOCAL_QUOTA', 'Moving themes would exceed the home workspace theme limit. All source records were preserved.', 413);
		if (result.moved.length || result.deduplicated.length || result.selectionMoved) {
			await invalidateCatalogue(home);
			await invalidateCatalogue(selected);
		}
		return result;
	});
}

/** Discover legacy caches without requiring the user to reconnect to each
 * database. Each source/home relocation is atomic. A failure leaves that source
 * intact; earlier completed relocations remain available in home storage. */
export async function migrateAccountThemesHome(
	db: WorkspaceDatabase,
	scope: AccountScope,
	lease: WorkspaceLease,
	now = Date.now()
): Promise<AccountHomeThemeMigration> {
	const scopes = await db.accountScopes(scope, lease);
	const results: AccountHomeThemeMigration = [];
	for (const original of scopes) {
		lease.assertCurrent();
		if (original.dataPlane === 'home') continue;
		results.push({ dataPlane: original.dataPlane, result: await migrateSelectedThemesHome(db, original, lease, now) });
	}
	return results;
}
