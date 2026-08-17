export const PROTOCOL_VERSION = 1 as const;
export const COMMANDER_THINGTIME_CLIENT_ID = 'ttapp_fb2f7fc9-32c8-47ea-bd08-863728de69f1';
export const RECENT_SEARCH_PREVIEW_LIMIT = 8;
export const RECENT_SEARCH_STORAGE_LIMIT = 50;
export const RECENT_SEARCH_COMMAND_LIMIT = 8;
export const RECENT_SEARCH_MAX_LENGTH = 256;

export type Platform = 'macos' | 'windows' | 'linux';
export type Appearance = 'light' | 'dark' | 'system';
export type WindowMode = 'default' | 'compact';
export type TextSize = 'default' | 'large';
export type SearchItemKind = 'builtin' | 'application' | 'extension' | 'command' | 'quicklink';

export interface RecentSearchCommand {
  itemId: string;
  actionId: string;
  title: string;
  subtitle?: string;
  icon?: string;
  kind: SearchItemKind;
  actionTitle?: string;
}

export interface RecentSearch {
  query: string;
  commands: RecentSearchCommand[];
}

const SEARCH_ITEM_KINDS = new Set<SearchItemKind>([
  'builtin',
  'application',
  'extension',
  'command',
  'quicklink',
]);

function normalizedText(value: unknown, maximumLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim().slice(0, maximumLength);
  return text || undefined;
}

function normalizeRecentSearchCommand(value: unknown): RecentSearchCommand | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<RecentSearchCommand>;
  const itemId = normalizedText(candidate.itemId, 512);
  const actionId = normalizedText(candidate.actionId, 128);
  const title = normalizedText(candidate.title, 256);
  const subtitle = normalizedText(candidate.subtitle, 512);
  const icon = normalizedText(candidate.icon, 128);
  const actionTitle = normalizedText(candidate.actionTitle, 256);
  if (!itemId || !actionId || !title) return undefined;
  return {
    itemId,
    actionId,
    title,
    kind: SEARCH_ITEM_KINDS.has(candidate.kind as SearchItemKind)
      ? (candidate.kind as SearchItemKind)
      : 'command',
    ...(subtitle ? { subtitle } : {}),
    ...(icon ? { icon } : {}),
    ...(actionTitle ? { actionTitle } : {}),
  };
}

