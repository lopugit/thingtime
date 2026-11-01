import { useCallback, useEffect, useState } from 'react';
import {
  extensionCommandItemId,
  fuzzyTextScore,
  type CommanderExtension,
  type CommanderSettings,
  type ExtensionCommand,
  type LocalRaycastExtension,
  type StoreExtension,
} from '@commander/protocol';
import {
  Check,
  Download,
  ExternalLink,
  FolderPlus,
  Keyboard,
  PackageCheck,
  RefreshCw,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { nativeRequest } from '../lib/nativeBridge.js';
import { clearsRecordedShortcut, formatShortcut, shortcutFromKeyboardEvent } from '../lib/shortcuts.js';
import { CommanderIcon } from './CommanderIcon.js';

type ExtensionMode = 'installed' | 'bundled' | 'store' | 'raycast';

const bundledExtensionIds = new Set(['builtin:emoji-symbols', 'builtin:calculator']);

export function ExtensionsSettings({
  initial,
  settings,
  onChange,
  onError,
}: {
  initial: CommanderExtension[];
  settings: CommanderSettings;
  onChange(next: CommanderSettings): void;
  onError(message: string | null): void;
}) {
  const [mode, setMode] = useState<ExtensionMode>('installed');
  const [query, setQuery] = useState('');
  const [installed, setInstalled] = useState(initial);
  const [store, setStore] = useState<StoreExtension[]>([]);
  const [raycast, setRaycast] = useState<LocalRaycastExtension[]>([]);
  const [raycastNotice, setRaycastNotice] = useState<string | null>(null);
  const [raycastLoading, setRaycastLoading] = useState(false);
  const [raycastPending, setRaycastPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [recordingCommandId, setRecordingCommandId] = useState<string | null>(null);

  const updateCommandShortcut = useCallback(
    async (itemId: string, shortcut: string | null) => {
      const commandShortcuts = { ...settings.commandShortcuts };
      if (shortcut) commandShortcuts[itemId] = shortcut;
      else delete commandShortcuts[itemId];
      try {
        await nativeRequest('commandHotkeys.update', {
          shortcuts: activeCommandShortcuts(commandShortcuts, installed),
        });
        onChange({ ...settings, commandShortcuts });
        onError(null);
      } catch (error) {
        onError(error instanceof Error ? error.message : 'Could not register that command shortcut');
      }
    },
    [installed, onChange, onError, settings],
  );

  useEffect(() => {
    if (!recordingCommandId) return;
    const captureShortcut = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        setRecordingCommandId(null);
        return;
      }
      if (clearsRecordedShortcut(event)) {
        const itemId = recordingCommandId;
        setRecordingCommandId(null);
        void updateCommandShortcut(itemId, null);
        return;
      }
      const shortcut = shortcutFromKeyboardEvent(event);
      if (!shortcut) return;
      const itemId = recordingCommandId;
      setRecordingCommandId(null);
      void updateCommandShortcut(itemId, shortcut);
    };
    window.addEventListener('keydown', captureShortcut, true);
    return () => window.removeEventListener('keydown', captureShortcut, true);
  }, [recordingCommandId, updateCommandShortcut]);

  const refreshRaycast = useCallback(async () => {
    setRaycastLoading(true);
    try {
      const response = await api.listRaycastExtensions();
      setRaycast(response.extensions);
      setRaycastNotice(response.message ?? null);
    } catch (error) {
      setRaycastNotice(error instanceof Error ? error.message : 'Could not read the local Raycast profile');
    } finally {
      setRaycastLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mode !== 'store') return;
    const timer = window.setTimeout(() => {
      void api
        .browseStore(query)
        .then(({ extensions }) => setStore(extensions))
        .catch((error: unknown) => {
          setMessage(error instanceof Error ? error.message : 'Could not browse the store');
        });
    }, 160);
    return () => window.clearTimeout(timer);
  }, [mode, query]);

  useEffect(() => {
    if (mode === 'raycast') void refreshRaycast();
  }, [mode, refreshRaycast]);

  const sideload = async () => {
    try {
      const selected = await nativeRequest<{ path?: string; allowUntrustedBuildScripts?: boolean }>(
        'extension.choose',
      );
      if (!selected?.path) return;
      const response = await api.sideload(selected.path, selected.allowUntrustedBuildScripts === true);
      setInstalled((current) => [
        response.extension,
        ...current.filter((item) => item.id !== response.extension.id),
      ]);
      const errors = response.preparation.diagnostics.filter((item) => item.severity === 'error');
      const ready = response.preparation.readyNoViewCommands;
      setMessage(
        errors.length
          ? `${response.extension.title} added with ${errors.length} compatibility issue${errors.length === 1 ? '' : 's'}; ${ready} no-view command${ready === 1 ? '' : 's'} ready.`
          : `${response.extension.title} added; ${ready} no-view command${ready === 1 ? '' : 's'} ready.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not sideload extension');
    }
  };

  const install = async (extension: StoreExtension) => {
    try {
      const target = extension.installUrl ?? extension.repositoryUrl;
      if (!target) throw new Error('This Store entry has no public source link');
      await nativeRequest('application.open', { path: target });
      setMessage(`Opened ${extension.title}. Check out its public source, then choose Sideload.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Installation failed');
    }
  };

  const addFromRaycast = async (extension: LocalRaycastExtension) => {
    setRaycastPending(extension.id);
    try {
      const response = await api.addRaycastExtension(extension.name, extension.installationId);
      setInstalled((current) => [
        response.extension,
        ...current.filter((item) => item.id !== response.extension.id),
      ]);
      setMessage(syncMessage(`${response.extension.title} added to Commander`, response.sync));
      await refreshRaycast();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not add the Raycast extension');
    } finally {
      setRaycastPending(null);
    }
  };

  const syncFromRaycast = async (extension: LocalRaycastExtension) => {
    setRaycastPending(extension.id);
    try {
      const response = await api.syncRaycastExtension(extension.name, extension.installationId);
      setMessage(syncMessage(`${response.extension.title} settings synced`, response.sync));
      await refreshRaycast();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not sync the Raycast settings');
    } finally {
      setRaycastPending(null);
    }
  };

  const normalizedQuery = query.trim().toLowerCase();
  const fuzzyMatches = (value: string) => !normalizedQuery || fuzzyTextScore(normalizedQuery, value) >= 0;
  const visibleInstalled = installed.flatMap((extension) => {
    const extensionMatches =
      !normalizedQuery ||
      fuzzyMatches(`${extension.title} ${extension.description} ${extension.author ?? ''}`);
    const commands = extension.commands.filter(
      (command) =>
        extensionMatches ||
        fuzzyMatches(`${command.title} ${command.description ?? ''} ${command.keywords.join(' ')}`),
    );
    return extensionMatches || commands.length ? [{ extension, commands }] : [];
  });
  const visibleBundled = installed.filter(
    (extension) =>
      extension.source === 'builtin' &&
      bundledExtensionIds.has(extension.id) &&
      fuzzyMatches(
        `${extension.title} ${extension.description} ${extension.commands.map((command) => command.title).join(' ')}`,
      ),
  );
  const visibleRaycast = raycast.filter((extension) =>
    fuzzyMatches(`${extension.title} ${extension.name} ${extension.description}`),
  );

  return (
    <div className="settings-page extensions-settings">
      <div className="extensions-toolbar">
        <label className="table-search">
          <Search />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search…" />
        </label>
        <div className="filter-tabs">
          <button
            className={mode === 'installed' ? 'active' : ''}
            type="button"
            onClick={() => setMode('installed')}
          >
            Installed
          </button>
          <button
            className={mode === 'bundled' ? 'active' : ''}
            type="button"
            onClick={() => setMode('bundled')}
          >
            Bundled
          </button>
          <button className={mode === 'store' ? 'active' : ''} type="button" onClick={() => setMode('store')}>
            Store
          </button>
          <button
            className={mode === 'raycast' ? 'active' : ''}
            type="button"
            onClick={() => setMode('raycast')}
          >
            Your Raycast
          </button>
        </div>
        <button type="button" className="toolbar-button" onClick={() => void sideload()}>
          <FolderPlus /> Sideload
        </button>
      </div>

      {message ? (
        <div className="inline-message" role="status">
          {message}
        </div>
      ) : null}

      {mode === 'raycast' && raycastNotice ? (
        <div className="raycast-notice" role="note">
          <ShieldCheck />
          <span>{raycastNotice}</span>
          <button type="button" onClick={() => void refreshRaycast()} disabled={raycastLoading}>
            <RefreshCw /> Refresh
          </button>
        </div>
      ) : null}

      {mode === 'installed' ? (
        <div className="extension-table" role="table">
          <div className="extension-head" role="row">
            <span>Name</span>
            <span>Type</span>
            <span>Shortcut</span>
            <span>Enabled</span>
          </div>
          {visibleInstalled.map(({ extension, commands }) => (
            <div className="extension-group" role="rowgroup" key={extension.id}>
              <div className="extension-row" role="row">
                <span className="extension-name">
                  <i>
                    <CommanderIcon name={extension.icon ?? 'extensions'} />
                  </i>
                  <span>
                    <strong>{extension.title}</strong>
                    <small>{extension.description}</small>
                  </span>
                </span>
                <span>Extension</span>
                <span className="command-count">
                  {commands.length} {commands.length === 1 ? 'command' : 'commands'}
                </span>
                <span className="enabled-check">{extension.enabled ? <Check /> : '—'}</span>
              </div>
              {commands.map((command) => {
                const itemId = extensionCommandItemId(extension.id, command.name);
                return (
                  <div className="extension-command-row" role="row" key={itemId}>
                    <span className="extension-command-name">
                      <i>
                        <Keyboard />
                      </i>
                      <span>
                        <strong>{command.title}</strong>
                        <small>{command.description ?? extension.title}</small>
                      </span>
                    </span>
                    <span>{commandModeLabel(command)}</span>
                    <span>
                      <CommandShortcutButton
                        title={command.title}
                        shortcut={settings.commandShortcuts[itemId]}
                        recording={recordingCommandId === itemId}
                        onClick={() =>
                          setRecordingCommandId((current) => (current === itemId ? null : itemId))
                        }
                      />
                    </span>
                    <span className="enabled-check">
                      {extension.enabled && !command.disabled ? <Check /> : '—'}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ) : mode === 'bundled' ? (
        <div className="bundled-command-section">
          <header className="bundled-command-heading">
            <span>
              <PackageCheck />
            </span>
            <div>
              <strong>Bundled Commands</strong>
              <small>Commander-native commands included with the app.</small>
            </div>
          </header>
          <div className="store-grid bundled-command-grid">
            {visibleBundled.length === 0 ? (
              <div className="raycast-empty">
                <CommanderIcon name="emoji" />
                <strong>No bundled commands found</strong>
                <span>Try searching for Calculator, Emoji, Symbols, or Commander.</span>
              </div>
            ) : null}
            {visibleBundled.map((extension) => (
              <article className="store-row bundled-command-row" key={extension.id}>
                <span className="store-icon">
                  <CommanderIcon name={extension.icon} />
                </span>
                <span className="store-copy">
                  <strong>{extension.title}</strong>
                  <span>{extension.description}</span>
                  <small>
                    {extension.id === 'builtin:calculator'
                      ? 'Automatic result provider'
                      : `${extension.commands.length} bundled ${extension.commands.length === 1 ? 'command' : 'commands'}`}{' '}
                    · by {extension.author ?? 'Thingtime'}
                  </small>
                  {extension.id === 'builtin:emoji-symbols' ? (
                    <>
                      <small>Inspired by the bundled Raycast Emoji &amp; Symbols command.</small>
                      <label className="bundled-preference-row">
                        <span>
                          <strong>Default Return action</strong>
                          <small>Choose what happens when you press Return on an emoji.</small>
                        </span>
                        <select
                          aria-label="Emoji default Return action"
                          value={settings.emojiDefaultAction}
                          onChange={(event) =>
                            onChange({
                              ...settings,
                              emojiDefaultAction: event.currentTarget
                                .value as CommanderSettings['emojiDefaultAction'],
                            })
                          }
                        >
                          <option value="paste">Paste to Current App (keep clipboard)</option>
                          <option value="paste-and-copy">Paste and Copy to Clipboard</option>
                          <option value="copy">Copy to Clipboard</option>
                          <option value="copy-unicode">Copy Unicode Code Points</option>
                        </select>
                      </label>
                    </>
                  ) : null}
                  {extension.id === 'builtin:calculator' ? (
                    <div className="bundled-preferences">
                      <label className="bundled-preference-row checkbox-preference">
                        <span>
                          <strong>Automatic results</strong>
                          <small>Detect complete expressions directly in the main search field.</small>
                        </span>
                        <input
                          type="checkbox"
                          aria-label="Show automatic calculator results"
                          checked={settings.calculator.enabled}
                          onChange={(event) =>
                            onChange({
                              ...settings,
                              calculator: { ...settings.calculator, enabled: event.currentTarget.checked },
                            })
                          }
                        />
                      </label>
                      <label className="bundled-preference-row">
                        <span>
                          <strong>Maximum decimal places</strong>
                          <small>Trailing zeroes are removed from the displayed answer.</small>
                        </span>
                        <select
                          aria-label="Calculator maximum decimal places"
                          value={settings.calculator.maxDecimalPlaces}
                          onChange={(event) =>
                            onChange({
                              ...settings,
                              calculator: {
                                ...settings.calculator,
                                maxDecimalPlaces: Number(event.currentTarget.value),
                              },
                            })
                          }
                        >
                          {[0, 2, 4, 6, 8, 10, 12, 14].map((places) => (
                            <option value={places} key={places}>
                              {places}
                            </option>
                          ))}
                        </select>
                      </label>
                      <small>
                        Functions use radians. Supported examples include sqrt(81), 5!, and 100 + 10%.
                      </small>
                    </div>
                  ) : null}
                  <span className="bundled-shortcut-list">
                    {extension.commands.map((command) => {
                      const itemId = extensionCommandItemId(extension.id, command.name);
                      return (
                        <span key={itemId}>
                          <span>{command.title}</span>
                          <CommandShortcutButton
                            title={command.title}
                            shortcut={settings.commandShortcuts[itemId]}
                            recording={recordingCommandId === itemId}
                            onClick={() =>
                              setRecordingCommandId((current) => (current === itemId ? null : itemId))
                            }
                          />
                        </span>
                      );
                    })}
                  </span>
                </span>
                <span className="bundled-badge">
                  <Check /> Built in
                </span>
              </article>
            ))}
          </div>
        </div>
      ) : mode === 'store' ? (
        <div className="store-grid">
          {store.map((extension) => (
            <article className="store-row" key={extension.id}>
              <span className="store-icon">
                {extension.iconUrl ? (
                  <img src={extension.iconUrl} alt="" />
                ) : (
                  <CommanderIcon name="extensions" />
                )}
              </span>
              <span className="store-copy">
                <strong>{extension.title}</strong>
                <span>{extension.description}</span>
                <small>by {extension.author}</small>
              </span>
              <button type="button" disabled={extension.installed} onClick={() => void install(extension)}>
                {extension.installed ? (
                  <>
                    <Check /> Installed
                  </>
                ) : (
                  <>
                    <ExternalLink /> View
                  </>
                )}
              </button>
            </article>
          ))}
        </div>
      ) : (
        <div className="store-grid raycast-grid" aria-busy={raycastLoading}>
          {!raycastLoading && visibleRaycast.length === 0 ? (
            <div className="raycast-empty">
              <CommanderIcon name="extensions" />
              <strong>No Raycast extensions found</strong>
              <span>Open or configure an extension in Raycast, then refresh this list.</span>
            </div>
          ) : null}
          {visibleRaycast.map((extension) => {
            const pending = raycastPending === extension.id;
            return (
              <article className="store-row raycast-row" key={extension.id}>
                <span className="store-icon">
                  <CommanderIcon name="extensions" />
                </span>
                <span className="store-copy">
                  <strong>{extension.title}</strong>
                  <span>{extension.description}</span>
                  <small>
                    {extension.detectedPreferenceCount} local setting
                    {extension.detectedPreferenceCount === 1 ? '' : 's'} detected
                    {extension.lastSyncedAt ? ` · ${extension.syncedPreferenceCount} synced` : ''}
                    {extension.protectedPreferenceCount
                      ? ` · ${extension.protectedPreferenceCount} password ${extension.protectedPreferenceCount === 1 ? 'field' : 'fields'} protected`
                      : ''}
                  </small>
                </span>
                {extension.installedInCommander ? (
                  <button type="button" disabled={pending} onClick={() => void syncFromRaycast(extension)}>
                    <RefreshCw /> {pending ? 'Syncing…' : 'Sync to Commander'}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={pending || !extension.canAdd}
                    title={
                      extension.canAdd
                        ? undefined
                        : 'Development extension source is outside Raycast; use Sideload to choose its folder.'
                    }
                    onClick={() => void addFromRaycast(extension)}
                  >
                    <Download /> {pending ? 'Adding…' : 'Add to Commander'}
                  </button>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function activeCommandShortcuts(
  shortcuts: CommanderSettings['commandShortcuts'],
  extensions: readonly CommanderExtension[],
): CommanderSettings['commandShortcuts'] {
  const activeItemIds = new Set(
    extensions.flatMap((extension) =>
      extension.enabled
        ? extension.commands
            .filter((command) => !command.disabled)
            .map((command) => extensionCommandItemId(extension.id, command.name))
        : [],
    ),
  );
  return Object.fromEntries(Object.entries(shortcuts).filter(([itemId]) => activeItemIds.has(itemId)));
}

function commandModeLabel(command: ExtensionCommand): string {
  if (command.mode === 'menu-bar') return 'Menu Bar';
  return command.mode === 'view' ? 'View Command' : 'Command';
}

function CommandShortcutButton({
  title,
  shortcut,
  recording,
  onClick,
}: {
  title: string;
  shortcut: string | undefined;
  recording: boolean;
  onClick(): void;
}) {
  const description = recording
    ? `Recording shortcut for ${title}`
    : shortcut
      ? `Rebind shortcut for ${title}, currently ${formatShortcut(shortcut)}`
      : `Record shortcut for ${title}`;
  return (
    <button
      type="button"
      className={recording ? 'command-hotkey-recorder recording' : 'command-hotkey-recorder'}
      aria-label={description}
      aria-pressed={recording}
      title={shortcut ? 'Click to rebind. Press Delete to clear.' : 'Click, then press a shortcut.'}
      onClick={onClick}
    >
      {recording ? 'Press shortcut…' : shortcut ? formatShortcut(shortcut) : 'Record Shortcut'}
    </button>
  );
}

function syncMessage(
  prefix: string,
  sync: { copied: number; defaultsApplied: number; missing: number; protected: number },
): string {
  const details = [`${sync.copied} copied`];
  if (sync.defaultsApplied) details.push(`${sync.defaultsApplied} defaults applied`);
  if (sync.protected) details.push(`${sync.protected} password fields left protected in Raycast`);
  if (sync.missing) details.push(`${sync.missing} unset`);
  return `${prefix}: ${details.join(' · ')}.`;
}
