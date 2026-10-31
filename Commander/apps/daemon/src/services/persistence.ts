import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  CommanderAccount,
  CommanderExtension,
  CommanderSettings,
  RecentSearch,
  RecentSearchCommand,
  SearchPreference,
} from '@commander/protocol';
import {
  addRecentSearch as prependRecentSearch,
  DEFAULT_SETTINGS,
  normalizeActivitySettings,
  normalizeCalculatorSettings,
  normalizeCommandShortcuts,
  normalizeCommanderThingtimeClientId,
  normalizeCommanderThingtimeCustomEnvironments,
  normalizeCustomWindowResizeHandling,
  normalizeEmojiDefaultAction,
  normalizeIndexingSettings,
  normalizeRecentSearches,
  normalizeSearchPreferenceQuery,
  normalizeSearchPreferences,
  normalizeSearchCacheSettings,
  normalizeSearchCategoryOrder,
  normalizeWindowPinningSettings,
  recordSearchPreference,
} from '@commander/protocol';
import type { RaycastExtensionPreferenceState } from './raycastLocal.js';
import { commanderDataDirectory } from './config.js';

interface PersistentState {
  version: 1;
  settings: CommanderSettings;
  accounts: CommanderAccount[];
  extensions: CommanderExtension[];
  extensionPreferences: RaycastExtensionPreferenceState[];
  recentSearches: RecentSearch[];
  searchPreferences: SearchPreference[];
}

type PersistentSnapshot = Omit<PersistentState, 'searchPreferences'>;

export interface AccountEnvironmentUpdate {
  accountId: string;
  baseUrl: string;
  clientId: string;
}

const statePath = () => path.join(commanderDataDirectory(), 'state.json');

function normalizedSettings(settings: Partial<CommanderSettings> | undefined): CommanderSettings {
  const merged = { ...DEFAULT_SETTINGS, ...settings, version: 1 } as CommanderSettings;
  return {
    ...merged,
    commandShortcuts: normalizeCommandShortcuts(settings?.commandShortcuts),
    resultCategoryOrder: normalizeSearchCategoryOrder(settings?.resultCategoryOrder),
    searchCache: normalizeSearchCacheSettings(settings?.searchCache),
    emojiDefaultAction: normalizeEmojiDefaultAction(settings?.emojiDefaultAction),
    calculator: normalizeCalculatorSettings(settings?.calculator),
    activity: normalizeActivitySettings(settings?.activity),
    useCustomWindowResizeHandling: normalizeCustomWindowResizeHandling(
      settings?.useCustomWindowResizeHandling,
    ),
    windowPinning: normalizeWindowPinningSettings(settings?.windowPinning),
    indexing: normalizeIndexingSettings(settings?.indexing),
    thingtimeCustomEnvironments: normalizeCommanderThingtimeCustomEnvironments(
      settings?.thingtimeCustomEnvironments,
    ),
    thingtimeClientId: normalizeCommanderThingtimeClientId(merged.thingtimeClientId, merged.thingtimeBaseUrl),
  };
}

function initialState(): PersistentState {
  return {
    version: 1,
    settings: structuredClone(DEFAULT_SETTINGS),
    accounts: [],
    extensions: [],
    extensionPreferences: [],
    recentSearches: [],
    searchPreferences: [],
  };
}