function normalizeRecentSearchCommands(value: unknown): RecentSearchCommand[] {
  if (!Array.isArray(value)) return [];
  const commands: RecentSearchCommand[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    const command = normalizeRecentSearchCommand(candidate);
    if (!command) continue;
    const key = `${command.itemId}\u0000${command.actionId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    commands.push(command);
    if (commands.length === RECENT_SEARCH_COMMAND_LIMIT) break;
  }
  return commands;
}

export function normalizeRecentSearches(value: unknown): RecentSearch[] {
  if (!Array.isArray(value)) return [];
  const searches: RecentSearch[] = [];
  const byQuery = new Map<string, RecentSearch>();
  for (const candidate of value) {
    const query = normalizedText(
      typeof candidate === 'string'
        ? candidate
        : candidate && typeof candidate === 'object'
          ? (candidate as Partial<RecentSearch>).query
          : undefined,
      RECENT_SEARCH_MAX_LENGTH,
    );
    if (!query) continue;
    const key = query.toLowerCase();
    const commands = normalizeRecentSearchCommands(
      candidate && typeof candidate === 'object' ? (candidate as Partial<RecentSearch>).commands : [],
    );
    const existing = byQuery.get(key);
    if (existing) {
      existing.commands = normalizeRecentSearchCommands([...existing.commands, ...commands]);
      continue;
    }
    const search = { query, commands };
    byQuery.set(key, search);
    searches.push(search);
    if (searches.length === RECENT_SEARCH_STORAGE_LIMIT) break;
  }
  return searches;
}

export function addRecentSearch(
  searches: readonly RecentSearch[],
  value: string,
  command?: RecentSearchCommand,
): RecentSearch[] {
  const normalized = normalizeRecentSearches(searches);
  const query = normalizedText(value, RECENT_SEARCH_MAX_LENGTH);
  if (!query) return normalized;
  const key = query.toLowerCase();
  const existing = normalized.find((search) => search.query.toLowerCase() === key);
  const commands = normalizeRecentSearchCommands([
    ...(command ? [command] : []),
    ...(existing?.commands ?? []),
  ]);
  return normalizeRecentSearches([
    { query, commands },
    ...normalized.filter((search) => search.query.toLowerCase() !== key),
  ]);
}

export interface CommanderSettings {
  version: 1;
  openAtLogin: boolean;
  showMenuBarIcon: boolean;
  showFavouritesInCompactMode: boolean;
  windowMode: WindowMode;
  appearance: Appearance;
  textSize: TextSize;
  hotkey: string;
  activeAccountId: string | null;
  thingtimeBaseUrl: string;
  thingtimeClientId: string;
  syncRevision: number;
  syncUpdatedAt: string | null;
  syncDirty: boolean;
}

export interface CommanderAccount {
  id: string;
  username: string;
  displayName?: string;
  avatarUrl?: string | null;
  profileUrl?: string;
  scopes: string[];
  expiresAt: string;
  lastSyncedAt?: string;
}

export interface ExtensionCommand {
  name: string;
  title: string;
  description?: string;
  mode: 'view' | 'no-view' | 'menu-bar';
  keywords: string[];
  disabled: boolean;
}

export interface CommanderExtension {
  id: string;
  name: string;
  title: string;
  description: string;
  version: string;
  author?: string;
  icon?: string;
  source: 'builtin' | 'store' | 'sideload';
  path?: string;
  enabled: boolean;
  compatibility: 'native' | 'compatible' | 'partial' | 'metadata-only';
  commands: ExtensionCommand[];
}

export interface StoreExtension {
  id: string;
  name: string;
  title: string;
  description: string;
  author: string;
  iconUrl?: string;
  repositoryUrl?: string;
  installUrl?: string;
  categories: string[];
  installed: boolean;
}

export interface SearchItem {
  id: string;
  title: string;
  subtitle?: string;
  kind: SearchItemKind;
  keywords: string[];
  icon?: string;
  path?: string;
  favourite: boolean;
  extensionId?: string;
  commandName?: string;
  actions: CommanderAction[];
}

export interface SearchHit extends SearchItem {
  score: number;
  matchedRanges: Array<{ start: number; end: number }>;
}

export interface ActionFilter {
  anyOf?: string[];
  allOf?: string[];
  noneOf?: string[];
}

export interface SearchRequest {
  query: string;
  items: SearchItem[];
  limit?: number;
  actionFilter?: ActionFilter;
}

export interface SearchResponse {
  hits: SearchHit[];
}

export interface SearchErrorResponse {
  error: { code: string; message: string };
}

export interface CommanderAction {
  id: string;
  title: string;
  shortcut?: string;
  destructive?: boolean;
}

export interface BootstrapResponse {
  protocolVersion: typeof PROTOCOL_VERSION;
  platform: Platform;
  settings: CommanderSettings;
  accounts: CommanderAccount[];
  extensions: CommanderExtension[];
  recentSearches: RecentSearch[];
  capabilities: {
    nativeBridge: boolean;
    globalHotkey: boolean;
    secureCredentialStore: boolean;
    openAtLogin: boolean;
    sideloadPicker: boolean;
  };
}

export interface NativeRequest<T = unknown> {
  id: string;
  method:
    | 'launcher.hide'
    | 'launcher.show'
    | 'application.quit'
    | 'window.beginDrag'
    | 'settings.open'
    | 'application.open'
    | 'filesystem.reveal'
    | 'clipboard.write'
    | 'extension.choose'
    | 'hotkey.update'
    | 'loginItem.update'
    | 'menuBar.update'
    | 'settings.applyNative'
    | 'credential.claim'
    | 'credential.unlock'
    | 'credential.delete';
  params?: T;
}

export interface NativeResponse<T = unknown> {
  id: string;
  ok: boolean;
  result?: T;
  error?: string;
}

export interface DaemonReadyMessage {
  type: 'ready';
  protocolVersion: typeof PROTOCOL_VERSION;
  port: number;
  url: string;
  sessionToken: string;
  nativeToken: string;
  pid: number;
}

export interface NativeSettingsSnapshot {
  hotkey: string;
  openAtLogin: boolean;
  showMenuBarIcon: boolean;
  windowMode: WindowMode;
}

export interface CredentialKey {
  issuer: string;
  clientId: string;
  accountId: string;
}

export const DEFAULT_SETTINGS: CommanderSettings = {
  version: 1,
  openAtLogin: false,
  showMenuBarIcon: true,
  showFavouritesInCompactMode: true,
  windowMode: 'default',
  appearance: 'system',
  textSize: 'default',
  hotkey: 'Command+Space',
  activeAccountId: null,
  thingtimeBaseUrl: 'https://thingtime.com',
  thingtimeClientId: COMMANDER_THINGTIME_CLIENT_ID,
  syncRevision: 0,
  syncUpdatedAt: null,
  syncDirty: false,
};
