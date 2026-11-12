import { useState } from 'react';
import type { CommanderAccount, CommanderSettings } from '@commander/protocol';
import { CheckCircle2, Cloud, RefreshCw } from 'lucide-react';
import { api } from '../lib/api.js';

export function CloudSyncSettings({
  accounts,
  settings,
  onSettings,
}: {
  accounts: CommanderAccount[];
  settings: CommanderSettings;
  onSettings(next: CommanderSettings): void;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const active = accounts.find((account) => account.id === settings.activeAccountId);

  const sync = async () => {
    setSyncing(true);
    try {
      const response = await api.sync();
      onSettings(response.settings);
      setMessage(`Synced ${new Date(response.syncedAt).toLocaleString()}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Cloud sync failed');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="settings-page cloud-sync-settings">
      <div className="cloud-hero">
        <span>
          <Cloud />
        </span>
        <div>
          <h2>Commander Cloud Sync</h2>
          <p>
            Keep portable appearance, text, window, and compact-mode preferences private to your active
            Thingtime account.
          </p>
        </div>
      </div>
      <section className="cloud-account-card">
        <div>
          <strong>{active ? `@${active.username}` : 'No active Thingtime account'}</strong>
          <span>
            {active ? 'Private app data is ready to sync.' : 'Add an account from the Account tab first.'}
          </span>
        </div>
        <button type="button" disabled={!active || syncing} onClick={() => void sync()}>
          <RefreshCw className={syncing ? 'spinning' : ''} /> {syncing ? 'Syncing…' : 'Sync now'}
        </button>
      </section>
      {message ? (
        <div className="sync-success" role="status">
          <CheckCircle2 />
          {message}
        </div>
      ) : null}
      <p className="cloud-note">
        Sync is explicit in this first release, so one device never silently overwrites another.
      </p>
    </div>
  );
}
