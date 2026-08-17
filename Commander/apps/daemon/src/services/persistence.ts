import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  CommanderAccount,
  CommanderExtension,
  CommanderSettings,
  RecentSearch,
  RecentSearchCommand,
} from '@commander/protocol';
import {
  addRecentSearch as prependRecentSearch,
  DEFAULT_SETTINGS,
  normalizeRecentSearches,
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
}

const statePath = () => path.join(commanderDataDirectory(), 'state.json');

function normalizedSettings(settings: Partial<CommanderSettings> | undefined): CommanderSettings {
  const merged = { ...DEFAULT_SETTINGS, ...settings, version: 1 } as CommanderSettings;
  const clientId = typeof merged.thingtimeClientId === 'string' ? merged.thingtimeClientId.trim() : '';
  return {
    ...merged,
    thingtimeClientId: clientId || DEFAULT_SETTINGS.thingtimeClientId,
  };
}

function initialState(): PersistentState {
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS },
    accounts: [],
    extensions: [],
    extensionPreferences: [],
    recentSearches: [],
  };
}

export class PersistentStore {
  #state: PersistentState = initialState();
  #writeQueue = Promise.resolve();

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(statePath(), 'utf8')) as Partial<PersistentState>;
      const settings = normalizedSettings(parsed.settings);
      const clientIdNeedsMigration = parsed.settings?.thingtimeClientId !== settings.thingtimeClientId;
      const recentSearches = normalizeRecentSearches(parsed.recentSearches);
      const historyNeedsMigration =
        Array.isArray(parsed.recentSearches) &&
        JSON.stringify(parsed.recentSearches) !== JSON.stringify(recentSearches);
      this.#state = {
        version: 1,
        settings,
        accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
        extensions: Array.isArray(parsed.extensions) ? parsed.extensions : [],
        extensionPreferences: normalizeExtensionPreferences(parsed.extensionPreferences),
        recentSearches,
      };
      if (clientIdNeedsMigration || historyNeedsMigration) await this.#persist();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  snapshot(): PersistentState {
    return structuredClone(this.#state);
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
