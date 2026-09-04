import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  AppWindow,
  ArrowRight,
  Calculator,
  Command,
  CornerDownLeft,
  Files,
  PanelTop,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Search,
  Terminal,
} from 'lucide-react';
import type {
  IndexingStatus,
  RecentSearch,
  RecentSearchCommand,
  SearchCategory,
  SearchHit,
} from '@commander/protocol';
import { RECENT_SEARCH_PREVIEW_LIMIT } from '@commander/protocol';
import type { CommanderState } from '../hooks/useCommander.js';
import { beginWindowDrag, hideLauncher, nativeRequest } from '../lib/nativeBridge.js';
import { shortcutMatchesKeyboardEvent } from '../lib/shortcuts.js';
import { ActionsPanel } from './ActionsPanel.js';
import { CommanderIcon } from './CommanderIcon.js';
import { ResultContextMenu } from './ResultContextMenu.js';
import { ResultIcon } from './ResultIcon.js';

type HistoryRow =
  | { type: 'query'; search: RecentSearch }
  | { type: 'command'; search: RecentSearch; command: RecentSearchCommand };

type LauncherCategory = 'calculator' | SearchCategory;

type SearchGroup = {
  category: LauncherCategory;
  title: string;
  hits: SearchHit[];
  startIndex: number;
};

interface LauncherWindowState {
  windowId: string;
  pinned: boolean;
  pinningEnabled: boolean;
}

const categoryTitles: Record<LauncherCategory, string> = {
  calculator: 'Calculator',
  applications: 'Apps',
  commands: 'Commands',
  files: 'Files & Folders',
};

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

function categoryForHit(hit: SearchHit): LauncherCategory {
  if (hit.kind === 'calculator') return 'calculator';
  if (hit.kind === 'application') return 'applications';
  if (hit.kind === 'file' || hit.kind === 'directory') return 'files';
  return 'commands';
}

function groupedHits(
  hits: readonly SearchHit[],
  order: readonly SearchCategory[],
  initialIndex: number,
): { groups: SearchGroup[]; flattened: SearchHit[] } {
  const byCategory = new Map<LauncherCategory, SearchHit[]>([
    ['calculator', []],
    ['applications', []],
    ['commands', []],
    ['files', []],
  ]);
  for (const hit of hits) byCategory.get(categoryForHit(hit))?.push(hit);
  const priority = new Map(order.map((category, index) => [category, index]));
  const populated = [...byCategory.entries()]
    .filter((entry): entry is [LauncherCategory, SearchHit[]] => entry[1].length > 0)
    .sort(
      ([leftCategory, left], [rightCategory, right]) =>
        Number(rightCategory === 'calculator') - Number(leftCategory === 'calculator') ||
        (right[0]?.score ?? 0) - (left[0]?.score ?? 0) ||
        (leftCategory === 'calculator' ? -1 : (priority.get(leftCategory) ?? 99)) -
          (rightCategory === 'calculator' ? -1 : (priority.get(rightCategory) ?? 99)),
    );
  let offset = initialIndex;
  const groups = populated.map(([category, categoryHits]) => {
    const group = {
      category,
      title: categoryTitles[category],
      hits: categoryHits,
      startIndex: offset,
    };
    offset += categoryHits.length;
    return group;
  });
  return { groups, flattened: groups.flatMap((group) => group.hits) };
}

function displayTitle(hit: SearchHit): string {
  return hit.kind === 'application' ? hit.title.replace(/\.app$/i, '') : hit.title;
}

function indexActivity(status: IndexingStatus | null): string | null {
  const progress = status?.progress;
  if (progress) {
    const count = progress.processed.toLocaleString();
    const total = progress.total?.toLocaleString();
    return `${progress.label} · ${count}${total ? ` / ${total}` : ''}`;
  }
  const scope = status?.running[0];
  if (!scope) return null;
  const label = scope === 'all' ? 'Everything' : scope[0]!.toUpperCase() + scope.slice(1);
  return `Indexing ${label}…`;
}

