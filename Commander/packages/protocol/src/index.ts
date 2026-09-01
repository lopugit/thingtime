export const PROTOCOL_VERSION = 1 as const;
export const COMMANDER_THINGTIME_PRODUCTION_URL = 'https://thingtime.com';
export const COMMANDER_THINGTIME_DEVELOPMENT_URL = 'https://dev.thingtime.com';
/** Public OAuth client registered for the released Commander desktop application. */
export const COMMANDER_THINGTIME_PRODUCTION_CLIENT_ID = 'ttapp_7a68dafc-23c0-4516-871d-62ea3cbc92de';
/** Public OAuth client registered for Commander builds pointed at Thingtime development. */
export const COMMANDER_THINGTIME_DEVELOPMENT_CLIENT_ID = 'ttapp_5aec98d2-b17b-4396-b450-528ccc730d0e';
/** Compatibility alias for the production client. */
export const COMMANDER_THINGTIME_CLIENT_ID = COMMANDER_THINGTIME_PRODUCTION_CLIENT_ID;
export const COMMANDER_THINGTIME_CUSTOM_ENVIRONMENT_LIMIT = 16;

export const COMMANDER_THINGTIME_ENVIRONMENTS = [
  {
    id: 'production',
    name: 'Production',
    baseUrl: COMMANDER_THINGTIME_PRODUCTION_URL,
    clientId: COMMANDER_THINGTIME_PRODUCTION_CLIENT_ID,
  },
  {
    id: 'development',
    name: 'Develop',
    baseUrl: COMMANDER_THINGTIME_DEVELOPMENT_URL,
    clientId: COMMANDER_THINGTIME_DEVELOPMENT_CLIENT_ID,
  },
] as const;

/**
 * Built-in IDs that Commander shipped before their registration was corrected.
 * They are migrated to the current public ID, while genuine user overrides stay
 * untouched.
 */
export const LEGACY_COMMANDER_THINGTIME_CLIENT_IDS = ['ttapp_fb2f7fc9-32c8-47ea-bd08-863728de69f1'] as const;

const BUILT_IN_COMMANDER_THINGTIME_CLIENT_IDS = new Set([
  COMMANDER_THINGTIME_PRODUCTION_CLIENT_ID,
  COMMANDER_THINGTIME_DEVELOPMENT_CLIENT_ID,
]);

export function defaultCommanderThingtimeClientId(baseUrl: unknown): string {
  try {
    const url = new URL(typeof baseUrl === 'string' ? baseUrl : COMMANDER_THINGTIME_PRODUCTION_URL);
    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol === 'https:' &&
      (url.origin === COMMANDER_THINGTIME_DEVELOPMENT_URL || hostname.endsWith('.previews.dev.thingtime.com'))
    )
      return COMMANDER_THINGTIME_DEVELOPMENT_CLIENT_ID;
  } catch {
    // The daemon gives malformed custom URLs a user-facing validation error at login time.
  }
  return COMMANDER_THINGTIME_PRODUCTION_CLIENT_ID;
}

export function normalizeCommanderThingtimeClientId(value: unknown, baseUrl?: unknown): string {
  const clientId = typeof value === 'string' ? value.trim() : '';
  if (
    !clientId ||
    LEGACY_COMMANDER_THINGTIME_CLIENT_IDS.some((legacyId) => legacyId === clientId) ||
    BUILT_IN_COMMANDER_THINGTIME_CLIENT_IDS.has(clientId)
  )
    return defaultCommanderThingtimeClientId(baseUrl);
  return clientId;
}
export const RECENT_SEARCH_PREVIEW_LIMIT = 8;
export const RECENT_SEARCH_STORAGE_LIMIT = 50;
export const RECENT_SEARCH_COMMAND_LIMIT = 8;
export const RECENT_SEARCH_MAX_LENGTH = 256;
export const SEARCH_PREFERENCE_STORAGE_LIMIT = 10_000;
export const SEARCH_PREFERENCE_MAX_COUNT = 1_000_000;
export const SEARCH_CACHE_MIN_BYTES = 8 * 1024 * 1024;
export const SEARCH_CACHE_MAX_BYTES = 2 * 1024 * 1024 * 1024;
export const SEARCH_CACHE_MIN_TTL_MINUTES = 5;
export const SEARCH_CACHE_MAX_TTL_MINUTES = 7 * 24 * 60;
export const COMMAND_SHORTCUT_LIMIT = 256;
export const INDEXING_ROOT_LIMIT = 32;
export const INDEXING_IGNORE_RULE_LIMIT = 256;
export const INDEXING_MAX_ENTRIES_LIMIT = Number.MAX_SAFE_INTEGER;
export const INDEXING_SETTINGS_VERSION = 5 as const;
export const INDEXING_MAX_THREADS_LIMIT = 64;
export const INDEXING_MAX_PARALLELISM_LIMIT = 64;
export const INDEXING_MAX_OPEN_DIRECTORIES_LIMIT = 256;
export const INDEXING_MIN_CPU_PERCENT = 5;
export const INDEXING_MAX_CPU_PERCENT = 100;
export const INDEXING_MIN_MEMORY_MIB = 32;
export const INDEXING_MAX_MEMORY_MIB = 131_072;
export const INDEXING_TIMEOUT_ATTEMPT_LIMIT = 20;
export const INDEXING_TIMING_SAMPLE_LIMIT = 20;
export const CALCULATOR_MIN_DECIMAL_PLACES = 0;
export const CALCULATOR_MAX_DECIMAL_PLACES = 14;

