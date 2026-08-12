import { useEffect, useState } from 'react';
import type { CommanderSettings } from '@commander/protocol';
import { Box, Cloud, Info, KeyRound, Settings2, SlidersHorizontal, UserRound } from 'lucide-react';
import type { CommanderState } from '../hooks/useCommander.js';
import { AccountSettings } from './AccountSettings.js';
import { CloudSyncSettings } from './CloudSyncSettings.js';
import { ExtensionsSettings } from './ExtensionsSettings.js';
import { GeneralSettings } from './GeneralSettings.js';

type Tab = 'general' | 'extensions' | 'sync' | 'account' | 'advanced' | 'about';

const tabs: Array<{ id: Tab; title: string; Icon: typeof Settings2 }> = [
  { id: 'general', title: 'General', Icon: Settings2 },
  { id: 'extensions', title: 'Extensions', Icon: Box },
  { id: 'sync', title: 'Cloud Sync', Icon: Cloud },
  { id: 'account', title: 'Account', Icon: UserRound },
  { id: 'advanced', title: 'Advanced', Icon: SlidersHorizontal },
  { id: 'about', title: 'About', Icon: Info },
];

export function Settings({ state }: { state: CommanderState }) {
  const [tab, setTab] = useState<Tab>('general');
  const bootstrap = state.bootstrap!;

  return (
    <main className="settings-shell">
      <header className="settings-titlebar">
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
            settings={bootstrap.settings}
            onChange={(next) => void state.saveSettings(next)}
            onError={state.reportError}
          />
        ) : null}
        {tab === 'extensions' ? <ExtensionsSettings initial={bootstrap.extensions} /> : null}
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
  useEffect(() => setBaseUrl(settings.thingtimeBaseUrl), [settings.thingtimeBaseUrl]);
  useEffect(() => setClientId(settings.thingtimeClientId), [settings.thingtimeClientId]);

  const commit = () => {
    const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, '') || 'https://thingtime.com';
    onChange({ ...settings, thingtimeBaseUrl: normalizedBaseUrl, thingtimeClientId: clientId.trim() });
    setBaseUrl(normalizedBaseUrl);
    setClientId(clientId.trim());
  };

  return (
    <div className="settings-page advanced-settings">
      <div className="advanced-heading">
        <SlidersHorizontal />
        <div>
          <h2>Advanced</h2>
          <p>Connect this Commander installation to its registered Thingtime desktop app.</p>
        </div>
      </div>
      <section className="advanced-card">
        <label>
          <span>Thingtime URL</span>
          <input
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => event.key === 'Enter' && commit()}
            placeholder="https://thingtime.com"
            spellCheck={false}
          />
        </label>
        <label>
          <span>Public client ID</span>
          <input
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => event.key === 'Enter' && commit()}
            placeholder="Commander app client ID"
            spellCheck={false}
          />
        </label>
      </section>
      <div className="callback-card">
        <KeyRound />
        <div>
          <strong>Registered callback origin</strong>
          <code>http://127.0.0.1:47820</code>
          <span>
            Commander uses Authorization Code + PKCE. The client ID is public; access tokens stay in the macOS
            Keychain.
          </span>
        </div>
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
