import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { ArrowRight, Command, CornerDownLeft, Search } from 'lucide-react';
import type { RecentSearch, RecentSearchCommand, SearchHit } from '@commander/protocol';
import { RECENT_SEARCH_PREVIEW_LIMIT } from '@commander/protocol';
import type { CommanderState } from '../hooks/useCommander.js';
import { beginWindowDrag, hideLauncher, nativeRequest } from '../lib/nativeBridge.js';
import { ActionsPanel } from './ActionsPanel.js';
import { CommanderIcon } from './CommanderIcon.js';

type HistoryRow =
  | { type: 'query'; search: RecentSearch }
  | { type: 'command'; search: RecentSearch; command: RecentSearchCommand };

function buildHistoryRows(searches: readonly RecentSearch[]): HistoryRow[] {
  return searches.flatMap((search) => [
    ...search.commands.map((command) => ({ type: 'command' as const, search, command })),
    { type: 'query' as const, search },
  ]);
}

function commandHistoryEntry(hit: SearchHit, actionId: string): RecentSearchCommand {
  const actionTitle = hit.actions.find((action) => action.id === actionId)?.title;
  return {
    itemId: hit.id,
    actionId,
    title: hit.title,
    kind: hit.kind,
    ...(hit.subtitle ? { subtitle: hit.subtitle } : {}),
    ...(hit.icon ? { icon: hit.icon } : {}),
    ...(actionTitle ? { actionTitle } : {}),
  };
}