const LEGACY_DEFAULT_INDEXING_GLOBS = [
  'Library/**',
  '**/.git/**',
  '**/node_modules/**',
  '**/.Trash/**',
  '**/.cache/**',
] as const;
const DEFAULT_NOINDEX_GLOB = '**/*.noindex/**';
const LEGACY_DEFAULT_INDEXING_MAX_ENTRIES = 2_000_000;

export const DEFAULT_INDEXING_RESOURCE_LIMITS: IndexingResourceLimits = {
  maxThreads: 2,
  maxParallelism: 2,
  maxOpenDirectories: 16,
  maxCpuPercent: 60,
  maxMemoryMiB: 512,
};

export type Platform = 'macos' | 'windows' | 'linux';
export type Appearance = 'light' | 'dark' | 'system';
export type WindowMode = 'default' | 'compact';
export type TextSize = 'default' | 'large';
export type SearchItemKind =
  | 'builtin'
  | 'calculator'
  | 'system'
  | 'application'
  | 'file'
  | 'directory'
  | 'extension'
  | 'command'
  | 'quicklink';
export type SearchCategory = 'applications' | 'commands' | 'files';
export type EmojiDefaultAction = 'paste' | 'paste-and-copy' | 'copy' | 'copy-unicode';
export type SettingsTab =
  'general' | 'extensions' | 'search' | 'activity' | 'sync' | 'account' | 'advanced' | 'about';
export type CommanderViewId = 'emoji-symbols';
export type CommandShortcutMap = Record<string, string>;
export type IndexKind = 'application' | 'file' | 'directory';
export type IndexScope = 'all' | 'applications' | 'commands' | 'files' | 'directories';
export type IndexIgnoreRuleKind = 'glob' | 'regex';

export const SEARCH_CATEGORIES = [
  'applications',
  'commands',
  'files',
] as const satisfies readonly SearchCategory[];

export const DEFAULT_SEARCH_CACHE_SETTINGS: SearchCacheSettings = {
  enabled: true,
  directory: null,
  maxSizeBytes: 256 * 1024 * 1024,
  ttlMinutes: 24 * 60,
};

export const DEFAULT_WINDOW_PINNING_SETTINGS: WindowPinningSettings = {
  enabled: true,
  defaultPinned: false,
  focusRecentOnCurrentDisplay: true,
  shortcut: 'Command+Shift+P',
};

export const DEFAULT_CALCULATOR_SETTINGS: CalculatorSettings = {
  enabled: true,
  maxDecimalPlaces: 10,
};

export const DEFAULT_ACTIVITY_SETTINGS: ActivitySettings = {
  // Ping is cheap enough to keep current while the Activity page is open. A
  // complete speed test transfers 35.6 MiB in both directions, so it remains
  // explicitly opt-in instead of silently consuming a connection in the
  // background.
  periodicSpeedTestEnabled: false,
  periodicSpeedTestIntervalMinutes: 15,
};

export const DEFAULT_INDEXING_SETTINGS: IndexingSettings = {
  version: INDEXING_SETTINGS_VERSION,
  enabled: true,
  // `/` is expanded by the daemon into the boot volume plus currently mounted
  // macOS volumes. The Rust walker never crosses a mount boundary implicitly,
  // so each file is indexed once unless a user explicitly adds an overlap.
  roots: ['/'],
  respectGitIgnore: true,
  includeHidden: true,
  customIgnores: [
    ...LEGACY_DEFAULT_INDEXING_GLOBS.map((pattern) => ({ kind: 'glob' as const, pattern })),
    { kind: 'glob', pattern: DEFAULT_NOINDEX_GLOB },
  ],
  refreshIntervalMinutes: 6 * 60,
  maxEntries: null,
  customTimeoutMs: null,
  resourceLimits: { ...DEFAULT_INDEXING_RESOURCE_LIMITS },
};

export const SETTINGS_TABS = [
  'general',
  'extensions',
  'search',
  'activity',
  'sync',
  'account',
  'advanced',
  'about',
] as const satisfies readonly SettingsTab[];

export function isSettingsTab(value: unknown): value is SettingsTab {
  return typeof value === 'string' && (SETTINGS_TABS as readonly string[]).includes(value);
}

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

export interface SearchPreference {
  query: string;
  itemId: string;
  actionId: string;
  count: number;
  lastSelectedAtMs: number;
}

export function normalizeSearchPreferenceQuery(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, RECENT_SEARCH_MAX_LENGTH);
}

