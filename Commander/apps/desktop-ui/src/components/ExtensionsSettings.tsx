import { useCallback, useEffect, useState } from 'react';
import type { CommanderExtension, LocalRaycastExtension, StoreExtension } from '@commander/protocol';
import { Check, Download, ExternalLink, FolderPlus, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api.js';
import { nativeRequest } from '../lib/nativeBridge.js';
import { CommanderIcon } from './CommanderIcon.js';

type ExtensionMode = 'installed' | 'store' | 'raycast';

export function ExtensionsSettings({ initial }: { initial: CommanderExtension[] }) {
  const [mode, setMode] = useState<ExtensionMode>('installed');
  const [query, setQuery] = useState('');
  const [installed, setInstalled] = useState(initial);
  const [store, setStore] = useState<StoreExtension[]>([]);
  const [raycast, setRaycast] = useState<LocalRaycastExtension[]>([]);
  const [raycastNotice, setRaycastNotice] = useState<string | null>(null);
  const [raycastLoading, setRaycastLoading] = useState(false);
  const [raycastPending, setRaycastPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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

  const visibleInstalled = installed.filter((extension) =>
    `${extension.title} ${extension.description} ${extension.author ?? ''}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const visibleRaycast = raycast.filter((extension) =>
    `${extension.title} ${extension.name} ${extension.description}`
      .toLowerCase()
      .includes(query.toLowerCase()),
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
            <span>Source</span>
            <span>Commands</span>
            <span>Enabled</span>
          </div>
          {visibleInstalled.map((extension) => (
            <div className="extension-row" role="row" key={extension.id}>
              <span className="extension-name">
                <i>
                  <CommanderIcon name="extensions" />
                </i>
                <span>
                  <strong>{extension.title}</strong>
                  <small>{extension.description}</small>
                </span>
              </span>
              <span>{extension.source}</span>
              <span>{extension.commands.length}</span>
              <span className="enabled-check">{extension.enabled ? <Check /> : '—'}</span>
            </div>
          ))}
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