export function Launcher({ state }: { state: CommanderState }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const lastPointerPosition = useRef<{ x: number; y: number } | null>(null);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const historyVisible = !state.query.trim() && state.recentSearches.length > 0;
  const visibleSearches = useMemo(
    () =>
      historyExpanded ? state.recentSearches : state.recentSearches.slice(0, RECENT_SEARCH_PREVIEW_LIMIT),
    [historyExpanded, state.recentSearches],
  );
  const historyRows = useMemo(() => buildHistoryRows(visibleSearches), [visibleSearches]);
  const historyCount = historyVisible ? historyRows.length : 0;
  const totalRows = historyCount + state.hits.length;
  const selectedHistoryRow =
    historyVisible && state.selectedIndex < historyCount ? historyRows[state.selectedIndex] : undefined;
  const selected = selectedHistoryRow ? undefined : state.hits[state.selectedIndex - historyCount];

  const selectFromPointer = useCallback(
    (index: number, event: ReactPointerEvent<HTMLElement>) => {
      const previous = lastPointerPosition.current;
      if (previous && previous.x === event.clientX && previous.y === event.clientY) return;
      lastPointerPosition.current = { x: event.clientX, y: event.clientY };
      state.setSelectedIndex(index);
    },
    [state],
  );

  useEffect(() => inputRef.current?.focus(), []);

  useEffect(() => {
    const resetHistory = () => setHistoryExpanded(false);
    window.addEventListener('commander:launcher-opened', resetHistory);
    return () => window.removeEventListener('commander:launcher-opened', resetHistory);
  }, []);

  useEffect(() => {
    const selectedRow = document.querySelector<HTMLElement>('.result-row.selected');
    if (typeof selectedRow?.scrollIntoView === 'function') selectedRow.scrollIntoView({ block: 'nearest' });
  }, [state.selectedIndex]);

  const runAction = useCallback(
    async (actionId: string) => {
      try {
        if (!selected) return;
        await state.rememberRecentSearch(state.query, commandHistoryEntry(selected, actionId));
        await state.executeCommand(selected.id, actionId);
      } catch (error) {
        state.reportError(error instanceof Error ? error.message : 'Command failed');
      }
    },
    [selected, state],
  );

  const runHistoryCommand = useCallback(
    async (row: Extract<HistoryRow, { type: 'command' }>) => {
      try {
        await state.rememberRecentSearch(row.search.query, row.command);
        await state.executeCommand(row.command.itemId, row.command.actionId);
      } catch (error) {
        state.reportError(error instanceof Error ? error.message : 'Command failed');
      }
    },
    [state],
  );

  const runSelected = useCallback(() => {
    if (selectedHistoryRow?.type === 'query') {
      state.setQuery(selectedHistoryRow.search.query);
      window.requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    if (selectedHistoryRow?.type === 'command') {
      void runHistoryCommand(selectedHistoryRow);
      return;
    }
    if (selected) void runAction(selected.actions[0]?.id ?? 'open');
  }, [runAction, runHistoryCommand, selected, selectedHistoryRow, state]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (state.actionsOpen && ['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        state.setSelectedIndex(Math.min(Math.max(0, totalRows - 1), state.selectedIndex + 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        state.setSelectedIndex(Math.max(0, state.selectedIndex - 1));
      } else if (event.key === 'Enter' && (selected || selectedHistoryRow)) {
        event.preventDefault();
        runSelected();
      } else if (selected && event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        state.setActionsOpen(!state.actionsOpen);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        if (state.actionsOpen) state.setActionsOpen(false);
        else
          void state
            .rememberRecentSearch(state.query)
            .then(hideLauncher)
            .catch((error: unknown) =>
              state.reportError(error instanceof Error ? error.message : 'Could not close Commander'),
            );
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [runSelected, selected, selectedHistoryRow, state, totalRows]);

  return (
    <main className="launcher-shell">
      <section className="launcher-panel" aria-label="Commander">
        <header className="search-bar" onMouseDown={beginWindowDrag}>
          <span className="commander-mark" aria-hidden="true">
            ›_
          </span>
          <Search className="search-leading" aria-hidden="true" />
          <input
            ref={inputRef}
            aria-label="Search apps and commands"
            autoComplete="off"
            placeholder="Search for apps and commands…"
            value={state.query}
            onChange={(event) => state.setQuery(event.target.value)}
            onKeyDown={(event) => {
              const selectsAll = event.metaKey || (event.ctrlKey && state.bootstrap?.platform !== 'macos');
              if (event.key.toLowerCase() === 'a' && selectsAll) {
                event.preventDefault();
                event.currentTarget.select();
              }
            }}
          />
          <span className="search-hint">Actions</span>
          <kbd>⌘ K</kbd>
        </header>

        <div className="result-region">
          <div className="section-heading">
            <span role="heading" aria-level={2}>
              {state.query ? 'Results' : historyVisible ? 'History' : 'Suggestions'}
            </span>
            {historyVisible ? (
              <span className="history-heading-actions">
                <span>
                  {visibleSearches.length} of {state.recentSearches.length}
                </span>
                {state.recentSearches.length > RECENT_SEARCH_PREVIEW_LIMIT ? (
                  <button
                    type="button"
                    className="history-toggle"
                    aria-controls="commander-history-results"
                    aria-expanded={historyExpanded}
                    onClick={() => {
                      setHistoryExpanded((current) => !current);
                      state.setSelectedIndex(0);
                    }}
                  >
                    {historyExpanded ? 'Show Less' : 'Show More'}
                  </button>
                ) : null}
              </span>
            ) : (
              <span>{state.hits.length}</span>
            )}
          </div>
          <div
            className="result-list"
            id={historyVisible ? 'commander-history-results' : undefined}
            role="listbox"
            aria-label="Search results"
          >
            {historyVisible
              ? historyRows.map((row, index) => {
                  const selectedRow = index === state.selectedIndex;
                  if (row.type === 'query') {
                    const commandCount = row.search.commands.length;
                    return (
                      <button
                        type="button"
                        role="option"
                        aria-selected={selectedRow}
                        className={selectedRow ? 'result-row selected' : 'result-row'}
                        key={`history:${row.search.query.toLowerCase()}`}
                        onPointerMove={(event) => selectFromPointer(index, event)}
                        onDoubleClick={() => state.setQuery(row.search.query)}
                      >
                        <span className="result-icon kind-history">
                          <CommanderIcon name="history" kind="command" />
                        </span>
                        <span className="result-copy">
                          <span className="result-title">{row.search.query}</span>
                          <span className="result-subtitle">
                            Search term
                            {commandCount
                              ? ` · ${commandCount} launched ${commandCount === 1 ? 'command' : 'commands'}`
                              : ''}
                          </span>
                        </span>
                        <span className="result-kind">History</span>
                        {selectedRow ? (
                          <span className="result-enter">
                            <span>Search</span>
                            <CornerDownLeft />
                          </span>
                        ) : (
                          <ArrowRight className="row-chevron" />
                        )}
                      </button>
                    );
                  }
                  return (
                    <button
                      type="button"
                      role="option"
                      aria-selected={selectedRow}
                      className={selectedRow ? 'result-row selected' : 'result-row'}
                      key={`history:${row.search.query.toLowerCase()}:${row.command.itemId}:${row.command.actionId}`}
                      onPointerMove={(event) => selectFromPointer(index, event)}
                      onDoubleClick={() => void runHistoryCommand(row)}
                    >
                      <span className={`result-icon kind-${row.command.kind}`}>
                        <CommanderIcon name={row.command.icon} kind={row.command.kind} />
                      </span>
                      <span className="result-copy">
                        <span className="result-title">{row.command.title}</span>
                        <span className="result-subtitle">
                          {row.command.actionTitle ?? 'Run again'} · from “{row.search.query}”
                        </span>
                      </span>
                      <span className="result-kind">Command</span>
                      {selectedRow ? (
                        <span className="result-enter">
                          <span>Run Again</span>
                          <CornerDownLeft />
                        </span>
                      ) : (
                        <ArrowRight className="row-chevron" />
                      )}
                    </button>
                  );
                })
              : null}
            {historyVisible ? (
              <div className="section-heading result-section-heading">
                <span role="heading" aria-level={2}>
                  Suggestions
                </span>
                <span>{state.hits.length}</span>
              </div>
            ) : null}
            {state.hits.map((hit, index) => {
              const rowIndex = historyCount + index;
              return (
                <button
                  type="button"
                  role="option"
                  aria-selected={rowIndex === state.selectedIndex}
                  className={`${rowIndex === state.selectedIndex ? 'result-row selected' : 'result-row'}${hit.path ? ' draggable-result' : ''}`}
                  key={hit.id}
                  onPointerMove={(event) => selectFromPointer(rowIndex, event)}
                  onPointerDown={(event) => {
                    if (event.button !== 0 || !hit.path) return;
                    state.setSelectedIndex(rowIndex);
                    void nativeRequest('filesystem.beginDrag', { path: hit.path }).catch((error: unknown) =>
                      state.reportError(error instanceof Error ? error.message : 'Could not drag that file'),
                    );
                  }}
                  onDoubleClick={() => void runAction(hit.actions[0]?.id ?? 'open')}
                >
                  <span className={`result-icon kind-${hit.kind}`}>
                    <CommanderIcon name={hit.icon} kind={hit.kind} />
                  </span>
                  <span className="result-copy">
                    <span className="result-title">{hit.title}</span>
                    {hit.subtitle ? <span className="result-subtitle">{hit.subtitle}</span> : null}
                  </span>
                  <span className="result-kind">{hit.kind === 'builtin' ? 'Command' : hit.kind}</span>
                  {rowIndex === state.selectedIndex ? (
                    <span className="result-enter">
                      <span>Open</span>
                      <CornerDownLeft />
                    </span>
                  ) : (
                    <ArrowRight className="row-chevron" />
                  )}
                </button>
              );
            })}
            {!totalRows ? (
              <div className="empty-state">
                <Command />
                <strong>No commands found</strong>
                <span>Try an application, extension, or Commander setting.</span>
              </div>
            ) : null}
          </div>
        </div>

        <footer className="launcher-footer">
          <span className="connection-dot" />
          <span>{state.bootstrap?.platform ?? 'desktop'}</span>
          {state.error ? (
            <span className="footer-error">{state.error}</span>
          ) : (
            <span>Commander is ready</span>
          )}
          <span className="footer-spacer" />
          <span>Navigate</span>
          <kbd>↑↓</kbd>
          <span>Open</span>
          <kbd>↵</kbd>
        </footer>
      </section>
      {state.actionsOpen && selected ? (
        <ActionsPanel item={selected} onAction={(id) => void runAction(id)} />
      ) : null}
    </main>
  );
}