const SEARCH_ITEM_KINDS = new Set<SearchItemKind>([
  'builtin',
  'calculator',
  'system',
  'application',
  'file',
  'directory',
  'extension',
  'command',
  'quicklink',
]);

function normalizedText(value: unknown, maximumLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim().slice(0, maximumLength);
  return text || undefined;
}

export interface CommanderThingtimeCustomEnvironment {
  id: string;
  name: string;
  baseUrl: string;
  clientId: string;
}

function normalizedEnvironmentUrl(value: unknown): string | undefined {
  const text = normalizedText(value, 512);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    return text.replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

export function normalizeCommanderThingtimeCustomEnvironments(
  value: unknown,
): CommanderThingtimeCustomEnvironment[] {
  if (!Array.isArray(value)) return [];
  const environments: CommanderThingtimeCustomEnvironment[] = [];
  const ids = new Set<string>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue;
    const item = candidate as Partial<CommanderThingtimeCustomEnvironment>;
    const id = normalizedText(item.id, 96);
    const name = normalizedText(item.name, 96);
    const baseUrl = normalizedEnvironmentUrl(item.baseUrl);
    const clientId = normalizedText(item.clientId, 256);
    if (!id || !name || !baseUrl || !clientId || ids.has(id)) continue;
    ids.add(id);
    environments.push({ id, name, baseUrl, clientId });
    if (environments.length === COMMANDER_THINGTIME_CUSTOM_ENVIRONMENT_LIMIT) break;
  }
  return environments;
}

function boundedInteger(value: unknown, minimum: number, maximum: number, fallback: number): number {
  return Number.isSafeInteger(value) ? Math.min(maximum, Math.max(minimum, value as number)) : fallback;
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

export function normalizeSearchPreferences(value: unknown): SearchPreference[] {
  if (!Array.isArray(value)) return [];
  const preferences = new Map<string, SearchPreference>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const item = candidate as Partial<SearchPreference>;
    const query = typeof item.query === 'string' ? normalizeSearchPreferenceQuery(item.query) : '';
    const itemId = normalizedText(item.itemId, 512);
    const actionId = normalizedText(item.actionId, 128);
    if (!itemId || !actionId) continue;
    const count = boundedInteger(item.count, 1, SEARCH_PREFERENCE_MAX_COUNT, 1);
    const lastSelectedAtMs = Number.isSafeInteger(item.lastSelectedAtMs)
      ? Math.max(0, item.lastSelectedAtMs as number)
      : 0;
    const key = `${query}\u0000${itemId}\u0000${actionId}`;
    const existing = preferences.get(key);
    preferences.set(key, {
      query,
      itemId,
      actionId,
      count: Math.min(SEARCH_PREFERENCE_MAX_COUNT, count + (existing?.count ?? 0)),
      lastSelectedAtMs: Math.max(lastSelectedAtMs, existing?.lastSelectedAtMs ?? 0),
    });
  }
  return [...preferences.values()]
    .sort(
      (left, right) =>
        right.lastSelectedAtMs - left.lastSelectedAtMs ||
        right.count - left.count ||
        left.query.localeCompare(right.query) ||
        left.itemId.localeCompare(right.itemId) ||
        left.actionId.localeCompare(right.actionId),
    )
    .slice(0, SEARCH_PREFERENCE_STORAGE_LIMIT);
}

export function recordSearchPreference(
  preferences: readonly SearchPreference[],
  queryValue: string,
  itemIdValue: string,
  actionIdValue: string,
  selectedAtMs = Date.now(),
): SearchPreference[] {
  const query = normalizeSearchPreferenceQuery(queryValue);
  const itemId = normalizedText(itemIdValue, 512);
  const actionId = normalizedText(actionIdValue, 128);
  if (!itemId || !actionId) return normalizeSearchPreferences(preferences);
  const normalized = normalizeSearchPreferences(preferences);
  const existing = normalized.find(
    (item) => item.query === query && item.itemId === itemId && item.actionId === actionId,
  );
  return normalizeSearchPreferences([
    {
      query,
      itemId,
      actionId,
      count: Math.min(SEARCH_PREFERENCE_MAX_COUNT, (existing?.count ?? 0) + 1),
      lastSelectedAtMs: Number.isSafeInteger(selectedAtMs) ? Math.max(0, selectedAtMs) : Date.now(),
    },
    ...normalized.filter(
      (item) => !(item.query === query && item.itemId === itemId && item.actionId === actionId),
    ),
  ]);
}

/** Lightweight TypeScript counterpart to the Rust search core for renderer and
 * process-failure fallbacks. It supports substring/subsequence matching plus
 * bounded Damerau-style typo tolerance. */
