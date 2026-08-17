import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  BootstrapResponse,
  CommanderViewId,
  CommanderSettings,
  RecentSearch,
  RecentSearchCommand,
  SearchHit,
} from '@commander/protocol';
import { addRecentSearch } from '@commander/protocol';
import { api } from '../lib/api.js';
import { hideLauncher, nativeRequest } from '../lib/nativeBridge.js';

export interface CommanderState {
  bootstrap: BootstrapResponse | null;
  query: string;
  hits: SearchHit[];
  recentSearches: RecentSearch[];
  selectedIndex: number;
  actionsOpen: boolean;
  error: string | null;
  activeView: CommanderViewId | null;
  setQuery(value: string): void;
  setSelectedIndex(value: number): void;
  setActionsOpen(value: boolean): void;
  setActiveView(value: CommanderViewId | null): void;
  rememberRecentSearch(value: string, command?: RecentSearchCommand): Promise<void>;
  executeCommand(itemId: string, actionId: string): Promise<void>;
  reportError(value: string | null): void;
  saveSettings(settings: CommanderSettings): Promise<void>;
  refresh(): Promise<void>;
}

export function useCommander(): CommanderState {
  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
  const [query, setQueryState] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<CommanderViewId | null>(null);
  const requestSequence = useRef(0);
  const recentSearchSequence = useRef(0);
  const queryRef = useRef('');
  const recentSearchesRef = useRef<RecentSearch[]>([]);

  const setQuery = useCallback((value: string) => {
    queryRef.current = value;
    setQueryState(value);
    setHits([]);
    setSelectedIndex(0);
    setActionsOpen(false);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await api.bootstrap();
      setBootstrap(next);
      recentSearchesRef.current = next.recentSearches;
      setRecentSearches(next.recentSearches);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Commander could not start');
    }
  }, []);

  useEffect(() => void refresh(), [refresh]);

  const rememberRecentSearch = useCallback(async (value: string, command?: RecentSearchCommand) => {
    const next = addRecentSearch(recentSearchesRef.current, value, command);
    if (JSON.stringify(next) === JSON.stringify(recentSearchesRef.current)) return;

    recentSearchesRef.current = next;
    setRecentSearches(next);
    const sequence = ++recentSearchSequence.current;
    try {
      const response = await api.addRecentSearch(value, command);
      if (sequence !== recentSearchSequence.current) return;
      recentSearchesRef.current = response.recentSearches;
      setRecentSearches(response.recentSearches);
    } catch (reason) {
      if (sequence === recentSearchSequence.current)
        setError(reason instanceof Error ? reason.message : 'Could not save search history');
    }
  }, []);

  useEffect(() => {
    const handleLauncherOpened = () => {
      const previousQuery = queryRef.current;
      if (previousQuery.trim()) void rememberRecentSearch(previousQuery);
      setActiveView(null);
      setQuery('');
    };
    window.addEventListener('commander:launcher-opened', handleLauncherOpened);
    return () => window.removeEventListener('commander:launcher-opened', handleLauncherOpened);
  }, [rememberRecentSearch, setQuery]);

  useEffect(() => {
    if (!bootstrap) return;
    const sequence = ++requestSequence.current;
    const timer = window.setTimeout(() => {
      void api
        .search(query)
        .then(({ hits: next }) => {
          if (sequence !== requestSequence.current) return;
          setHits(next);
          setSelectedIndex(0);
          setError(null);
        })
        .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Search failed'));
    }, 35);
    return () => window.clearTimeout(timer);
  }, [bootstrap, query]);

  const saveSettings = useCallback(
    async (settings: CommanderSettings) => {
      setBootstrap((current) => (current ? { ...current, settings } : current));
      try {
        const response = await api.saveSettings(settings);
        setBootstrap((current) => (current ? { ...current, settings: response.settings } : current));
        setError(null);
      } catch (reason) {
        await refresh();
        setError(reason instanceof Error ? reason.message : 'Could not save settings');
      }
    },
    [refresh],
  );

  const executeCommand = useCallback(
    async (itemId: string, actionId: string) => {
      let nativeRequestMethod: string | undefined;
      const response = await api.execute(itemId, actionId);
      if (response.view) setActiveView(response.view.id);
      if (response.nativeRequest) {
        const request = response.nativeRequest;
        nativeRequestMethod = request.method;
        const nativeResult = await nativeRequest<{
          path?: string;
          allowUntrustedBuildScripts?: boolean;
        }>(request.method, request.params);
        if (request.method === 'extension.choose' && nativeResult?.path) {
          await api.sideload(nativeResult.path, nativeResult.allowUntrustedBuildScripts === true);
          await refresh();
        }
      }
      const nativeOwnsLauncherLifecycle =
        nativeRequestMethod === 'launcher.hide' ||
        nativeRequestMethod === 'launcher.show' ||
        nativeRequestMethod === 'application.quit';
      if ((actionId === 'open' || actionId === 'run') && !nativeOwnsLauncherLifecycle && !response.view)
        await hideLauncher();
      setActionsOpen(false);
      setError(null);
    },
    [refresh],
  );

  useEffect(() => {
    const runCommandHotkey = (event: Event) => {
      const itemId = (event as CustomEvent<unknown>).detail;
      if (typeof itemId !== 'string' || !itemId.startsWith('extension:')) return;
      void executeCommand(itemId, 'run').catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'Command shortcut failed');
      });
    };
    window.addEventListener('commander:command-hotkey', runCommandHotkey);
    return () => window.removeEventListener('commander:command-hotkey', runCommandHotkey);
  }, [executeCommand]);

  return useMemo(
    () => ({
      bootstrap,
      query,
      hits,
      recentSearches,
      selectedIndex,
      actionsOpen,
      error,
      activeView,
      setQuery,
      setSelectedIndex,
      setActionsOpen,
      setActiveView,
      rememberRecentSearch,
      executeCommand,
      reportError: setError,
      saveSettings,
      refresh,
    }),
    [
      bootstrap,
      query,
      hits,
      recentSearches,
      selectedIndex,
      actionsOpen,
      error,
      activeView,
      setQuery,
      rememberRecentSearch,
      executeCommand,
      saveSettings,
      refresh,
    ],
  );
}
