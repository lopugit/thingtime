import { useEffect, useMemo, useState } from 'react';
import {
  COMMANDER_THINGTIME_ENVIRONMENTS,
  isSettingsTab,
  type CommanderSettings,
  type SettingsTab,
} from '@commander/protocol';
import {
  Activity,
  Box,
  Cloud,
  Info,
  KeyRound,
  Search,
  Settings2,
  SlidersHorizontal,
  UserRound,
} from 'lucide-react';
import type { CommanderState } from '../hooks/useCommander.js';
import { AccountSettings } from './AccountSettings.js';
import { ActivitySettings } from './ActivitySettings.js';
import { CloudSyncSettings } from './CloudSyncSettings.js';
import { ExtensionsSettings } from './ExtensionsSettings.js';
import { GeneralSettings } from './GeneralSettings.js';
import { FullDiskAccessCard, IndexingSettings } from './IndexingSettings.js';
import { SearchPreferencesSettings } from './SearchPreferencesSettings.js';
import { beginWindowDrag } from '../lib/nativeBridge.js';

const tabs: Array<{ id: SettingsTab; title: string; Icon: typeof Settings2 }> = [
  { id: 'general', title: 'General', Icon: Settings2 },
  { id: 'extensions', title: 'Extensions', Icon: Box },
  { id: 'search', title: 'Search', Icon: Search },
  { id: 'activity', title: 'Activity', Icon: Activity },
  { id: 'sync', title: 'Cloud Sync', Icon: Cloud },
  { id: 'account', title: 'Account', Icon: UserRound },
  { id: 'advanced', title: 'Advanced', Icon: SlidersHorizontal },
  { id: 'about', title: 'About', Icon: Info },
];

export function Settings({ state }: { state: CommanderState }) {
  const [tab, setTab] = useState<SettingsTab>(() => {
    const requested = new URLSearchParams(window.location.search).get('tab');
    return isSettingsTab(requested) ? requested : 'general';
  });
  const bootstrap = state.bootstrap!;

  useEffect(() => {
    const openTab = (event: Event) => {
      const requested = (event as CustomEvent<unknown>).detail;
      if (isSettingsTab(requested)) setTab(requested);
    };
    window.addEventListener('commander:settings-tab', openTab);
    return () => window.removeEventListener('commander:settings-tab', openTab);
  }, []);

  return (
    <main className="settings-shell">
      <header className="settings-titlebar" onMouseDown={beginWindowDrag}>
        <span className="commander-mark small" aria-hidden="true">
          ›_
        </span>
        <strong>Commander Settings</strong>
      </header>
      <nav className="settings-tabs" aria-label="Settings sections">
        {tabs.map(({ id, title, Icon }) => (
          <button
            type="button"
            className={tab === id ? 'selected' : ''}
            aria-current={tab === id ? 'page' : undefined}
            key={id}
            onClick={() => setTab(id)}
          >
            <Icon />
            <span>{title}</span>
          </button>
        ))}
      </nav>
      <div className="settings-content">
        {tab === 'general' ? (
          <GeneralSettings
            platform={bootstrap.platform}
            settings={bootstrap.settings}
            onChange={(next) => void state.saveSettings(next)}
            onError={state.reportError}
          />
        ) : null}
        {tab === 'extensions' ? (
          <ExtensionsSettings
            initial={bootstrap.extensions}
            settings={bootstrap.settings}
            onChange={(next) => void state.saveSettings(next)}
            onError={state.reportError}
          />
        ) : null}
        {tab === 'search' ? (
          <SearchSettings
            settings={bootstrap.settings}
            onChange={(next) => void state.saveSettings(next)}
            onError={state.reportError}
          />
        ) : null}
        {tab === 'activity' ? (
          <ActivitySettings
            settings={bootstrap.settings}
            onChange={(next) => void state.saveSettings(next)}
            onError={state.reportError}
          />
        ) : null}
        {tab === 'sync' ? (
          <CloudSyncSettings
            accounts={bootstrap.accounts}
            settings={bootstrap.settings}
            onSettings={(next) => void state.saveSettings(next)}
          />
        ) : null}
        {tab === 'account' ? (
          <AccountSettings
            accounts={bootstrap.accounts}
            settings={bootstrap.settings}
            onSettings={(next) => void state.saveSettings(next)}
            onRefresh={state.refresh}
          />
        ) : null}
        {tab === 'advanced' ? (
          <AdvancedSettings
            settings={bootstrap.settings}
            onChange={(next) => void state.saveSettings(next)}
          />
        ) : null}
        {tab === 'about' ? <AboutSettings platform={bootstrap.platform} /> : null}
      </div>
      {state.error ? (
        <div className="settings-error" role="alert">
          {state.error}
        </div>
      ) : null}
    </main>
  );
}