export function Launcher({ state }: { state: CommanderState }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pinControlRef = useRef<HTMLDivElement>(null);
  const lastPointerPosition = useRef<{ x: number; y: number } | null>(null);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ item: SearchHit; x: number; y: number } | null>(null);
  const [pinMenuOpen, setPinMenuOpen] = useState(false);
  const [windowState, setWindowState] = useState<LauncherWindowState>({
    windowId: 'browser',
    pinned: state.bootstrap?.settings.windowPinning.defaultPinned ?? false,
    pinningEnabled: state.bootstrap?.settings.windowPinning.enabled ?? false,
  });
  const historyVisible = !state.query.trim() && state.recentSearches.length > 0;
  const visibleSearches = useMemo(
    () =>
      historyExpanded ? state.recentSearches : state.recentSearches.slice(0, RECENT_SEARCH_PREVIEW_LIMIT),
    [historyExpanded, state.recentSearches],
  );
  const historyRows = useMemo(() => buildHistoryRows(visibleSearches), [visibleSearches]);
  const historyCount = historyVisible ? historyRows.length : 0;
  const searchGroups = useMemo(
    () =>
      groupedHits(
        state.hits,
        state.bootstrap?.settings.resultCategoryOrder ?? ['applications', 'commands', 'files'],
        historyCount,
      ),
    [historyCount, state.bootstrap?.settings.resultCategoryOrder, state.hits],
  );
  const totalRows = historyCount + searchGroups.flattened.length;
  const selectedHistoryRow =
    historyVisible && state.selectedIndex < historyCount ? historyRows[state.selectedIndex] : undefined;
  const selected = selectedHistoryRow
    ? undefined
    : searchGroups.flattened[state.selectedIndex - historyCount];
  const activity = indexActivity(state.indexingStatus);

  const selectFromPointer = useCallback(
    (index: number, event: ReactPointerEvent<HTMLElement>) => {
      const previous = lastPointerPosition.current;
      if (previous && previous.x === event.clientX && previous.y === event.clientY) return;
      lastPointerPosition.current = { x: event.clientX, y: event.clientY };
      state.setSelectedIndex(index);
    },
    [state],
  );

  const refreshWindowState = useCallback(async () => {
    const next = await nativeRequest<LauncherWindowState>('launcher.state');
    if (next) setWindowState(next);
  }, []);

  const setPinned = useCallback(
    async (pinned: boolean) => {
      try {
        const next = await nativeRequest<LauncherWindowState>('launcher.pin', { pinned });
        if (next) setWindowState(next);
        setPinMenuOpen(false);
      } catch (error) {
        state.reportError(error instanceof Error ? error.message : 'Could not change the window pin');
      }
    },
    [state],
  );

  useEffect(() => inputRef.current?.focus(), []);

  useEffect(() => {
    const resetHistory = () => {
      setHistoryExpanded(false);
      setContextMenu(null);
      void refreshWindowState();
    };
    const updateWindowState = (event: Event) => {
      const detail = (event as CustomEvent<LauncherWindowState>).detail;
      if (detail && typeof detail.pinned === 'boolean') setWindowState(detail);
    };
    window.addEventListener('commander:launcher-opened', resetHistory);
    window.addEventListener('commander:window-state', updateWindowState);
    void refreshWindowState();
    return () => {
      window.removeEventListener('commander:launcher-opened', resetHistory);
      window.removeEventListener('commander:window-state', updateWindowState);
    };
  }, [refreshWindowState]);

  useEffect(() => {
    if (!pinMenuOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (pinControlRef.current?.contains(event.target as Node)) return;
      setPinMenuOpen(false);
    };
    window.addEventListener('pointerdown', dismiss, true);
    return () => window.removeEventListener('pointerdown', dismiss, true);
  }, [pinMenuOpen]);

  useEffect(() => {
    const selectedRow = document.querySelector<HTMLElement>(
      '.result-row.selected, .calculator-result.selected',
    );
    if (typeof selectedRow?.scrollIntoView === 'function') selectedRow.scrollIntoView({ block: 'nearest' });
  }, [state.selectedIndex]);

  const runHitAction = useCallback(
    async (hit: SearchHit, actionId: string) => {
      try {
        if (state.resultsStale) return;
        await state.rememberRecentSearch(state.query, commandHistoryEntry(hit, actionId));
        await state.executeCommand(hit.id, actionId, state.query);
      } catch (error) {
        state.reportError(error instanceof Error ? error.message : 'Command failed');
      }
    },
    [state],
  );

  const runAction = useCallback(
    async (actionId: string) => {
      if (selected) await runHitAction(selected, actionId);
    },
    [runHitAction, selected],
  );

  const runHistoryCommand = useCallback(
    async (row: Extract<HistoryRow, { type: 'command' }>) => {
      try {
        await state.rememberRecentSearch(row.search.query, row.command);
        await state.executeCommand(row.command.itemId, row.command.actionId, row.search.query);
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
    if (selected) void runHitAction(selected, selected.actions[0]?.id ?? 'open');
  }, [runHistoryCommand, runHitAction, selected, selectedHistoryRow, state]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const pinning = state.bootstrap?.settings.windowPinning;
      if (pinning?.enabled && shortcutMatchesKeyboardEvent(pinning.shortcut, event)) {
        event.preventDefault();
        event.stopPropagation();
        void setPinned(!windowState.pinned);
        return;
      }
      if (state.actionsOpen && ['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        state.setSelectedIndex(Math.min(Math.max(0, totalRows - 1), state.selectedIndex + 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        state.setSelectedIndex(Math.max(0, state.selectedIndex - 1));
      } else if (event.key === 'Enter' && (selectedHistoryRow || (selected && !state.resultsStale))) {
        event.preventDefault();
        runSelected();
      } else if (
        selected &&
        !state.resultsStale &&
        event.key.toLowerCase() === 'k' &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault();
        state.setActionsOpen(!state.actionsOpen);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        if (contextMenu) setContextMenu(null);
        else if (pinMenuOpen) setPinMenuOpen(false);
        else if (state.actionsOpen) state.setActionsOpen(false);
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
  }, [
    contextMenu,
    pinMenuOpen,
    runSelected,
    selected,
    selectedHistoryRow,
    setPinned,
    state,
    totalRows,
    windowState.pinned,
  ]);

  const renderHit = (hit: SearchHit, rowIndex: number) => {
    const rowSelected = rowIndex === state.selectedIndex;
    if (hit.kind === 'calculator' && hit.calculation) {
      return (
        <button
          type="button"
          role="option"
          aria-selected={rowSelected}
          aria-disabled={state.resultsStale}
          className={rowSelected ? 'calculator-result selected' : 'calculator-result'}
          key={hit.id}
          onPointerMove={(event) => selectFromPointer(rowIndex, event)}
          onDoubleClick={() => void runHitAction(hit, hit.actions[0]?.id ?? 'copy-result')}
        >
          <span className="calculator-side calculator-expression">
            <strong>{hit.calculation.expression}</strong>
            <small>{hit.calculation.label}</small>
          </span>
          <span className="calculator-arrow" aria-hidden="true">
            <ArrowRight />
          </span>
          <span className="calculator-side calculator-answer">
            <strong>{hit.calculation.result}</strong>
            {hit.calculation.resultWords ? <small>{hit.calculation.resultWords}</small> : null}
          </span>
          {rowSelected ? (
            <span className="calculator-enter">
              <span>{hit.actions[0]?.title ?? 'Copy Answer'}</span>
              <CornerDownLeft />
            </span>
          ) : null}
        </button>
      );
    }
    return (
      <button
        type="button"
        role="option"
        aria-selected={rowSelected}
        aria-disabled={state.resultsStale}
        className={`${rowSelected ? 'result-row selected' : 'result-row'}${hit.path ? ' draggable-result' : ''}`}
        key={hit.id}
        onPointerMove={(event) => selectFromPointer(rowIndex, event)}
        onPointerDown={(event) => {
          if (event.button !== 0 || !hit.path) return;
          if (state.resultsStale) return;
          state.setSelectedIndex(rowIndex);
          void nativeRequest('filesystem.beginDrag', { path: hit.path }).catch((error: unknown) =>
            state.reportError(error instanceof Error ? error.message : 'Could not drag that file'),
          );
        }}
        onContextMenu={(event) => {
          if (!hit.path) return;
          if (state.resultsStale) return;
          event.preventDefault();
          state.setSelectedIndex(rowIndex);
          state.setActionsOpen(false);
          setContextMenu({ item: hit, x: event.clientX, y: event.clientY });
        }}
        onDoubleClick={() => void runHitAction(hit, hit.actions[0]?.id ?? 'open')}
      >
        <ResultIcon
          icon={hit.icon}
          kind={hit.kind}
          path={hit.path}
          shouldLoadNativeIcon={!historyVisible && !state.resultsStale}
          nativeIconPriority={rowSelected ? 0 : 1 + Math.abs(rowIndex - state.selectedIndex)}
        />
        <span className="result-copy">
          <span className="result-title">{displayTitle(hit)}</span>
          {hit.subtitle ? <span className="result-subtitle">{hit.subtitle}</span> : null}
        </span>
        <span className="result-badges">
          {hit.kind === 'application' ? <span className="app-extension-badge">.app</span> : null}
          <span className="result-kind">{hit.kind === 'builtin' ? 'Command' : hit.kind}</span>
        </span>
        {rowSelected ? (
          <span className="result-enter">
            <span>{hit.actions[0]?.title ?? 'Open'}</span>
            <CornerDownLeft />
          </span>
        ) : (
          <ArrowRight className="row-chevron" />
        )}
      </button>
    );
  };

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
            aria-label="Search apps, commands, files and folders"
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            placeholder="Search apps, commands, files and folders…"
            spellCheck={false}
            value={state.query}
            onChange={(event) => state.setQuery(event.target.value)}
            onKeyDown={(event) => {
              const selectsAll = event.metaKey || (event.ctrlKey && state.bootstrap?.platform !== 'macos');
              if (event.key.toLowerCase() === 'a' && selectsAll) {
                event.preventDefault();
                event.currentTarget.select();
                return;
              }
            }}
          />
          <span className="search-hint">Actions</span>
          <kbd>⌘ K</kbd>
        </header>

        <div className="result-region">
          <div className="section-heading">
            <span role="heading" aria-level={2}>
              {historyVisible ? 'History' : 'Results'}
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
              <span className="result-count">
                {state.searchPending ? (
                  <RefreshCw className="search-spinner" aria-label="Updating results" />
                ) : null}
                {state.hits.length}
              </span>
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
            {historyVisible && searchGroups.groups.length ? (
              <div className="section-heading result-section-heading">
                <span role="heading" aria-level={2}>
                  Suggestions
                </span>
                <span>{state.hits.length}</span>
              </div>
            ) : null}
            {searchGroups.groups.map((group) => (
              <Fragment key={group.category}>
                <div className="category-heading">
                  <span>
                    {group.category === 'applications' ? <AppWindow /> : null}
                    {group.category === 'calculator' ? <Calculator /> : null}
                    {group.category === 'commands' ? <Terminal /> : null}
                    {group.category === 'files' ? <Files /> : null}
                    <span role="heading" aria-level={3}>
                      {group.title}
                    </span>
                  </span>
                  <span>{group.hits.length}</span>
                </div>
                {group.hits.map((hit, index) => renderHit(hit, group.startIndex + index))}
              </Fragment>
            ))}
            {!totalRows ? (
              <div className="empty-state">
                <Command />
                <strong>{state.searchPending ? 'Searching…' : 'No results found'}</strong>
                <span>
                  {state.searchPending
                    ? 'Checking commands and the filesystem index.'
                    : 'Try an application, command, file, folder, or Commander setting.'}
                </span>
              </div>
            ) : null}
          </div>
        </div>

        <footer className="launcher-footer">
          <span className={activity ? 'connection-dot indexing' : 'connection-dot'} />
          <span>{state.bootstrap?.platform ?? 'desktop'}</span>
          {state.error ? (
            <span className="footer-error">{state.error}</span>
          ) : activity ? (
            <span className="footer-index-progress">{activity}</span>
          ) : (
            <span>{state.notice ?? 'Commander is ready'}</span>
          )}
          <span className="footer-spacer" />
          <span>Navigate</span>
          <kbd>↑↓</kbd>
          <span>{selected?.kind === 'calculator' ? 'Copy Answer' : 'Open'}</span>
          <kbd>↵</kbd>
          <div className="pin-control" ref={pinControlRef}>
            <button
              type="button"
              className={windowState.pinned ? 'pin-button pinned' : 'pin-button'}
              aria-label={windowState.pinned ? 'Unpin Commander window' : 'Pin Commander window'}
              aria-pressed={windowState.pinned}
              disabled={!state.bootstrap?.settings.windowPinning.enabled}
              title="Click to pin · Right-click for window options"
              onClick={() => void setPinned(!windowState.pinned)}
              onContextMenu={(event) => {
                event.preventDefault();
                setPinMenuOpen((current) => !current);
              }}
            >
              <PanelTop />
              {windowState.pinned ? <span className="pin-indicator" /> : null}
            </button>
            {pinMenuOpen ? (
              <aside className="pin-menu" aria-label="Commander window options">
                <button type="button" onClick={() => void setPinned(!windowState.pinned)}>
                  {windowState.pinned ? <PinOff /> : <Pin />}
                  <span>{windowState.pinned ? 'Unpin Window' : 'Pin Window'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPinMenuOpen(false);
                    void nativeRequest('launcher.openNewWindow').catch((error: unknown) =>
                      state.reportError(
                        error instanceof Error ? error.message : 'Could not open a new window',
                      ),
                    );
                  }}
                >
                  <Plus />
                  <span>Open New Window</span>
                </button>
              </aside>
            ) : null}
          </div>
        </footer>
      </section>
      {state.actionsOpen && selected ? (
        <ActionsPanel item={selected} onAction={(id) => void runAction(id)} />
      ) : null}
      {contextMenu ? (
        <ResultContextMenu
          item={contextMenu.item}
          x={contextMenu.x}
          y={contextMenu.y}
          onAction={(actionId) => void runHitAction(contextMenu.item, actionId)}
          onDismiss={() => setContextMenu(null)}
        />
      ) : null}
    </main>
  );
}
