import { useEffect, useRef, useState } from 'react';
import {
  COMMANDER_THINGTIME_ENVIRONMENTS,
  type CommanderAccount,
  type CommanderSettings,
} from '@commander/protocol';
import { Check, Cloud, LogIn, RefreshCw, Trash2, UserRound } from 'lucide-react';
import { api } from '../lib/api.js';
import { nativeRequest } from '../lib/nativeBridge.js';

function environmentLabel(account: CommanderAccount, settings: CommanderSettings): string {
  const environment = account.environment;
  if (!environment) return 'Environment unavailable';

  const known = [
    ...COMMANDER_THINGTIME_ENVIRONMENTS,
    ...settings.thingtimeCustomEnvironments,
  ].find(
    (candidate) =>
      candidate.baseUrl === environment.baseUrl && candidate.clientId === environment.clientId,
  );
  if (known) return known.name;

  try {
    return `Custom · ${new URL(environment.baseUrl).hostname}`;
  } catch {
    return 'Custom environment';
  }
}

export function AccountSettings({
  accounts: initialAccounts,
  settings,
  onSettings,
  onRefresh,
}: {
  accounts: CommanderAccount[];
  settings: CommanderSettings;
  onSettings(next: CommanderSettings): void;
  onRefresh(): Promise<void>;
}) {
  const [accounts, setAccounts] = useState(initialAccounts);
  const [message, setMessage] = useState<string | null>(null);
  const reconciledAccountSignature = useRef<string | null>(null);
  const active = accounts.find((account) => account.id === settings.activeAccountId);
  useEffect(() => setAccounts(initialAccounts), [initialAccounts]);

  useEffect(() => {
    const accountIds = [...new Set(initialAccounts.map((account) => account.id))].sort();
    const signature = accountIds.join('\u0000');
    if (!signature || reconciledAccountSignature.current === signature) return;
    reconciledAccountSignature.current = signature;
    void (async () => {
      try {
        const native = await nativeRequest<{
          environments?: Array<{ accountId: string; baseUrl: string; clientId: string }>;
        }>('credential.environments', { accountIds });
        if (!native?.environments?.length) return;
        const reconciled = await api.reconcileAccountEnvironments(native.environments);
        setAccounts(reconciled.accounts);
        await onRefresh();
      } catch {
        // A missing/locked Keychain must not block account settings.
      }
    })();
  }, [initialAccounts, onRefresh]);

  const login = async () => {
    try {
      const { authorizeUrl } = await api.beginLogin();
      await nativeRequest('application.open', { path: authorizeUrl });
      setMessage(
        'Finish signing in with Thingtime in your browser. Commander will add the account after approval.',
      );
      for (let attempt = 0; attempt < 120; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1_000));
        const { credential } = await api.pendingCredential();
        if (!credential) continue;
        await nativeRequest('credential.claim', {
          ...credential,
          issuer: settings.thingtimeBaseUrl,
          clientId: settings.thingtimeClientId,
        });
        const refreshed = await api.bootstrap();
        setAccounts(refreshed.accounts);
        onSettings(refreshed.settings);
        await onRefresh();
        setMessage(
          `Connected @${refreshed.accounts.find((item) => item.id === credential.accountId)?.username ?? 'Thingtime'}`,
        );
        return;
      }
      setMessage('Sign-in is still waiting. You can close this window and try again.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not start Thingtime login');
    }
  };

  const switchTo = async (account: CommanderAccount) => {
    await api.switchAccount(account.id);
    onSettings({
      ...settings,
      activeAccountId: account.id,
      ...(account.environment
        ? {
            thingtimeBaseUrl: account.environment.baseUrl,
            thingtimeClientId: account.environment.clientId,
          }
        : {}),
    });
    await onRefresh();
    setMessage(`Switched to @${account.username}`);
  };

  const remove = async (account: CommanderAccount) => {
    await api.removeAccount(account.id);
    if (account.environment)
      await nativeRequest('credential.delete', {
        accountId: account.id,
        issuer: account.environment.baseUrl,
        clientId: account.environment.clientId,
      });
    const next = accounts.filter((item) => item.id !== account.id);
    setAccounts(next);
    if (settings.activeAccountId === account.id)
      onSettings({ ...settings, activeAccountId: next[0]?.id ?? null });
    await onRefresh();
  };

  const sync = async () => {
    try {
      const response = await api.sync();
      onSettings(response.settings);
      setMessage(`Cloud settings synced ${new Date(response.syncedAt).toLocaleTimeString()}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Cloud sync failed');
    }
  };

  return (
    <div className="settings-page account-settings">
      <section className="account-hero">
        <span className="account-avatar">
          {active?.avatarUrl ? <img src={active.avatarUrl} alt="" /> : <UserRound />}
        </span>
        <div>
          <h2>{active?.displayName ?? 'Thingtime Account'}</h2>
          <p>
            {active
              ? `@${active.username} · ${environmentLabel(active, settings)}`
              : 'Sign in to sync Commander everywhere.'}
          </p>
        </div>
        <button className="primary-button" type="button" onClick={() => void login()}>
          <LogIn /> Add account
        </button>
      </section>

      {message ? (
        <div className="inline-message" role="status">
          {message}
        </div>
      ) : null}

      <section className="account-list" aria-label="Thingtime accounts">
        <header>
          <span>Accounts</span>
          <span>{accounts.length}</span>
        </header>
        {accounts.length ? (
          accounts.map((account) => (
            <div className="account-row" key={account.id}>
              <span className="mini-avatar">
                {account.avatarUrl ? (
                  <img src={account.avatarUrl} alt="" />
                ) : (
                  account.username.slice(0, 1).toUpperCase()
                )}
              </span>
              <span className="account-copy">
                <strong>{account.displayName ?? account.username}</strong>
                <small>@{account.username}</small>
                <span className="account-environment">{environmentLabel(account, settings)}</span>
              </span>
              {account.id === settings.activeAccountId ? (
                <span className="active-account">
                  <Check /> Active
                </span>
              ) : (
                <button type="button" onClick={() => void switchTo(account)}>
                  Switch
                </button>
              )}
              <button
                className="icon-button danger"
                type="button"
                aria-label={`Remove ${account.username}`}
                onClick={() => void remove(account)}
              >
                <Trash2 />
              </button>
            </div>
          ))
        ) : (
          <div className="account-empty">No Thingtime account connected yet.</div>
        )}
      </section>

      <section className="sync-card">
        <Cloud />
        <div>
          <strong>Cloud settings sync</strong>
          <span>
            Portable appearance, text, window, and compact-mode preferences follow the active Thingtime
            account.
          </span>
        </div>
        <button type="button" disabled={!active} onClick={() => void sync()}>
          <RefreshCw /> Sync now
        </button>
      </section>
    </div>
  );
}
