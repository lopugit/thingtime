import { normalizeSavedTheme, MAX_SAVED_THEMES } from '../theme/savedTheme';
import { snapshotTransferValue } from '../utils/thingTransfer/value';
import { isTransferTheme } from '../utils/thingTransfer/theme';
import type { LocalThing } from './things';
import { WorkspaceDatabase, WorkspaceError, type WorkspaceLease, type WorkspaceTransaction } from './storage';

const scope = { kind: 'anonymous' } as const;
const project = (row: LocalThing) => ({ id: row.id, name: row.crystal.name, theme: row.crystal.theme,
	visibility: 'private' as const, localOnly: true, createdAt: row.createdAt, updatedAt: row.updatedAt });

/** Dedicated theme writer. Generic Thing mutations still reject protected kinds. */
export class LocalThemes {
	constructor(private db: WorkspaceDatabase, private lease: WorkspaceLease) {}
	private transaction<T>(mode: IDBTransactionMode, run: (tx: WorkspaceTransaction) => Promise<T>) { return this.db.transaction(scope, mode, this.lease, run); }
	private async read(tx: WorkspaceTransaction, id: string) {
		const row = await tx.get<LocalThing>('things', id);
		if (!row || !isTransferTheme(row)) throw new WorkspaceError('NOT_FOUND', 'Theme is not in this workspace', 404);
		return row;
	}
	async list() {
		return this.transaction('readonly', async tx => ({ ok: true,
			themes: (await tx.list<LocalThing>('things')).map(row => row.value).filter(isTransferTheme)
				.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)).map(project),
			activeThemeId: await tx.get<string>('settings', 'active-theme') || null }));
	}
	async get(id: string) { return this.transaction('readonly', async tx => ({ ok: true, theme: project(await this.read(tx, id)) })); }
	async save(input: { id?: string; name?: unknown; theme?: unknown; visibility?: unknown; expectedUpdatedAt?: string }) {
		if (input.visibility === 'public') throw new WorkspaceError('REMOTE_ACCOUNT_REQUIRED', 'Local themes stay on this device. Sign in to publish a separate account copy.', 401);
		const result = normalizeSavedTheme({ name: input.name, theme: snapshotTransferValue(input.theme ?? null) });
		if (!result.ok) throw new WorkspaceError('INVALID_THEME', result.error, result.status);
		return this.transaction('readwrite', async tx => {
			const previous = input.id ? await this.read(tx, input.id) : null;
			if (previous && input.expectedUpdatedAt && previous.updatedAt !== input.expectedUpdatedAt) throw new WorkspaceError('WRITE_CONFLICT', 'This theme changed in another editor. Reload it before saving.', 409);
			if (!previous && (await tx.list<LocalThing>('things')).filter(row => isTransferTheme(row.value)).length >= MAX_SAVED_THEMES) throw new WorkspaceError('LOCAL_QUOTA', 'This workspace has reached its saved-theme limit', 413);
			const now = new Date(Math.max(Date.now(), previous ? Date.parse(previous.updatedAt) + 1 : 0)).toISOString();
			const row: LocalThing = { ...previous, id: previous?.id || `local-${crypto.randomUUID()}`, thingtime: ['theme'],
				crystal: snapshotTransferValue({ name: result.name, theme: result.theme }) as LocalThing['crystal'],
				createdAt: previous?.createdAt || now, updatedAt: now, revision: (previous?.revision || 0) + 1 };
			await tx.put('things', row.id, row);
			return { ok: true, theme: project(row) };
		});
	}
	async setActive(themeId: string | null) {
		return this.transaction('readwrite', async tx => {
			if (themeId) { await this.read(tx, themeId); await tx.put('settings', 'active-theme', themeId); }
			else await tx.delete('settings', 'active-theme');
			return { ok: true, activeThemeId: themeId };
		});
	}
	async remove(id: string) {
		return this.transaction('readwrite', async tx => {
			await this.read(tx, id);
			if ((await tx.list<LocalThing>('things')).some(row => row.value.targetId === id || row.value.folderId === id)) throw new WorkspaceError('HAS_CHILDREN', 'Remove the theme’s related local Things before deleting it.');
			await tx.delete('things', id);
			if (await tx.get('settings', 'active-theme') === id) await tx.delete('settings', 'active-theme');
			return { ok: true };
		});
	}
}