export function fuzzyTextScore(queryValue: string, candidateValue: string): number {
  const query = [...queryValue.toLowerCase().trim()].slice(0, 128).join('');
  const value = [...candidateValue.toLowerCase()].slice(0, 512).join('');
  if (!query) return 0;
  if (!value) return -1;
  const compactQuery = compactSearchText(query);
  const compactValue = compactSearchText(value);
  if (compactValue === compactQuery) return 100_000;
  if (compactValue.startsWith(compactQuery)) return 80_000 - compactValue.length;
  const containedAt = compactValue.indexOf(compactQuery);
  if (containedAt >= 0) return 60_000 - containedAt;
  let cursor = 0;
  let gaps = 0;
  let subsequence = true;
  for (const character of query) {
    const found = value.indexOf(character, cursor);
    if (found < 0) {
      subsequence = false;
      break;
    }
    gaps += found - cursor;
    cursor = found + 1;
  }
  if (subsequence) return 10_000 - gaps;
  if (compactQuery.length < 3 || !compactValue) return -1;
  const distance = substringDamerauDistance(compactQuery, compactValue);
  return distance <= maximumTypoDistance(compactQuery.length) ? 8_000 - distance * 1_500 : -1;
}

function compactSearchText(value: string): string {
  const alphanumeric = [...value].filter((character) => /[\p{L}\p{N}]/u.test(character)).join('');
  return alphanumeric || value.replace(/\s+/g, '');
}

function maximumTypoDistance(length: number): number {
  if (length < 3) return 0;
  if (length < 6) return 1;
  if (length < 10) return 2;
  return 3;
}

function substringDamerauDistance(query: string, candidate: string): number {
  const needle = [...query];
  const haystack = [...candidate];
  let previousPrevious: number[] | undefined;
  let previous = Array.from({ length: haystack.length + 1 }, () => 0);
  for (let row = 1; row <= needle.length; row += 1) {
    const current = [row, ...Array.from({ length: haystack.length }, () => 0)];
    for (let column = 1; column <= haystack.length; column += 1) {
      const substitution = previous[column - 1]! + (needle[row - 1] === haystack[column - 1] ? 0 : 1);
      current[column] = Math.min(previous[column]! + 1, current[column - 1]! + 1, substitution);
      if (
        previousPrevious &&
        row > 1 &&
        column > 1 &&
        needle[row - 1] === haystack[column - 2] &&
        needle[row - 2] === haystack[column - 1]
      ) {
        current[column] = Math.min(current[column]!, previousPrevious[column - 2]! + 1);
      }
    }
    previousPrevious = previous;
    previous = current;
  }
  return Math.min(...previous);
}

export function extensionCommandItemId(extensionId: string, commandName: string): string {
  return `extension:${extensionId}:${commandName}`;
}

export function normalizeCommandShortcuts(value: unknown): CommandShortcutMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const shortcuts: CommandShortcutMap = {};
  let count = 0;
  for (const [rawItemId, rawShortcut] of Object.entries(value)) {
    const itemId = normalizedText(rawItemId, 512);
    const shortcut = normalizedText(rawShortcut, 128);
    if (!itemId || !shortcut || itemId === 'launcher') continue;
    shortcuts[itemId] = shortcut;
    count += 1;
    if (count === COMMAND_SHORTCUT_LIMIT) break;
  }
  return shortcuts;
}

export function normalizeSearchCategoryOrder(value: unknown): SearchCategory[] {
  const requested = Array.isArray(value)
    ? value.filter(
        (candidate): candidate is SearchCategory =>
          typeof candidate === 'string' && (SEARCH_CATEGORIES as readonly string[]).includes(candidate),
      )
    : [];
  return [...new Set([...requested, ...SEARCH_CATEGORIES])];
}

export function normalizeSearchCacheSettings(value: unknown): SearchCacheSettings {
  const candidate =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Partial<SearchCacheSettings>)
      : {};
  const directory = typeof candidate.directory === 'string' ? candidate.directory.trim().slice(0, 4_096) : '';
  return {
    enabled:
      typeof candidate.enabled === 'boolean' ? candidate.enabled : DEFAULT_SEARCH_CACHE_SETTINGS.enabled,
    directory: directory || null,
    maxSizeBytes: boundedInteger(
      candidate.maxSizeBytes,
      SEARCH_CACHE_MIN_BYTES,
      SEARCH_CACHE_MAX_BYTES,
      DEFAULT_SEARCH_CACHE_SETTINGS.maxSizeBytes,
    ),
    ttlMinutes: boundedInteger(
      candidate.ttlMinutes,
      SEARCH_CACHE_MIN_TTL_MINUTES,
      SEARCH_CACHE_MAX_TTL_MINUTES,
      DEFAULT_SEARCH_CACHE_SETTINGS.ttlMinutes,
    ),
  };
}

