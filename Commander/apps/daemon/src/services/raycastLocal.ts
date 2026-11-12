import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  CommanderExtension,
  LocalRaycastExtension,
  LocalRaycastExtensionsResponse,
  RaycastPreferenceSyncSummary,
} from '@commander/protocol';
import {
  readRaycastPreferenceDefinitions,
  type RaycastPreferenceDefinition,
} from '@commander/raycast-compat';

const execFile = promisify(execFileCallback);
const MAX_PREFERENCES_BYTES = 4 * 1024 * 1024;
const MAX_SYNCED_VALUE_BYTES = 128 * 1024;
const STORE_SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/;
const INSTALLATION_ID = /^(?:dev|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i;

type PreferenceDictionary = Record<string, unknown>;

interface RaycastInstallation {
  name: string;
  installationId: string;
  development: boolean;
  detectedPreferenceCount: number;
}

export interface RaycastExtensionPreferenceState {
  extensionId: string;
  installationId: string;
  values: Record<string, unknown>;
  commandValues: Record<string, Record<string, unknown>>;
  syncedAt: string;
  copied: number;
  defaultsApplied: number;
  missing: number;
  protected: number;
}

export interface RaycastPreferenceSyncResult {
  state: RaycastExtensionPreferenceState;
  summary: RaycastPreferenceSyncSummary;
}

export interface RaycastLocalServiceOptions {
  platform?: NodeJS.Platform;
  loadPreferences?: () => Promise<PreferenceDictionary>;
  now?: () => Date;
}

export class RaycastLocalService {
  private readonly platform: NodeJS.Platform;
  private readonly loadPreferences: () => Promise<PreferenceDictionary>;
  private readonly now: () => Date;

  constructor(options: RaycastLocalServiceOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.loadPreferences = options.loadPreferences ?? loadRaycastPreferences;
    this.now = options.now ?? (() => new Date());
  }

  async list(
    commanderExtensions: readonly CommanderExtension[],
    preferenceStates: readonly RaycastExtensionPreferenceState[],
  ): Promise<LocalRaycastExtensionsResponse> {
    if (this.platform !== 'darwin') {
      return {
        available: false,
        extensions: [],
        message: 'Your Raycast is currently available when Commander is running on macOS.',
      };
    }
    let preferences: PreferenceDictionary;
    try {
      preferences = await this.loadPreferences();
    } catch {
      return {
        available: false,
        extensions: [],
        message: 'Commander could not read a Raycast profile on this Mac.',
      };
    }
    const installations = discoverRaycastInstallations(preferences);
    const byName = new Map(commanderExtensions.map((extension) => [extension.name, extension]));
    const stateByExtension = new Map(preferenceStates.map((state) => [state.extensionId, state]));
    const extensions: LocalRaycastExtension[] = installations.map((installation) => {
      const installed = byName.get(installation.name);
      const synced = installed ? stateByExtension.get(installed.id) : undefined;
      return {
        id: `raycast-local:${installation.name}:${installation.installationId}`,
        name: installation.name,
        title: installed?.title ?? humanizeSlug(installation.name),
        description: installation.development
          ? 'Development extension linked to Raycast on this Mac.'
          : 'Extension detected in this Mac’s Raycast profile.',
        installationId: installation.installationId,
        development: installation.development,
        installedInCommander: Boolean(installed),
        canAdd: !installation.development && STORE_SLUG.test(installation.name),
        detectedPreferenceCount: installation.detectedPreferenceCount,
        syncedPreferenceCount: synced ? synced.copied + synced.defaultsApplied : 0,
        protectedPreferenceCount: synced?.protected ?? 0,
        ...(synced?.syncedAt ? { lastSyncedAt: synced.syncedAt } : {}),
      };
    });
    return {
      available: true,
      extensions,
      message:
        'Password preferences stay protected in Raycast; Commander only copies manifest-declared non-password settings.',
    };
  }

  async requireInstallation(name: string, installationId: string): Promise<RaycastInstallation> {
    if (!STORE_SLUG.test(name) || !INSTALLATION_ID.test(installationId))
      throw new Error('Invalid Raycast extension installation');
    const preferences = await this.loadPreferences();
    const installation = discoverRaycastInstallations(preferences).find(
      (candidate) => candidate.name === name && candidate.installationId === installationId,
    );
    if (!installation) throw new Error('That extension is no longer present in the local Raycast profile');
    return installation;
  }

  async syncPreferences(
    extension: CommanderExtension,
    installation: Pick<RaycastInstallation, 'name' | 'installationId'>,
  ): Promise<RaycastPreferenceSyncResult> {
    if (!extension.path) throw new Error('The Commander extension has no local source to receive settings');
    const preferences = await this.loadPreferences();
    const definitions = await readRaycastPreferenceDefinitions(extension.path);
    const values: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    const commandValues: Record<string, Record<string, unknown>> = Object.create(null) as Record<
      string,
      Record<string, unknown>
    >;
    let copied = 0;
    let defaultsApplied = 0;
    let missing = 0;
    let protectedCount = 0;

    for (const definition of definitions) {
      if (definition.type === 'password') {
        protectedCount += 1;
        continue;
      }
      const key = preferenceKey(installation.name, installation.installationId, definition);
      const hasRaycastValue = Object.prototype.hasOwnProperty.call(preferences, key);
      const candidate = hasRaycastValue ? preferences[key] : definition.defaultValue;
      const value = safePreferenceValue(definition, candidate);
      if (value === undefined) {
        missing += 1;
        continue;
      }
      if (hasRaycastValue) copied += 1;
      else defaultsApplied += 1;
      if (definition.commandName) {
        const command = (commandValues[definition.commandName] ??= Object.create(null) as Record<
          string,
          unknown
        >);
        command[definition.name] = value;
      } else {
        values[definition.name] = value;
      }
    }

    const syncedAt = this.now().toISOString();
    const summary = { copied, defaultsApplied, missing, protected: protectedCount, syncedAt };
    return {
      state: {
        extensionId: extension.id,
        installationId: installation.installationId,
        values,
        commandValues,
        syncedAt,
        copied,
        defaultsApplied,
        missing,
        protected: protectedCount,
      },
      summary,
    };
  }
}

export function preferenceValuesForCommand(
  state: RaycastExtensionPreferenceState | undefined,
  commandName: string,
): Record<string, unknown> {
  if (!state) return {};
  return { ...state.values, ...(state.commandValues[commandName] ?? {}) };
}

export function discoverRaycastInstallations(preferences: PreferenceDictionary): RaycastInstallation[] {
  const installations = new Map<
    string,
    { name: string; installationId: string; preferenceKeys: Set<string> }
  >();
  const remember = (name: string, installationId: string, preferenceKey?: string) => {
    if (!STORE_SLUG.test(name) || !INSTALLATION_ID.test(installationId)) return;
    const key = `${name}\u0000${installationId}`;
    const installation = installations.get(key) ?? {
      name,
      installationId,
      preferenceKeys: new Set<string>(),
    };
    if (preferenceKey) installation.preferenceKeys.add(preferenceKey);
    installations.set(key, installation);
  };

  const expanded = preferences.commandsPreferencesExpandedItemIds;
  if (Array.isArray(expanded)) {
    for (const value of expanded) {
      if (typeof value !== 'string') continue;
      const match = /^extension_([a-z0-9][a-z0-9-]{0,99})__(dev|[a-f0-9-]{36})$/i.exec(value);
      if (match) remember(match[1]!.toLowerCase(), match[2]!.toLowerCase());
    }
  }

  for (const key of Object.keys(preferences)) {
    const preference = /^extension_([a-z0-9][a-z0-9-]{0,99})(?:\.([^_]+))?__(dev|[a-f0-9-]{36})_(.+)$/i.exec(
      key,
    );
    if (preference) {
      remember(preference[1]!.toLowerCase(), preference[3]!.toLowerCase(), key);
      continue;
    }
    const command = /^command-extension_([a-z0-9][a-z0-9-]{0,99})\.[^_]+__(dev|[a-f0-9-]{36})(?:_|-|$)/i.exec(
      key,
    );
    if (command) {
      remember(command[1]!.toLowerCase(), command[2]!.toLowerCase());
      continue;
    }
    const statusItem = /extension_([a-z0-9][a-z0-9-]{0,99})_[^_]+__(dev|[a-f0-9-]{36})$/i.exec(key);
    if (statusItem) remember(statusItem[1]!.toLowerCase(), statusItem[2]!.toLowerCase());
  }

  return [...installations.values()]
    .map(({ name, installationId, preferenceKeys }) => ({
      name,
      installationId,
      development: installationId === 'dev',
      detectedPreferenceCount: preferenceKeys.size,
    }))
    .sort((left, right) => humanizeSlug(left.name).localeCompare(humanizeSlug(right.name)));
}

export function parsePropertyListXML(xml: string): PreferenceDictionary {
  if (Buffer.byteLength(xml, 'utf8') > MAX_PREFERENCES_BYTES)
    throw new Error('Raycast preferences exceed Commander’s safe read limit');
  const tokens = xml.match(
    /<dict\s*\/>|<dict>|<\/dict>|<array\s*\/>|<array>|<\/array>|<key>[\s\S]*?<\/key>|<string\s*\/>|<string>[\s\S]*?<\/string>|<integer>[\s\S]*?<\/integer>|<real>[\s\S]*?<\/real>|<date>[\s\S]*?<\/date>|<data\s*\/>|<data>[\s\S]*?<\/data>|<true\s*\/>|<false\s*\/>/g,
  );
  if (!tokens?.length) throw new Error('Raycast preferences are not a readable property list');
  let index = 0;
  const parseValue = (): unknown => {
    const token = tokens[index++];
    if (!token) throw new Error('Raycast preferences ended unexpectedly');
    if (token === '<dict>') {
      const result = Object.create(null) as PreferenceDictionary;
      while (tokens[index] !== '</dict>') {
        const keyToken = tokens[index++];
        if (!keyToken?.startsWith('<key>'))
          throw new Error('Raycast preferences contain an invalid dictionary');
        const key = decodeXML(keyToken.slice(5, -6));
        result[key] = parseValue();
      }
      index += 1;
      return result;
    }
    if (/^<dict\s*\/>$/.test(token)) return Object.create(null) as PreferenceDictionary;
    if (token === '<array>') {
      const result: unknown[] = [];
      while (tokens[index] !== '</array>') result.push(parseValue());
      index += 1;
      return result;
    }
    if (/^<array\s*\/>$/.test(token)) return [];
    if (/^<true\s*\/>$/.test(token)) return true;
    if (/^<false\s*\/>$/.test(token)) return false;
    if (/^<string\s*\/>$/.test(token)) return '';
    if (token.startsWith('<string>')) return decodeXML(token.slice(8, -9));
    if (token.startsWith('<integer>')) return Number(token.slice(9, -10).trim());
    if (token.startsWith('<real>')) return Number(token.slice(6, -7).trim());
    if (token.startsWith('<date>')) return token.slice(6, -7).trim();
    if (/^<data\s*\/>$/.test(token)) return '';
    if (token.startsWith('<data>')) return token.slice(6, -7).replace(/\s+/g, '');
    throw new Error('Raycast preferences contain an unsupported value');
  };
  const parsed = parseValue();
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('Raycast preferences do not contain a root dictionary');
  return parsed as PreferenceDictionary;
}

async function loadRaycastPreferences(): Promise<PreferenceDictionary> {
  if (process.platform !== 'darwin') throw new Error('Raycast preferences are only available on macOS');
  const { stdout } = await execFile('/usr/bin/defaults', ['export', 'com.raycast.macos', '-'], {
    encoding: 'utf8',
    maxBuffer: MAX_PREFERENCES_BYTES,
    timeout: 5_000,
  });
  return parsePropertyListXML(stdout);
}

function preferenceKey(
  extensionName: string,
  installationId: string,
  definition: RaycastPreferenceDefinition,
): string {
  const scope = definition.commandName ? `${extensionName}.${definition.commandName}` : extensionName;
  return `extension_${scope}__${installationId}_${definition.name}`;
}

function safePreferenceValue(definition: RaycastPreferenceDefinition, value: unknown): unknown | undefined {
  if (value === undefined || value === null) return undefined;
  if (definition.type === 'checkbox') {
    if (typeof value !== 'boolean') return undefined;
  } else if (definition.type !== 'appPicker' && typeof value !== 'string') {
    return undefined;
  } else if (
    definition.type === 'appPicker' &&
    typeof value !== 'string' &&
    (typeof value !== 'object' || Array.isArray(value))
  ) {
    return undefined;
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return undefined;
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_SYNCED_VALUE_BYTES) return undefined;
  return structuredClone(value);
}

function humanizeSlug(value: string): string {
  return value
    .split('-')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function decodeXML(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, number: string) =>
      String.fromCodePoint(Number.parseInt(number, 16)),
    )
    .replace(/&#([0-9]+);/g, (_match, number: string) => String.fromCodePoint(Number.parseInt(number, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
