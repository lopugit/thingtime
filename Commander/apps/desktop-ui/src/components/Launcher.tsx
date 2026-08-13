import { useCallback, useEffect, useRef } from 'react';
import { ArrowRight, Command, CornerDownLeft, Search } from 'lucide-react';
import type { CommanderState } from '../hooks/useCommander.js';
import { api } from '../lib/api.js';
import { hideLauncher, nativeRequest } from '../lib/nativeBridge.js';
import { ActionsPanel } from './ActionsPanel.js';
import { CommanderIcon } from './CommanderIcon.js';

export function Launcher({ state }: { state: CommanderState }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = state.hits[state.selectedIndex];

  useEffect(() => inputRef.current?.focus(), []);

  useEffect(() => {
    const selectedRow = document.querySelector<HTMLElement>('.result-row.selected');
    if (typeof selectedRow?.scrollIntoView === 'function') selectedRow.scrollIntoView({ block: 'nearest' });
  }, [state.selectedIndex]);

  const runAction = useCallback(
    async (actionId: string) => {
      try {
        if (!selected) return;
        if (actionId === 'open-settings') {
          await nativeRequest('settings.open');
          state.setActionsOpen(false);
          return;
        }
        const response = await api.execute(selected.id, actionId);
        if (response.nativeRequest && typeof response.nativeRequest === 'object') {
          const request = response.nativeRequest as {
            method: 'application.open' | 'filesystem.reveal' | 'clipboard.write' | 'extension.choose';
            params?: unknown;
          };
          const nativeResult = await nativeRequest<{ path?: string; allowUntrustedBuildScripts?: boolean }>(
            request.method,
            request.params,
          );
          if (request.method === 'extension.choose' && nativeResult?.path) {
            await api.sideload(nativeResult.path, nativeResult.allowUntrustedBuildScripts === true);
            await state.refresh();
          }
        }
        if (actionId === 'open' || actionId === 'run') await hideLauncher();
        state.reportError(null);
      } catch (error) {
        state.reportError(error instanceof Error ? error.message : 'Command failed');
      }
    },
    [selected, state],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (state.actionsOpen && ['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        state.setSelectedIndex(Math.min(state.hits.length - 1, state.selectedIndex + 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        state.setSelectedIndex(Math.max(0, state.selectedIndex - 1));
      } else if (event.key === 'Enter' && selected) {
        event.preventDefault();
        void runAction(selected.actions[0]?.id ?? 'open');
      } else if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        state.setActionsOpen(!state.actionsOpen);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        if (state.actionsOpen) state.setActionsOpen(false);
        else void hideLauncher();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [runAction, selected, state]);

  return (
    <main className="launcher-shell">
      <section className="launcher-panel" aria-label="Commander">
        <header className="search-bar">
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
            <span>{state.query ? 'Results' : 'Suggestions'}</span>
            <span>{state.hits.length}</span>
          </div>
          <div className="result-list" role="listbox" aria-label="Search results">
            {state.hits.map((hit, index) => (
              <button
                type="button"
                role="option"
                aria-selected={index === state.selectedIndex}
                className={index === state.selectedIndex ? 'result-row selected' : 'result-row'}
                key={hit.id}
                onMouseEnter={() => state.setSelectedIndex(index)}
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
                {index === state.selectedIndex ? (
                  <span className="result-enter">
                    <span>Open</span>
                    <CornerDownLeft />
                  </span>
                ) : (
                  <ArrowRight className="row-chevron" />
                )}
              </button>
            ))}
            {!state.hits.length ? (
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