export function normalizeWindowPinningSettings(value: unknown): WindowPinningSettings {
  const candidate =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Partial<WindowPinningSettings>)
      : {};
  const shortcut = normalizedText(candidate.shortcut, 128);
  return {
    enabled:
      typeof candidate.enabled === 'boolean' ? candidate.enabled : DEFAULT_WINDOW_PINNING_SETTINGS.enabled,
    defaultPinned:
      typeof candidate.defaultPinned === 'boolean'
        ? candidate.defaultPinned
        : DEFAULT_WINDOW_PINNING_SETTINGS.defaultPinned,
    focusRecentOnCurrentDisplay:
      typeof candidate.focusRecentOnCurrentDisplay === 'boolean'
        ? candidate.focusRecentOnCurrentDisplay
        : DEFAULT_WINDOW_PINNING_SETTINGS.focusRecentOnCurrentDisplay,
    shortcut: shortcut ?? DEFAULT_WINDOW_PINNING_SETTINGS.shortcut,
  };
}

export function normalizeEmojiDefaultAction(value: unknown): EmojiDefaultAction {
  return value === 'paste' || value === 'paste-and-copy' || value === 'copy' || value === 'copy-unicode'
    ? value
    : 'paste';
}

export function normalizeCalculatorSettings(value: unknown): CalculatorSettings {
  const candidate =
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Partial<CalculatorSettings>) : {};
  return {
    enabled: typeof candidate.enabled === 'boolean' ? candidate.enabled : DEFAULT_CALCULATOR_SETTINGS.enabled,
    maxDecimalPlaces: boundedInteger(
      candidate.maxDecimalPlaces,
      CALCULATOR_MIN_DECIMAL_PLACES,
      CALCULATOR_MAX_DECIMAL_PLACES,
      DEFAULT_CALCULATOR_SETTINGS.maxDecimalPlaces,
    ),
  };
}

export function normalizeActivitySettings(value: unknown): ActivitySettings {
  const candidate =
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Partial<ActivitySettings>) : {};
  return {
    periodicSpeedTestEnabled:
      typeof candidate.periodicSpeedTestEnabled === 'boolean'
        ? candidate.periodicSpeedTestEnabled
        : DEFAULT_ACTIVITY_SETTINGS.periodicSpeedTestEnabled,
    periodicSpeedTestIntervalMinutes: boundedInteger(
      candidate.periodicSpeedTestIntervalMinutes,
      5,
      24 * 60,
      DEFAULT_ACTIVITY_SETTINGS.periodicSpeedTestIntervalMinutes,
    ),
  };
}

export const DEFAULT_USE_CUSTOM_WINDOW_RESIZE_HANDLING = true;

export function normalizeCustomWindowResizeHandling(value: unknown): boolean {
  return typeof value === 'boolean' ? value : DEFAULT_USE_CUSTOM_WINDOW_RESIZE_HANDLING;
}

export function normalizeIndexingSettings(value: unknown): IndexingSettings {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const candidate = source as Partial<IndexingSettings>;
  const roots = Array.isArray(candidate.roots)
    ? candidate.roots
        .filter((root): root is string => typeof root === 'string')
        .map((root) => root.trim().slice(0, 4_096))
        .filter(Boolean)
        .filter((root, index, values) => values.indexOf(root) === index)
        .slice(0, INDEXING_ROOT_LIMIT)
    : [];
  const customIgnores = Array.isArray(candidate.customIgnores)
    ? candidate.customIgnores
        .filter((rule): rule is IndexIgnoreRule =>
          Boolean(
            rule &&
            typeof rule === 'object' &&
            (rule.kind === 'glob' || rule.kind === 'regex') &&
            typeof rule.pattern === 'string' &&
            rule.pattern.trim(),
          ),
        )
        .map((rule) => ({ kind: rule.kind, pattern: rule.pattern.trim().slice(0, 2_048) }))
        .slice(0, INDEXING_IGNORE_RULE_LIMIT)
    : [];
  const hasLegacyDefaults = LEGACY_DEFAULT_INDEXING_GLOBS.every((pattern) =>
    customIgnores.some((rule) => rule.kind === 'glob' && rule.pattern === pattern),
  );
  if (
    hasLegacyDefaults &&
    customIgnores.length < INDEXING_IGNORE_RULE_LIMIT &&
    !customIgnores.some((rule) => rule.kind === 'glob' && rule.pattern === DEFAULT_NOINDEX_GLOB)
  ) {
    customIgnores.push({ kind: 'glob', pattern: DEFAULT_NOINDEX_GLOB });
  }
  const refreshIntervalMinutes =
    candidate.refreshIntervalMinutes === 30 && hasLegacyDefaults
      ? DEFAULT_INDEXING_SETTINGS.refreshIntervalMinutes
      : Number.isSafeInteger(candidate.refreshIntervalMinutes)
        ? Math.min(24 * 60, Math.max(5, candidate.refreshIntervalMinutes!))
        : DEFAULT_INDEXING_SETTINGS.refreshIntervalMinutes;
  const currentVersion = candidate.version === INDEXING_SETTINGS_VERSION;
  // `~` was Commander’s default before whole-volume indexing. Preserve every
  // deliberate multi-root/custom configuration, while upgrading that legacy
  // singleton default so existing installs receive the new behavior.
  const upgradeLegacyDefaultRoot = !currentVersion && roots.length === 1 && roots[0] === '~';
  const maxEntries =
    candidate.maxEntries === null
      ? null
      : !currentVersion &&
          (candidate.maxEntries === LEGACY_DEFAULT_INDEXING_MAX_ENTRIES || candidate.maxEntries === 500_000)
        ? null
        : Number.isSafeInteger(candidate.maxEntries)
          ? Math.min(INDEXING_MAX_ENTRIES_LIMIT, Math.max(1, candidate.maxEntries!))
          : DEFAULT_INDEXING_SETTINGS.maxEntries;
  return {
    version: INDEXING_SETTINGS_VERSION,
    enabled: typeof candidate.enabled === 'boolean' ? candidate.enabled : DEFAULT_INDEXING_SETTINGS.enabled,
    roots: upgradeLegacyDefaultRoot
      ? [...DEFAULT_INDEXING_SETTINGS.roots]
      : roots.length
        ? roots
        : [...DEFAULT_INDEXING_SETTINGS.roots],
    respectGitIgnore:
      typeof candidate.respectGitIgnore === 'boolean'
        ? candidate.respectGitIgnore
        : DEFAULT_INDEXING_SETTINGS.respectGitIgnore,
    includeHidden: currentVersion
      ? typeof candidate.includeHidden === 'boolean'
        ? candidate.includeHidden
        : DEFAULT_INDEXING_SETTINGS.includeHidden
      : DEFAULT_INDEXING_SETTINGS.includeHidden,
    customIgnores:
      Array.isArray(candidate.customIgnores) && candidate.customIgnores.length === 0
        ? []
        : customIgnores.length
          ? customIgnores
          : DEFAULT_INDEXING_SETTINGS.customIgnores.map((rule) => ({ ...rule })),
    refreshIntervalMinutes,
    maxEntries,
    customTimeoutMs:
      candidate.customTimeoutMs === null
        ? null
        : Number.isSafeInteger(candidate.customTimeoutMs) && candidate.customTimeoutMs! > 0
          ? candidate.customTimeoutMs!
          : DEFAULT_INDEXING_SETTINGS.customTimeoutMs,
    resourceLimits: normalizeIndexingResourceLimits(candidate.resourceLimits),
  };
}

