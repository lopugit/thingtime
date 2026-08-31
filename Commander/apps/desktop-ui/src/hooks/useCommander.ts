import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  BootstrapResponse,
  CommanderViewId,
  CommanderSettings,
  IndexingStatus,
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
  searchPending: boolean;
  resultsStale: boolean;
  indexingStatus: IndexingStatus | null;
  recentSearches: RecentSearch[];
  selectedIndex: number;
  actionsOpen: boolean;
  error: string | null;
  notice: string | null;
  activeView: CommanderViewId | null;
  setQuery(value: string): void;
  setSelectedIndex(value: number): void;
  setActionsOpen(value: boolean): void;
  setActiveView(value: CommanderViewId | null): void;
  rememberRecentSearch(value: string, command?: RecentSearchCommand): Promise<void>;
  executeCommand(itemId: string, actionId: string, searchQuery?: string): Promise<void>;
  reportError(value: string | null): void;
  saveSettings(settings: CommanderSettings): Promise<void>;
  refresh(): Promise<void>;
  refreshSearch(): void;
}

export function useCommander(): CommanderState {
  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
  const [query, setQueryState] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searchPending, setSearchPending] = useState(false);
  const [resultsStale, setResultsStale] = useState(false);
  const [indexingStatus, setIndexingStatus] = useState<IndexingStatus | null>(null);
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<CommanderViewId | null>(null);
  const [searchRefresh, setSearchRefresh] = useState(0);
  const requestSequence = useRef(0);
  const recentSearchSequence = useRef(0);
  const queryRef = useRef('');
  const recentSearchesRef = useRef<RecentSearch[]>([]);
  const knownIndexTimeouts = useRef(new Set<string>());
  const indexTimeoutsHydrated = useRef(false);

  const setQuery = useCallback((value: string) => {
    if (value !== queryRef.current) setResultsStale(true);
    queryRef.current = value;
    setQueryState(value);
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

  useEffect(() => {
    if (!bootstrap) return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const status = await api.indexingStatus();
        if (!cancelled) {
          setIndexingStatus(status);
          const attempts = status.timeoutAttempts ?? [];
          if (indexTimeoutsHydrated.current) {
            for (const attempt of attempts) {
              if (knownIndexTimeouts.current.has(attempt.id)) continue;
              knownIndexTimeouts.current.add(attempt.id);
              void nativeRequest('notification.show', {
                id: attempt.id,
                title: 'Commander indexing timed out',
                body: `${attempt.message} Open Search settings to adjust the limit.`,
              }).catch(() => undefined);
            }
          } else {
            for (const attempt of attempts) knownIndexTimeouts.current.add(attempt.id);
            indexTimeoutsHydrated.current = true;
          }
        }
      } catch {
        // Search remains available while the optional index status is temporarily unavailable.
      } finally {
        if (!cancelled) timer = window.setTimeout(() => void poll(), 5_000);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [bootstrap]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

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
    const controller = new AbortController();
    setSearchPending(true);
    const timer = window.setTimeout(() => {
      void api
        .streamSearch(
          query,
          (event) => {
            if (sequence !== requestSequence.current) return;
            if (event.hits.length || event.complete) {
              setHits((current) => (sameSearchHits(current, event.hits) ? current : event.hits));
              setResultsStale(false);
            }
            setSearchPending(!event.complete);
            setError(null);
          },
          controller.signal,
        )
        .then(
          () => {
            if (sequence === requestSequence.current) setSearchPending(false);
          },
          (reason: unknown) => {
            if (controller.signal.aborted || sequence !== requestSequence.current) return;
            setSearchPending(false);
            setError(reason instanceof Error ? reason.message : 'Search failed');
          },
        );
    }, 35);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [bootstrap, query, searchRefresh]);

  const refreshSearch = useCallback(() => setSearchRefresh((current) => current + 1), []);

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
    async (itemId: string, actionId: string, searchQuery = queryRef.current) => {
      let nativeRequestMethod: string | undefined;
      const response = await api.execute(itemId, actionId, searchQuery);
      if (response.notice) setNotice(response.notice);
      if (response.view) setActiveView(response.view.id);
      if (response.nativeRequest) {
        const request = response.nativeRequest;
        nativeRequestMethod = request.method;
        const nativeResult = await nativeRequest<{
          path?: string;
          allowUntrustedBuildScripts?: boolean;
          copied?: boolean;
          trashed?: boolean;
          deleted?: boolean;
        }>(request.method, request.params);
        if (request.method === 'extension.choose' && nativeResult?.path) {
          await api.sideload(nativeResult.path, nativeResult.allowUntrustedBuildScripts === true);
          await refresh();
        }
        if (request.method === 'filesystem.copy' && nativeResult?.copied) setNotice('Item copied');
        if (request.method === 'filesystem.trash' && nativeResult?.trashed) {
          setNotice('Moved to Trash');
          refreshSearch();
        }
        if (request.method === 'filesystem.delete' && nativeResult?.deleted) {
          setNotice('Deleted immediately');
          refreshSearch();
        }
      }
      const nativeOwnsLauncherLifecycle =
        nativeRequestMethod === 'launcher.hide' ||
        nativeRequestMethod === 'launcher.show' ||
        nativeRequestMethod === 'application.quit';
      if (
        (response.dismissLauncher || actionId === 'open' || actionId === 'run') &&
        !nativeOwnsLauncherLifecycle &&
        !response.view
      )
        await hideLauncher();
      setActionsOpen(false);
      setError(null);
    },
    [refresh, refreshSearch],
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
      searchPending,
      resultsStale,
      indexingStatus,
      recentSearches,
      selectedIndex,
      actionsOpen,
      error,
      notice,
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
      refreshSearch,
    }),
    [
      bootstrap,
      query,
      hits,
      searchPending,
      resultsStale,
      indexingStatus,
      recentSearches,
      selectedIndex,
      actionsOpen,
      error,
      notice,
      activeView,
      setQuery,
      rememberRecentSearch,
      executeCommand,
      saveSettings,
      refresh,
      refreshSearch,
    ],
  );
}