function AdvancedSettings({
  settings,
  onChange,
}: {
  settings: CommanderSettings;
  onChange(next: CommanderSettings): void;
}) {
  const [baseUrl, setBaseUrl] = useState(settings.thingtimeBaseUrl);
  const [clientId, setClientId] = useState(settings.thingtimeClientId);
  const [customName, setCustomName] = useState('');
  useEffect(() => setBaseUrl(settings.thingtimeBaseUrl), [settings.thingtimeBaseUrl]);
  useEffect(() => setClientId(settings.thingtimeClientId), [settings.thingtimeClientId]);

  const selectedEnvironment = useMemo(() => {
    const builtIn = COMMANDER_THINGTIME_ENVIRONMENTS.find(
      (environment) =>
        environment.baseUrl === settings.thingtimeBaseUrl &&
        environment.clientId === settings.thingtimeClientId,
    );
    if (builtIn) return builtIn.id;
    const custom = settings.thingtimeCustomEnvironments.find(
      (environment) =>
        environment.baseUrl === settings.thingtimeBaseUrl &&
        environment.clientId === settings.thingtimeClientId,
    );
    return custom ? `custom:${custom.id}` : 'custom-current';
  }, [settings.thingtimeBaseUrl, settings.thingtimeClientId, settings.thingtimeCustomEnvironments]);

  const activeCustomEnvironment = selectedEnvironment.startsWith('custom:')
    ? settings.thingtimeCustomEnvironments.find(
        (environment) => environment.id === selectedEnvironment.slice(7),
      )
    : undefined;

  useEffect(
    () => setCustomName(activeCustomEnvironment?.name ?? ''),
    [activeCustomEnvironment?.id, activeCustomEnvironment?.name],
  );

  const commit = (nextBaseUrl = baseUrl, nextClientId = clientId) => {
    const normalizedBaseUrl = nextBaseUrl.trim().replace(/\/+$/, '') || 'https://thingtime.com';
    const normalizedClientId = nextClientId.trim();
    onChange({ ...settings, thingtimeBaseUrl: normalizedBaseUrl, thingtimeClientId: normalizedClientId });
    setBaseUrl(normalizedBaseUrl);
    setClientId(normalizedClientId);
  };

  const chooseEnvironment = (value: string) => {
    if (value === 'custom-current') return;
    const selected = value.startsWith('custom:')
      ? settings.thingtimeCustomEnvironments.find((environment) => environment.id === value.slice(7))
      : COMMANDER_THINGTIME_ENVIRONMENTS.find((environment) => environment.id === value);
    if (!selected) return;
    commit(selected.baseUrl, selected.clientId);
  };

  const saveCustomEnvironment = () => {
    const name = customName.trim();
    const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, '');
    const normalizedClientId = clientId.trim();
    if (!name || !normalizedBaseUrl || !normalizedClientId) return;
    const id = activeCustomEnvironment?.id ?? `custom-${crypto.randomUUID()}`;
    const custom = { id, name, baseUrl: normalizedBaseUrl, clientId: normalizedClientId };
    const environments = activeCustomEnvironment
      ? settings.thingtimeCustomEnvironments.map((environment) =>
          environment.id === id ? custom : environment,
        )
      : [...settings.thingtimeCustomEnvironments, custom];
    onChange({
      ...settings,
      thingtimeBaseUrl: normalizedBaseUrl,
      thingtimeClientId: normalizedClientId,
      thingtimeCustomEnvironments: environments,
    });
  };

  const removeCustomEnvironment = () => {
    if (!activeCustomEnvironment) return;
    const production = COMMANDER_THINGTIME_ENVIRONMENTS[0];
    onChange({
      ...settings,
      thingtimeBaseUrl: production.baseUrl,
      thingtimeClientId: production.clientId,
      thingtimeCustomEnvironments: settings.thingtimeCustomEnvironments.filter(
        (environment) => environment.id !== activeCustomEnvironment.id,
      ),
    });
    setCustomName('');
  };

  return (
    <div className="settings-page advanced-settings">
      <div className="advanced-heading">
        <SlidersHorizontal />
        <div>
          <h2>Advanced</h2>
          <p>Commander includes its registered Thingtime app; override it only for another deployment.</p>
        </div>
      </div>
      <section className="advanced-card">
        <label>
          <span>Thingtime environment</span>
          <select
            aria-label="Thingtime environment"
            value={selectedEnvironment}
            onChange={(event) => chooseEnvironment(event.target.value)}
          >
            {COMMANDER_THINGTIME_ENVIRONMENTS.map((environment) => (
              <option key={environment.id} value={environment.id}>
                {environment.name}
              </option>
            ))}
            {settings.thingtimeCustomEnvironments.map((environment) => (
              <option key={environment.id} value={`custom:${environment.id}`}>
                {environment.name}
              </option>
            ))}
            {selectedEnvironment === 'custom-current' ? (
              <option value="custom-current">Custom configuration</option>
            ) : null}
          </select>
        </label>
        <label>
          <span>Thingtime URL</span>
          <input
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            onBlur={() => commit()}
            onKeyDown={(event) => event.key === 'Enter' && commit()}
            placeholder="https://thingtime.com"
            spellCheck={false}
          />
        </label>
        <label>
          <span>Public client ID override</span>
          <input
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            onBlur={() => commit()}
            onKeyDown={(event) => event.key === 'Enter' && commit()}
            placeholder="Commander app client ID"
            spellCheck={false}
          />
        </label>
      </section>
      <section className="custom-environment-card" aria-labelledby="custom-environments-heading">
        <div>
          <strong id="custom-environments-heading">Custom environments</strong>
          <span>
            Enter the Thingtime URL and public client ID above, then give that deployment a reusable name.
          </span>
        </div>
        <label>
          <span>Environment name</span>
          <input
            aria-label="Custom environment name"
            value={customName}
            onChange={(event) => setCustomName(event.target.value)}
            placeholder="Staging"
            maxLength={96}
          />
        </label>
        <div className="custom-environment-actions">
          <button
            type="button"
            className="primary-button"
            onClick={saveCustomEnvironment}
            disabled={!customName.trim()}
          >
            {activeCustomEnvironment ? 'Save custom environment' : 'Add custom environment'}
          </button>
          {activeCustomEnvironment ? (
            <button
              type="button"
              className="secondary-button danger-button"
              onClick={removeCustomEnvironment}
            >
              Remove
            </button>
          ) : null}
        </div>
      </section>
      <div className="callback-card">
        <KeyRound />
        <div>
          <strong>Registered callback origin</strong>
          <code>http://127.0.0.1:47820</code>
          <span>
            Commander ships with this public client registration and uses Authorization Code + PKCE. Access
            tokens stay in the macOS Keychain.
          </span>
        </div>
      </div>
    </div>
  );
}

