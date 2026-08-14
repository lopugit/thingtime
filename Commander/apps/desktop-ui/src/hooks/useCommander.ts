import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BootstrapResponse, CommanderSettings, SearchHit } from '@commander/protocol';
import { addRecentSearch } from '@commander/protocol';
import { api } from '../lib/api.js';

export interface CommanderState {
  bootstrap: BootstrapResponse | null;
  query: string;
  hits: SearchHit[];
  recentSearches: string[];
  selectedIndex: number;
  actionsOpen: boolean;
  error: string | null;
  setQuery(value: string): void;
  setSelectedIndex(value: number): void;
  setActionsOpen(value: boolean): void;
  rememberRecentSearch(value: string): Promise<void>;
  reportError(value: string | null): void;
  saveSettings(settings: CommanderSettings): Promise<void>;
  refresh(): Promise<void>;
}

export function useCommander(): CommanderState {
  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
  const [query, setQueryState] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const recentSearchSequence = useRef(0);
  const queryRef = useRef('');
  const recentSearchesRef = useRef<string[]>([]);

  const setQuery = useCallback((value: string) => {
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

  const rememberRecentSearch = useCallback(async (value: string) => {
    const next = addRecentSearch(recentSearchesRef.current, value);
    const unchanged =
      next.length === recentSearchesRef.current.length &&
      next.every((query, index) => query === recentSearchesRef.current[index]);
    if (unchanged) return;

    recentSearchesRef.current = next;
    setRecentSearches(next);
    const sequence = ++recentSearchSequence.current;
    try {
      const response = await api.addRecentSearch(value);
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

  return useMemo(
    () => ({
      bootstrap,
      query,
      hits,
      recentSearches,
      selectedIndex,
      actionsOpen,
      error,
      setQuery,
      setSelectedIndex,
      setActionsOpen,
      rememberRecentSearch,
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
      setQuery,
      rememberRecentSearch,
      saveSettings,
      refresh,
    ],
  );
}