export function normalizeIndexingResourceLimits(value: unknown): IndexingResourceLimits {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const candidate = source as Partial<IndexingResourceLimits>;
  return {
    maxThreads: boundedInteger(
      candidate.maxThreads,
      1,
      INDEXING_MAX_THREADS_LIMIT,
      DEFAULT_INDEXING_RESOURCE_LIMITS.maxThreads,
    ),
    maxParallelism: boundedInteger(
      candidate.maxParallelism,
      1,
      INDEXING_MAX_PARALLELISM_LIMIT,
      DEFAULT_INDEXING_RESOURCE_LIMITS.maxParallelism,
    ),
    maxOpenDirectories: boundedInteger(
      candidate.maxOpenDirectories,
      1,
      INDEXING_MAX_OPEN_DIRECTORIES_LIMIT,
      DEFAULT_INDEXING_RESOURCE_LIMITS.maxOpenDirectories,
    ),
    maxCpuPercent: boundedInteger(
      candidate.maxCpuPercent,
      INDEXING_MIN_CPU_PERCENT,
      INDEXING_MAX_CPU_PERCENT,
      DEFAULT_INDEXING_RESOURCE_LIMITS.maxCpuPercent,
    ),
    maxMemoryMiB: boundedInteger(
      candidate.maxMemoryMiB,
      INDEXING_MIN_MEMORY_MIB,
      INDEXING_MAX_MEMORY_MIB,
      DEFAULT_INDEXING_RESOURCE_LIMITS.maxMemoryMiB,
    ),
  };
}

export interface CommanderSettings {
  version: 1;
  openAtLogin: boolean;
  showMenuBarIcon: boolean;
  showFavouritesInCompactMode: boolean;
  windowMode: WindowMode;
  useCustomWindowResizeHandling: boolean;
  appearance: Appearance;
  textSize: TextSize;
  hotkey: string;
  commandShortcuts: CommandShortcutMap;
  resultCategoryOrder: SearchCategory[];
  searchCache: SearchCacheSettings;
  emojiDefaultAction: EmojiDefaultAction;
  calculator: CalculatorSettings;
  activity: ActivitySettings;
  windowPinning: WindowPinningSettings;
  indexing: IndexingSettings;
  activeAccountId: string | null;
  thingtimeBaseUrl: string;
  thingtimeClientId: string;
  thingtimeCustomEnvironments: CommanderThingtimeCustomEnvironment[];
  syncRevision: number;
  syncUpdatedAt: string | null;
  syncDirty: boolean;
}

export interface SearchCacheSettings {
  enabled: boolean;
  directory: string | null;
  maxSizeBytes: number;
  ttlMinutes: number;
}

export interface CalculatorSettings {
  enabled: boolean;
  maxDecimalPlaces: number;
}

export interface ActivitySettings {
  periodicSpeedTestEnabled: boolean;
  periodicSpeedTestIntervalMinutes: number;
}