function SearchSettings({
  settings,
  onChange,
  onError,
}: {
  settings: CommanderSettings;
  onChange(next: CommanderSettings): void;
  onError(value: string | null): void;
}) {
  return (
    <div className="settings-page search-settings">
      <div className="search-settings-heading">
        <Search />
        <div>
          <h2>Search</h2>
          <p>Control Commander’s local indexes and adaptive result ranking.</p>
        </div>
      </div>
      <div className="search-settings-stack">
        <FullDiskAccessCard onError={onError} />
        <div className="search-ranking-card">
          <Search />
          <div>
            <strong>Fuzzy and adaptive everywhere</strong>
            <span>
              Apps, commands, extensions, files, and folders tolerate spelling mistakes. Choices made for each
              search are learned locally so Commander ranks your preferred results first over time.
            </span>
          </div>
        </div>
        <SearchPreferencesSettings settings={settings} onChange={onChange} onError={onError} />
        <IndexingSettings settings={settings} onChange={onChange} onError={onError} />
      </div>
    </div>
  );
}

function AboutSettings({ platform }: { platform: string }) {
  return (
    <div className="settings-page simple-page">
      <span className="commander-mark large">›_</span>
      <h2>Commander 0.1</h2>
      <p>Thingtime’s fast, keyboard-first command launcher.</p>
      <small>React · TypeScript · Node · Rust · Swift · C# · {platform}</small>
    </div>
  );
}