function sameSearchHits(current: readonly SearchHit[], next: readonly SearchHit[]): boolean {
  return (
    current.length === next.length &&
    current.every(
      (hit, index) =>
        hit.id === next[index]?.id &&
        hit.score === next[index]?.score &&
        hit.title === next[index]?.title &&
        hit.subtitle === next[index]?.subtitle &&
        hit.kind === next[index]?.kind &&
        hit.icon === next[index]?.icon &&
        hit.path === next[index]?.path &&
        hit.favourite === next[index]?.favourite &&
        hit.preferenceScore === next[index]?.preferenceScore &&
        hit.extensionId === next[index]?.extensionId &&
        hit.commandName === next[index]?.commandName &&
        hit.calculation?.expression === next[index]?.calculation?.expression &&
        hit.calculation?.result === next[index]?.calculation?.result &&
        hit.calculation?.label === next[index]?.calculation?.label &&
        hit.calculation?.resultWords === next[index]?.calculation?.resultWords &&
        hit.keywords.length === next[index]?.keywords.length &&
        hit.keywords.every((keyword, keywordIndex) => keyword === next[index]?.keywords[keywordIndex]) &&
        hit.actions.length === next[index]?.actions.length &&
        hit.actions.every((action, actionIndex) => {
          const nextAction = next[index]?.actions[actionIndex];
          return (
            action.id === nextAction?.id &&
            action.title === nextAction?.title &&
            action.shortcut === nextAction?.shortcut &&
            action.destructive === nextAction?.destructive
          );
        }) &&
        hit.matchedRanges.length === next[index]?.matchedRanges.length &&
        hit.matchedRanges.every(
          (range, rangeIndex) =>
            range.start === next[index]?.matchedRanges[rangeIndex]?.start &&
            range.end === next[index]?.matchedRanges[rangeIndex]?.end,
        ),
    )
  );
}