export interface SearchCacheStatus extends SearchCacheSettings {
  effectiveDirectory: string;
  sizeBytes: number;
  entryCount: number;
}

export interface WindowPinningSettings {
  enabled: boolean;
  defaultPinned: boolean;
  focusRecentOnCurrentDisplay: boolean;
  shortcut: string;
}

export interface IndexIgnoreRule {
  kind: IndexIgnoreRuleKind;
  pattern: string;
}

export interface IndexingSettings {
  version: typeof INDEXING_SETTINGS_VERSION;
  enabled: boolean;
  roots: string[];
  respectGitIgnore: boolean;
  includeHidden: boolean;
  customIgnores: IndexIgnoreRule[];
  refreshIntervalMinutes: number;
  maxEntries: number | null;
  /** Blank keeps Commander’s automatic timeout; a positive safe integer is milliseconds. */
  customTimeoutMs: number | null;
  resourceLimits: IndexingResourceLimits;
}

export interface IndexingResourceLimits {
  maxThreads: number;
  maxParallelism: number;
  maxOpenDirectories: number;
  maxCpuPercent: number;
  maxMemoryMiB: number;
}

export interface EffectiveIndexingResourceLimits {
  logicalCpuCount: number;
  workerThreads: number;
  maxOpenDirectories: number;
  maxCpuPercent: number;
  maxMemoryMiB: number;
  channelCapacity: number;
  sqliteCacheKib: number;
}

export interface IndexingResourceUsage {
  effective: EffectiveIndexingResourceLimits;
  cpuTimeMs: number;
  averageCpuPercent: number;
  peakMemoryBytes: number;
  throttledMs: number;
  memoryChecks: number;
}

export interface IndexRunTiming {
  scope: IndexScope;
  completedAtMs: number;
  durationMs: number;
}

export interface IndexTimingSummary {
  samples: number;
  averageDurationMs?: number;
  lastDurationMs?: number;
  longestDurationMs?: number;
}

export interface IndexTimeoutAttempt {
  id: string;
  scope: IndexScope;
  occurredAtMs: number;
  timeoutMs: number;
  message: string;
}

export interface IndexKindStatus {
  kind: IndexKind;
  count: number;
  lastIndexedAtMs?: number;
  lastDurationMs?: number;
  lastError?: string;
}

export interface IndexingStatus {
  available: boolean;
  running: IndexScope[];
  totalRecords: number;
  databaseSizeBytes: number;
  kinds: IndexKindStatus[];
  commands: {
    count: number;
    lastIndexedAtMs?: number;
  };
  automaticRefresh: {
    applicationsMinutes: number;
    filesystemMinutes: number;
  };
  customTimeoutMs: number | null;
  resourceLimits: IndexingResourceLimits;
  lastRunResources?: IndexingResourceUsage;
  timing: IndexTimingSummary;
  timeoutAttempts: IndexTimeoutAttempt[];
  progress?: IndexingProgress;
  message?: string;
}

