import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BootstrapResponse, CommanderSettings, SearchHit } from '@commander/protocol';
import { api } from '../lib/api.js';

export interface CommanderState {
  bootstrap: BootstrapResponse | null;
  query: string;
  hits: SearchHit[];
  selectedIndex: number;
  actionsOpen: boolean;
  error: string | null;
  setQuery(value: string): void;
  setSelectedIndex(value: number): void;
  setActionsOpen(value: boolean): void;
  reportError(value: string | null): void;
  saveSettings(settings: CommanderSettings): Promise<void>;
  refresh(): Promise<void>;
}

export function useCommander(): CommanderState {
  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const next = await api.bootstrap();
      setBootstrap(next);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Commander could not start');
    }
  }, []);

  useEffect(() => void refresh(), [refresh]);

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
      selectedIndex,
      actionsOpen,
      error,
      setQuery,
      setSelectedIndex,
      setActionsOpen,
      reportError: setError,
      saveSettings,
      refresh,
    }),
    [bootstrap, query, hits, selectedIndex, actionsOpen, error, saveSettings, refresh],
  );
}
