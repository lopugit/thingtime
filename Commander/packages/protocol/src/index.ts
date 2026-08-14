export const PROTOCOL_VERSION = 1 as const;
export const COMMANDER_THINGTIME_CLIENT_ID = 'ttapp_fb2f7fc9-32c8-47ea-bd08-863728de69f1';

export type Platform = 'macos' | 'windows' | 'linux';
export type Appearance = 'light' | 'dark' | 'system';
export type WindowMode = 'default' | 'compact';
export type TextSize = 'default' | 'large';
export type SearchItemKind = 'builtin' | 'application' | 'extension' | 'command' | 'quicklink';

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