export interface IndexingProgress {
  scope: IndexScope;
  label: string;
  processed: number;
  total?: number;
  startedAtMs: number;
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
  /** Public origin/app metadata; the credential itself remains native-only. */
  environment?: {
    baseUrl: string;
    clientId: string;
  };
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

export interface LocalRaycastExtension {
  id: string;
  name: string;
  title: string;
  description: string;
  installationId: string;
  development: boolean;
  installedInCommander: boolean;
  canAdd: boolean;
  detectedPreferenceCount: number;
  syncedPreferenceCount: number;
  protectedPreferenceCount: number;
  lastSyncedAt?: string;
}

export interface LocalRaycastExtensionsResponse {
  available: boolean;
  extensions: LocalRaycastExtension[];
  message?: string;
}

export interface RaycastPreferenceSyncSummary {
  copied: number;
  defaultsApplied: number;
  missing: number;
  protected: number;
  syncedAt: string;
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
  preferenceScore?: number;
  extensionId?: string;
  commandName?: string;
  calculation?: CalculationResult;
  actions: CommanderAction[];
}

export interface CalculationResult {
  expression: string;
  result: string;
  label: string;
  resultWords?: string;
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

export interface SearchStreamEvent {
  type: 'results';
  phase: 'cache' | 'catalog' | 'filesystem' | 'complete';
  hits: SearchHit[];
  complete: boolean;
  cached: boolean;
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

export interface CommanderView {
  id: CommanderViewId;
}

export interface ExecuteResponse {
  ok: true;
  nativeRequest?: Omit<NativeRequest, 'id'>;
  view?: CommanderView;
  notice?: string;
  dismissLauncher?: boolean;
}

export interface NativePasteResult {
  copied: boolean;
  pasted: boolean;
  requiresAccessibility: boolean;
  targetApplication?: string;
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
    filesystemIndex: boolean;
  };
}

export interface NativeRequest<T = unknown> {
  id: string;
  method:
    | 'launcher.hide'
    | 'launcher.show'
    | 'launcher.state'
    | 'launcher.pin'
    | 'launcher.openNewWindow'
    | 'launcher.commandReady'
    | 'application.quit'
    | 'application.control'
    | 'window.beginDrag'
    | 'filesystem.beginDrag'
    | 'filesystem.icon'
    | 'filesystem.copy'
    | 'filesystem.trash'
    | 'filesystem.delete'
    | 'system.metrics'
    | 'permission.fullDiskAccess'
    | 'notification.show'
    | 'settings.open'
    | 'application.open'
    | 'application.pasteTarget'
    | 'filesystem.reveal'
    | 'clipboard.write'
    | 'clipboard.paste'
    | 'extension.choose'
    | 'hotkey.update'
    | 'commandHotkeys.update'
    | 'loginItem.update'
    | 'menuBar.update'
    | 'settings.applyNative'
    | 'credential.claim'
    | 'credential.unlock'
    | 'credential.delete'
    | 'credential.environments';
  params?: T;
}

export interface SystemMetrics {
  sampledAtMs: number;
  commander: {
    cpuPercent: number;
    residentMemoryBytes: number;
    virtualMemoryBytes: number;
    storageBytes: number;
    processCount: number;
  };
  machine: {
    cpuPercent: number;
    logicalCpuCount: number;
    memoryUsedBytes: number;
    memoryTotalBytes: number;
    thermalState: 'nominal' | 'fair' | 'serious' | 'critical';
    filesystemUsedBytes: number;
    filesystemTotalBytes: number;
    filesystemAvailableBytes: number;
    memory: {
      usedBytes: number;
      totalBytes: number;
      activeBytes: number;
      wiredBytes: number;
      cachedBytes: number;
      compressedBytes: number;
      purgeableBytes: number;
    };
    filesystem: {
      usedBytes: number;
      totalBytes: number;
      availableBytes: number;
      purgeableBytes: number;
    };
    responsivenessApplications: SystemResponsivenessApplication[];
    processes: SystemProcessMetric[];
    gpu: {
      name: string;
      available: boolean;
      utilizationPercent?: number;
      source: 'io-registry' | 'unavailable';
    };
  };
}

export interface SystemProcessMetric {
  pid: number;
  parentPid: number;
  name: string;
  cpuPercent: number;
  residentMemoryBytes: number;
  diskReadBytesPerSecond: number;
  diskWriteBytesPerSecond: number;
  // macOS does not provide public, per-process network or GPU counters. These
  // remain optional rather than presenting system-wide values as if they were
  // attributable to one process.
  networkBytesPerSecond?: number;
  gpuPercent?: number;
}

export interface SystemResponsivenessApplication {
  pid: number;
  name: string;
  kind: 'ui' | 'agent' | 'service';
  signal: 'repeatedAccessibilityTimeout' | 'accessibilityProbeInconclusive';
}

export interface ThingtimeNetworkProbe {
  sampledAtMs: number;
  ping: {
    roundTripMs: number;
    requestMs: number;
    responseMs: number;
  };
  speed?: {
    packetBytes: number[];
    downloads: Array<{ bytes: number; durationMs: number; megabitsPerSecond: number }>;
    uploads: Array<{ bytes: number; durationMs: number; megabitsPerSecond: number }>;
  };
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
  commandShortcuts: CommandShortcutMap;
  openAtLogin: boolean;
  showMenuBarIcon: boolean;
  windowMode: WindowMode;
  useCustomWindowResizeHandling: boolean;
  windowPinning: WindowPinningSettings;
}

export interface SettingsOpenRequest {
  tab: SettingsTab;
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
  useCustomWindowResizeHandling: DEFAULT_USE_CUSTOM_WINDOW_RESIZE_HANDLING,
  appearance: 'system',
  textSize: 'default',
  hotkey: 'Command+Space',
  commandShortcuts: {},
  resultCategoryOrder: [...SEARCH_CATEGORIES],
  searchCache: { ...DEFAULT_SEARCH_CACHE_SETTINGS },
  emojiDefaultAction: 'paste',
  calculator: { ...DEFAULT_CALCULATOR_SETTINGS },
  activity: { ...DEFAULT_ACTIVITY_SETTINGS },
  windowPinning: { ...DEFAULT_WINDOW_PINNING_SETTINGS },
  indexing: {
    ...DEFAULT_INDEXING_SETTINGS,
    roots: [...DEFAULT_INDEXING_SETTINGS.roots],
    customIgnores: DEFAULT_INDEXING_SETTINGS.customIgnores.map((rule) => ({ ...rule })),
    resourceLimits: { ...DEFAULT_INDEXING_SETTINGS.resourceLimits },
  },
  activeAccountId: null,
  thingtimeBaseUrl: COMMANDER_THINGTIME_PRODUCTION_URL,
  thingtimeClientId: COMMANDER_THINGTIME_PRODUCTION_CLIENT_ID,
  thingtimeCustomEnvironments: [],
  syncRevision: 0,
  syncUpdatedAt: null,
  syncDirty: false,
};