export class PersistentStore {
  #state: PersistentState = initialState();
  #writeQueue = Promise.resolve();
  #indexingMigrationPending = false;

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(statePath(), 'utf8')) as Partial<PersistentState>;
      const settings = normalizedSettings(parsed.settings);
      const clientIdNeedsMigration = parsed.settings?.thingtimeClientId !== settings.thingtimeClientId;
      const shortcutsNeedMigration =
        JSON.stringify(parsed.settings?.commandShortcuts ?? {}) !== JSON.stringify(settings.commandShortcuts);
      const indexingNeedsMigration =
        JSON.stringify(parsed.settings?.indexing) !== JSON.stringify(settings.indexing);
      const searchPresentationNeedsMigration =
        JSON.stringify(parsed.settings?.resultCategoryOrder) !==
          JSON.stringify(settings.resultCategoryOrder) ||
        JSON.stringify(parsed.settings?.searchCache) !== JSON.stringify(settings.searchCache) ||
        parsed.settings?.emojiDefaultAction !== settings.emojiDefaultAction ||
        JSON.stringify(parsed.settings?.calculator) !== JSON.stringify(settings.calculator) ||
        JSON.stringify(parsed.settings?.activity) !== JSON.stringify(settings.activity) ||
        parsed.settings?.useCustomWindowResizeHandling !== settings.useCustomWindowResizeHandling ||
        JSON.stringify(parsed.settings?.windowPinning) !== JSON.stringify(settings.windowPinning);
      const environmentsNeedMigration =
        JSON.stringify(parsed.settings?.thingtimeCustomEnvironments ?? []) !==
        JSON.stringify(settings.thingtimeCustomEnvironments);
      this.#indexingMigrationPending = indexingNeedsMigration;
      const recentSearches = normalizeRecentSearches(parsed.recentSearches);
      const historyNeedsMigration =
        Array.isArray(parsed.recentSearches) &&
        JSON.stringify(parsed.recentSearches) !== JSON.stringify(recentSearches);
      const searchPreferences = normalizeSearchPreferences(parsed.searchPreferences);
      const preferencesNeedMigration =
        Array.isArray(parsed.searchPreferences) &&
        JSON.stringify(parsed.searchPreferences) !== JSON.stringify(searchPreferences);
      this.#state = {
        version: 1,
        settings,
        accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
        extensions: Array.isArray(parsed.extensions) ? parsed.extensions : [],
        extensionPreferences: normalizeExtensionPreferences(parsed.extensionPreferences),
        recentSearches,
        searchPreferences,
      };
      if (
        clientIdNeedsMigration ||
        shortcutsNeedMigration ||
        indexingNeedsMigration ||
        searchPresentationNeedsMigration ||
        environmentsNeedMigration ||
        historyNeedsMigration ||
        preferencesNeedMigration
      )
        await this.#persist();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  snapshot(): PersistentSnapshot {
    const { searchPreferences: _searchPreferences, ...snapshot } = this.#state;
    return structuredClone(snapshot);
  }

  consumeIndexingMigration(): boolean {
    const pending = this.#indexingMigrationPending;
    this.#indexingMigrationPending = false;
    return pending;
  }

  async setSettings(
    settings: CommanderSettings,
    options: { markCloudChanges?: boolean } = {},
  ): Promise<CommanderSettings> {
    const previous = this.#state.settings;
    const cloudChanged =
      previous.appearance !== settings.appearance ||
      previous.textSize !== settings.textSize ||
      previous.windowMode !== settings.windowMode ||
      previous.showFavouritesInCompactMode !== settings.showFavouritesInCompactMode;
    const markCloudChanges = options.markCloudChanges ?? true;
    this.#state.settings = {
      ...normalizedSettings(settings),
      syncDirty: settings.syncDirty || (markCloudChanges && cloudChanged),
    };
    await this.#persist();
    return structuredClone(this.#state.settings);
  }

  async upsertAccount(account: CommanderAccount): Promise<void> {
    this.#state.accounts = [account, ...this.#state.accounts.filter((item) => item.id !== account.id)];
    if (!this.#state.settings.activeAccountId) this.#state.settings.activeAccountId = account.id;
    await this.#persist();
  }

  async reconcileAccountEnvironments(updates: AccountEnvironmentUpdate[]): Promise<CommanderAccount[]> {
    const environmentsByAccountID = new Map<string, Map<string, CommanderAccount['environment']>>();
    for (const update of updates.slice(0, 64)) {
      const environment = normalizedAccountEnvironment(update);
      if (!environment) continue;
      const environments = environmentsByAccountID.get(update.accountId) ?? new Map();
      environments.set(`${environment.baseUrl}\u0000${environment.clientId}`, environment);
      environmentsByAccountID.set(update.accountId, environments);
    }

    let changed = false;
    this.#state.accounts = this.#state.accounts.map((account) => {
      const environments = environmentsByAccountID.get(account.id);
      // A user ID can theoretically exist in more than one deployment. Keep
      // that legacy record unlabeled instead of assigning an arbitrary origin.
      if (!environments || environments.size !== 1) return account;
      const environment = [...environments.values()][0]!;
      if (
        account.environment?.baseUrl === environment.baseUrl &&
        account.environment.clientId === environment.clientId
      )
        return account;
      changed = true;
      return { ...account, environment };
    });
    if (changed) await this.#persist();
    return structuredClone(this.#state.accounts);
  }

  async removeAccount(id: string): Promise<void> {
    this.#state.accounts = this.#state.accounts.filter((account) => account.id !== id);
    if (this.#state.settings.activeAccountId === id)
      this.#state.settings.activeAccountId = this.#state.accounts[0]?.id ?? null;
    await this.#persist();
  }

  async setActiveAccount(id: string): Promise<CommanderAccount> {
    const account = this.#state.accounts.find((item) => item.id === id);
    if (!account) throw new Error('Account not found');
    this.#state.settings.activeAccountId = id;
    await this.#persist();
    return structuredClone(account);
  }

  async upsertExtension(extension: CommanderExtension): Promise<void> {
    this.#state.extensions = [
      extension,
      ...this.#state.extensions.filter((item) => item.id !== extension.id),
    ];
    await this.#persist();
  }

  async upsertExtensionPreferences(preferences: RaycastExtensionPreferenceState): Promise<void> {
    this.#state.extensionPreferences = [
      structuredClone(preferences),
      ...this.#state.extensionPreferences.filter((item) => item.extensionId !== preferences.extensionId),
    ];
    await this.#persist();
  }

  extensionPreferences(extensionId: string): RaycastExtensionPreferenceState | undefined {
    const preferences = this.#state.extensionPreferences.find((item) => item.extensionId === extensionId);
    return preferences ? structuredClone(preferences) : undefined;
  }

  async addRecentSearch(query: string, command?: RecentSearchCommand): Promise<RecentSearch[]> {
    const recentSearches = prependRecentSearch(this.#state.recentSearches, query, command);
    const unchanged = JSON.stringify(recentSearches) === JSON.stringify(this.#state.recentSearches);
    if (!unchanged) {
      this.#state.recentSearches = recentSearches;
      await this.#persist();
    }
    return structuredClone(this.#state.recentSearches);
  }

  async recordSearchSelection(
    query: string,
    itemId: string,
    actionId: string,
    selectedAtMs = Date.now(),
  ): Promise<void> {
    this.#state.searchPreferences = recordSearchPreference(
      this.#state.searchPreferences,
      query,
      itemId,
      actionId,
      selectedAtMs,
    );
    await this.#persist();
  }

  preferenceScores(queryValue: string, nowMs = Date.now()): Record<string, number> {
    const query = normalizeSearchPreferenceQuery(queryValue);
    const totals = new Map<
      string,
      { exactCount: number; globalCount: number; latestExactMs: number; latestGlobalMs: number }
    >();
    for (const preference of this.#state.searchPreferences) {
      const current = totals.get(preference.itemId) ?? {
        exactCount: 0,
        globalCount: 0,
        latestExactMs: 0,
        latestGlobalMs: 0,
      };
      current.globalCount += preference.count;
      current.latestGlobalMs = Math.max(current.latestGlobalMs, preference.lastSelectedAtMs);
      if (preference.query === query) {
        current.exactCount += preference.count;
        current.latestExactMs = Math.max(current.latestExactMs, preference.lastSelectedAtMs);
      }
      totals.set(preference.itemId, current);
    }
    return Object.fromEntries(
      [...totals.entries()].map(([itemId, usage]) => {
        const exact = Math.min(60_000, Math.round(Math.log2(usage.exactCount + 1) * 6_000));
        const global = Math.min(8_000, Math.round(Math.log2(usage.globalCount + 1) * 800));
        const latest = usage.latestExactMs || usage.latestGlobalMs;
        const ageDays = latest ? Math.max(0, nowMs - latest) / 86_400_000 : Number.POSITIVE_INFINITY;
        const recency = Number.isFinite(ageDays) ? Math.round(2_000 / (1 + ageDays / 7)) : 0;
        return [itemId, exact + global + recency];
      }),
    );
  }

  async #persist(): Promise<void> {
    this.#writeQueue = this.#writeQueue.then(async () => {
      const directory = commanderDataDirectory();
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temporary = `${statePath()}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(this.#state, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, statePath());
    });
    await this.#writeQueue;
  }
}

function normalizedAccountEnvironment(
  value: AccountEnvironmentUpdate,
): CommanderAccount['environment'] | undefined {
  const accountId = typeof value.accountId === 'string' ? value.accountId.trim() : '';
  const clientId = typeof value.clientId === 'string' ? value.clientId.trim() : '';
  if (!accountId || accountId.length > 256 || !clientId || clientId.length > 256) return undefined;
  try {
    const url = new URL(value.baseUrl);
    if (!url.origin || url.username || url.password) return undefined;
    return { baseUrl: url.origin, clientId };
  } catch {
    return undefined;
  }
}

function normalizeExtensionPreferences(value: unknown): RaycastExtensionPreferenceState[] {
  if (!Array.isArray(value)) return [];
  return value.filter((candidate): candidate is RaycastExtensionPreferenceState => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
    const item = candidate as Partial<RaycastExtensionPreferenceState>;
    return (
      typeof item.extensionId === 'string' &&
      typeof item.installationId === 'string' &&
      typeof item.syncedAt === 'string' &&
      item.values !== null &&
      typeof item.values === 'object' &&
      !Array.isArray(item.values) &&
      item.commandValues !== null &&
      typeof item.commandValues === 'object' &&
      !Array.isArray(item.commandValues) &&
      Number.isSafeInteger(item.copied) &&
      Number.isSafeInteger(item.defaultsApplied) &&
      Number.isSafeInteger(item.missing) &&
      Number.isSafeInteger(item.protected)
    );
  });
}
