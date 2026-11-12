import { AccountThemeSync } from './accountThemes';
import { AccountFileSync } from './accountFiles';
import { AccountThingSync } from './accountSync';
import { exportAccountThings } from './accountExport';
import { migrateAccountThemesHome, type AccountHomeThemeMigration } from './homeThemeMigration';
import { WorkspaceError, type WorkspaceDatabase, type WorkspaceLease, type WorkspaceScope } from './storage';

type AccountScope = Extract<WorkspaceScope, { kind: 'account' }>;
export type HomeThemePreparation = { partitions: AccountHomeThemeMigration; error?: { code: string; message: string } };

/** Local-only home domain. Its lease is the CURRENT selected-account lease;
 * reading home content grants no remote authority. Generic home content queues
 * are sent only by a normal worker when home is the verified selected plane.
 * The existing dedicated theme transport can send home theme commands under
 * its separately confirmed current selected-plane fence. */
export class LocalAccountHomeThemes {
	readonly scope: AccountScope;
	readonly themes: AccountThemeSync;
	private readonly files: AccountFileSync;
	private readonly content: AccountThingSync;
	private preparing: Promise<HomeThemePreparation> | null = null;
	constructor(
		private db: WorkspaceDatabase,
		private selected: AccountScope,
		private lease: WorkspaceLease,
		private now = () => Date.now(),
		uuid = () => crypto.randomUUID()
	) {
		if (selected.kind !== 'account') throw new WorkspaceError('ACCOUNT_REQUIRED', 'Anonymous themes stay in their own workspace.', 403);
		this.scope = { ...selected, dataPlane: 'home' };
		this.themes = new AccountThemeSync(db, this.scope, lease, now, uuid);
		this.files = new AccountFileSync(db, this.scope, lease);
		this.content = new AccountThingSync(db, this.scope, lease, now, uuid, this.files.contentHooks, this.themes);
	}
	prepare(): Promise<HomeThemePreparation> {
		this.lease.assertCurrent();
		if (this.preparing) return this.preparing;
		const work = migrateAccountThemesHome(this.db, this.selected, this.lease, this.now())
			.then((partitions) => ({ partitions }))
			.catch((error) => {
				this.lease.assertCurrent();
				// Failure to consolidate old caches must not disable existing home edits.
				return {
					partitions: [],
					error: {
						code: error instanceof WorkspaceError ? error.code : 'HOME_THEME_MIGRATION',
						message: 'Some retained theme edits could not be moved. Their original workspace content has been preserved.'
					}
				};
			});
		this.preparing = work;
		void work
			.finally(() => {
				if (this.preparing === work) this.preparing = null;
			})
			.catch(() => {});
		return work;
	}
	async list() {
		const migration = await this.prepare();
		const result = await this.themes.list();
		return { ...result, migration, storagePlane: 'home' as const };
	}
	/** The caller explicitly chooses home for the WHOLE transfer. This preserves
	 * folder/dependency identity instead of splitting a mixed bundle by kind. */
	async import(input: unknown, folderId?: string | null, bytes = new Map<string, Uint8Array>(), signal?: AbortSignal) {
		this.lease.assertCurrent();
		const result = await this.content.things.import(input, folderId, bytes, signal);
		return { ...result, storagePlane: 'home' as const };
	}
	export(input: Parameters<typeof exportAccountThings>[0], signal?: AbortSignal) {
		return exportAccountThings(
			input,
			{
				db: this.db,
				lease: this.lease,
				sync: this.content,
				files: this.files,
				themes: this.themes,
				canRefresh: () => false,
				remote: async () => {
					throw new WorkspaceError('LOCAL_CONTENT_MISSING', 'Complete home export content is not retained on this device.', 409);
				}
			},
			signal
		);
	}
}
