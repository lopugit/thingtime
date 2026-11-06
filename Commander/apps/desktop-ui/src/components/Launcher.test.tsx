// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { BootstrapResponse, SearchHit, IndexingStatus } from '@commander/protocol';
import { DEFAULT_SETTINGS } from '@commander/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommanderState } from '../hooks/useCommander.js';
import * as nativeFileIcons from '../lib/nativeFileIcons.js';
import { resetNativeFileIconSchedulerForTests } from '../lib/nativeFileIcons.js';
import { beginWindowDrag, hideLauncher, nativeRequest } from '../lib/nativeBridge.js';
import { Launcher, indexSummary } from './Launcher.js';

vi.mock('../lib/nativeBridge.js', () => ({
  beginWindowDrag: vi.fn(),
  hideLauncher: vi.fn(async () => undefined),
  nativeRequest: vi.fn(async () => undefined),
}));

const bootstrap: BootstrapResponse = {
  protocolVersion: 1,
  platform: 'macos',
  settings: DEFAULT_SETTINGS,
  accounts: [],
  extensions: [],
  recentSearches: [],
  capabilities: {
    nativeBridge: true,
    globalHotkey: true,
    secureCredentialStore: true,
    openAtLogin: true,
    sideloadPicker: true,
    filesystemIndex: true,
  },
};

const hits: SearchHit[] = [
  {
    id: 'builtin:settings',
    title: 'Commander Settings',
    subtitle: 'Change preferences',
    kind: 'builtin',
    keywords: ['settings'],
    icon: 'settings',
    favourite: true,
    actions: [{ id: 'open-settings', title: 'Open Settings' }],
    score: 100,
    matchedRanges: [],
  },
  {
    id: 'app:notes',
    title: 'Notes',
    subtitle: '/Applications/Notes.app',
    kind: 'application',
    keywords: ['app'],
    path: '/Applications/Notes.app',
    favourite: false,
    actions: [{ id: 'open', title: 'Open' }],
    score: 80,
    matchedRanges: [],
  },
];

function state(overrides: Partial<CommanderState> = {}): CommanderState {
  return {
    bootstrap,
    query: 'settings',
    hits,
    searchPending: false,
    resultsStale: false,
    indexingStatus: null,
    recentSearches: [],
    selectedIndex: 0,
    actionsOpen: false,
    error: null,
    notice: null,
    activeView: null,
    setQuery: vi.fn(),
    setSelectedIndex: vi.fn(),
    setActionsOpen: vi.fn(),
    setActiveView: vi.fn(),
    rememberRecentSearch: vi.fn(async () => undefined),
    executeCommand: vi.fn(async () => undefined),
    reportError: vi.fn(),
    saveSettings: vi.fn(),
    refresh: vi.fn(),
    refreshSearch: vi.fn(),
    ...overrides,
  };
}

describe('Launcher keyboard navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetNativeFileIconSchedulerForTests();
  });
  afterEach(() => {
    cleanup();
    resetNativeFileIconSchedulerForTests();
  });

  it('opens Settings without changing the query or running the selected result from keyboard focus', async () => {
    const commander = state({ query: 'notes', selectedIndex: 1 });
    render(<Launcher state={commander} />);
    const button = screen.getByRole('button', { name: 'Open Commander Settings' });
    button.focus();
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(commander.executeCommand).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() =>
      expect(commander.executeCommand).toHaveBeenCalledWith('builtin:settings', 'open-settings', ''),
    );
    expect(commander.setQuery).not.toHaveBeenCalled();
    expect(commander.rememberRecentSearch).not.toHaveBeenCalled();
  });

  it('reports Settings failures through the existing error surface', async () => {
    const commander = state({ executeCommand: vi.fn().mockRejectedValue(new Error('Settings unavailable')) });
    render(<Launcher state={commander} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Commander Settings' }));
    await waitFor(() => expect(commander.reportError).toHaveBeenCalledWith('Settings unavailable'));
  });

  it('returns focus to the previous app when Escape dismisses the launcher', async () => {
    const commander = state();
    render(<Launcher state={commander} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(hideLauncher).toHaveBeenCalledWith(true));
    expect(commander.rememberRecentSearch).toHaveBeenCalledWith(commander.query);
  });

  it('keeps focus in Commander when Escape only closes the actions panel', () => {
    const commander = state({ actionsOpen: true });
    render(<Launcher state={commander} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(commander.setActionsOpen).toHaveBeenCalledWith(false);
    expect(hideLauncher).not.toHaveBeenCalled();
  });

  it('moves selection down and opens the actions panel with Command-K', () => {
    const commander = state();
    render(<Launcher state={commander} />);
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(commander.setSelectedIndex).toHaveBeenCalledWith(1);
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(commander.setActionsOpen).toHaveBeenCalledWith(true);
  });

  it('only lets newly moved pointers change the selected search result', () => {
    Object.defineProperty(window, 'PointerEvent', { configurable: true, value: MouseEvent });
    const commander = state();
    const view = render(<Launcher state={commander} />);
    const secondRow = screen.getAllByRole('option')[1]!;

    fireEvent.pointerMove(secondRow, { clientX: 120, clientY: 220 });
    expect(commander.setSelectedIndex).toHaveBeenCalledWith(1);
    vi.mocked(commander.setSelectedIndex).mockClear();

    view.rerender(<Launcher state={{ ...commander, query: 'settings updated', selectedIndex: 0 }} />);
    const rowAfterSearchUpdate = screen.getAllByRole('option')[1]!;
    fireEvent.mouseEnter(rowAfterSearchUpdate);
    fireEvent.pointerMove(rowAfterSearchUpdate, { clientX: 120, clientY: 220 });
    expect(commander.setSelectedIndex).not.toHaveBeenCalled();

    fireEvent.pointerMove(rowAfterSearchUpdate, { clientX: 121, clientY: 220 });
    expect(commander.setSelectedIndex).toHaveBeenCalledWith(1);
  });

  it('routes launcher chrome mouse-down events to the native drag handler', () => {
    render(<Launcher state={state()} />);
    const launcher = screen.getByLabelText('Commander');
    fireEvent.mouseDown(launcher.querySelector('.commander-mark')!, { button: 0 });
    expect(beginWindowDrag).toHaveBeenCalledOnce();
  });

  it.each([
    ['Command-A on macOS', bootstrap, { metaKey: true }],
    ['Control-A on Windows', { ...bootstrap, platform: 'windows' as const }, { ctrlKey: true }],
  ])('selects the complete focused search query with %s', (_shortcut, platformBootstrap, modifier) => {
    render(<Launcher state={state({ bootstrap: platformBootstrap })} />);
    const input = screen.getByRole('textbox', {
      name: 'Search apps, commands, files and folders',
    }) as HTMLInputElement;
    input.focus();
    input.setSelectionRange(2, 5);

    fireEvent.keyDown(input, { key: 'a', ...modifier });

    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });

  it('preserves the standard macOS Control-A editing shortcut', () => {
    render(<Launcher state={state()} />);
    const input = screen.getByRole('textbox', {
      name: 'Search apps, commands, files and folders',
    }) as HTMLInputElement;
    input.focus();
    input.setSelectionRange(2, 5);

    fireEvent.keyDown(input, { key: 'a', ctrlKey: true });

    expect(input.selectionStart).toBe(2);
    expect(input.selectionEnd).toBe(5);
  });

  it('disables browser spelling and autocorrect UI in the root search field', () => {
    render(<Launcher state={state()} />);
    const input = screen.getByRole('textbox', {
      name: 'Search apps, commands, files and folders',
    });

    expect(input).toHaveAttribute('autocomplete', 'off');
    expect(input).toHaveAttribute('autocapitalize', 'none');
    expect(input).toHaveAttribute('autocorrect', 'off');
    expect(input).toHaveAttribute('spellcheck', 'false');
  });

  it('requests and renders the native Finder icon for path-backed results', async () => {
    const application = {
      ...hits[1]!,
      id: 'app:preview',
      title: 'Preview',
      subtitle: '/Applications/Preview.app',
      path: '/Applications/Preview.app',
    };
    vi.mocked(nativeRequest).mockImplementation(async (method) => {
      if (method === 'filesystem.icon') {
        return { dataUrl: 'data:image/png;base64,aWNvbg==' };
      }

      return undefined;
    });
    render(<Launcher state={state({ hits: [application], selectedIndex: 0 })} />);

    await waitFor(() =>
      expect(nativeRequest).toHaveBeenCalledWith('filesystem.icon', {
        path: '/Applications/Preview.app',
      }),
    );
    await waitFor(() => {
      const icon = document.querySelector('.result-native-icon');
      expect(icon).toHaveAttribute('src', 'data:image/png;base64,aWNvbg==');
      expect(icon?.closest('.result-icon')).toHaveClass('native-file-icon');
    });
  });

  it('loads every result icon through a bounded, selected-first bridge queue', async () => {
    const pathBackedHits: SearchHit[] = Array.from({ length: 30 }, (_, index) => ({
      ...hits[1]!,
      id: `file:batch-${index}`,
      title: `batch-${index}.txt`,
      subtitle: `/tmp/commander-batch-${index}.txt`,
      kind: 'file',
      path: `/tmp/commander-batch-${index}.txt`,
      score: 1_000 - index,
    }));
    const requestedPaths: string[] = [];
    const pendingReplies: Array<{
      path: string;
      resolve: (result: { dataUrl: string }) => void;
    }> = [];
    vi.mocked(nativeRequest).mockImplementation(((method: string, params?: unknown) => {
      if (method !== 'filesystem.icon') return Promise.resolve(undefined);
      const path = (params as { path: string }).path;
      requestedPaths.push(path);
      return new Promise((resolve: (result: { dataUrl: string }) => void) => {
        pendingReplies.push({ path, resolve });
      });
    }) as typeof nativeRequest);
    const selectedIndex = 17;
    render(<Launcher state={state({ hits: pathBackedHits, selectedIndex })} />);

    await waitFor(() => expect(requestedPaths).toHaveLength(2));
    expect(requestedPaths[0]).toBe(pathBackedHits[selectedIndex]!.path);
    expect(requestedPaths).toHaveLength(2);

    let resolvedReplies = 0;
    while (resolvedReplies < pathBackedHits.length) {
      await waitFor(() => expect(pendingReplies.length).toBeGreaterThan(resolvedReplies));
      const batch = pendingReplies.slice(resolvedReplies);
      batch.forEach(({ path, resolve }) => resolve({ dataUrl: `data:image/png;base64,${btoa(path)}` }));
      resolvedReplies += batch.length;
    }

    await waitFor(() => expect(requestedPaths).toHaveLength(pathBackedHits.length));
    expect(new Set(requestedPaths)).toEqual(new Set(pathBackedHits.map((hit) => hit.path)));
    await waitFor(() =>
      expect(document.querySelectorAll('.result-native-icon')).toHaveLength(pathBackedHits.length),
    );
  });

  it('reuses cached native Finder icons when a result is remounted', async () => {
    const application = {
      ...hits[1]!,
      id: 'app:cached-preview',
      path: '/Applications/Cached Preview.app',
    };
    vi.mocked(nativeRequest).mockResolvedValue({ dataUrl: 'data:image/png;base64,Y2FjaGVk' });
    const nativeIconCalls = () =>
      vi.mocked(nativeRequest).mock.calls.filter(([method]) => method === 'filesystem.icon');

    const first = render(<Launcher state={state({ hits: [application], selectedIndex: 0 })} />);
    await waitFor(() => expect(nativeIconCalls()).toHaveLength(1));
    await waitFor(() => expect(document.querySelector('.result-native-icon')).toBeTruthy());
    first.unmount();

    render(<Launcher state={state({ hits: [application], selectedIndex: 0 })} />);
    await waitFor(() => expect(document.querySelector('.result-native-icon')).toBeTruthy());
    expect(nativeIconCalls()).toHaveLength(1);
  });

  it('runs the selected primary action with Return', async () => {
    const commander = state({ selectedIndex: 1 });
    render(<Launcher state={commander} />);
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() =>
      expect(commander.executeCommand).toHaveBeenCalledWith('app:notes', 'open', 'settings'),
    );
    expect(commander.rememberRecentSearch).toHaveBeenCalledWith(
      'settings',
      expect.objectContaining({
        itemId: 'app:notes',
        actionId: 'open',
        title: 'Notes',
        kind: 'application',
      }),
    );
    expect(screen.getByRole('option', { name: /Notes/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('renders an automatic calculation before ordinary results and copies the answer with Return', async () => {
    const calculation: SearchHit = {
      id: 'builtin:calculator:result',
      title: '512',
      subtitle: '256*2',
      kind: 'calculator',
      keywords: [],
      icon: 'calculator',
      favourite: false,
      calculation: {
        expression: '256*2',
        result: '512',
        label: 'Product',
        resultWords: 'Five Hundred Twelve',
      },
      actions: [
        { id: 'copy-result', title: 'Copy Answer', shortcut: '↵' },
        { id: 'copy-expression', title: 'Copy Expression', shortcut: '⇧⌘C' },
      ],
      score: 1_000_000,
      matchedRanges: [],
    };
    const commander = state({ query: '256*2', hits: [...hits, calculation], selectedIndex: 0 });
    render(<Launcher state={commander} />);

    expect(screen.getAllByRole('heading', { level: 3 })[0]).toHaveTextContent('Calculator');
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveClass('calculator-result', 'selected');
    expect(options[0]).toHaveTextContent('256*2');
    expect(options[0]).toHaveTextContent('512');
    expect(options[0]).toHaveTextContent('Five Hundred Twelve');

    fireEvent.keyDown(window, { key: 'Enter' });

    await waitFor(() =>
      expect(commander.executeCommand).toHaveBeenCalledWith(
        'builtin:calculator:result',
        'copy-result',
        '256*2',
      ),
    );
    expect(commander.rememberRecentSearch).toHaveBeenCalledWith(
      '256*2',
      expect.objectContaining({ title: '512', kind: 'calculator', actionTitle: 'Copy Answer' }),
    );
  });

  it.each([
    ['Close Commander', 'close-commander'],
    ['Close Commander Window', 'close-commander-window'],
    ['Open Commander', 'open-commander'],
  ])('routes %s through the shared command executor', async (title, commandName) => {
    const item = {
      ...hits[0]!,
      id: `extension:builtin:commander:${commandName}`,
      title,
      subtitle: 'Commander',
      kind: 'extension' as const,
      extensionId: 'builtin:commander',
      commandName,
      actions: [{ id: 'run', title: `Run ${title}` }],
    };
    const commander = state({ hits: [item], selectedIndex: 0 });
    render(<Launcher state={commander} />);

    fireEvent.keyDown(window, { key: 'Enter' });

    await waitFor(() => expect(commander.executeCommand).toHaveBeenCalledWith(item.id, 'run', 'settings'));
  });

  it('renders and executes a macOS System shortcut as a System result', async () => {
    const item = {
      ...hits[0]!,
      id: 'extension:builtin:macos-system:open-accessibility-settings',
      title: 'Accessibility Settings',
      subtitle: 'macOS System',
      kind: 'system' as const,
      extensionId: 'builtin:macos-system',
      commandName: 'open-accessibility-settings',
      actions: [{ id: 'run', title: 'Open Accessibility Settings' }],
    };
    const commander = state({ hits: [item], selectedIndex: 0 });
    render(<Launcher state={commander} />);

    expect(screen.getByRole('option', { name: /Accessibility Settings/ })).toHaveTextContent('System');
    fireEvent.keyDown(window, { key: 'Enter' });

    await waitFor(() => expect(commander.executeCommand).toHaveBeenCalledWith(item.id, 'run', 'settings'));
  });

  it('opens a bundled command view without hiding the launcher', async () => {
    const item = {
      ...hits[0]!,
      id: 'extension:builtin:emoji-symbols:search-emoji-symbols',
      title: 'Search Emoji & Symbols',
      subtitle: 'Emoji & Symbols',
      kind: 'extension' as const,
      extensionId: 'builtin:emoji-symbols',
      commandName: 'search-emoji-symbols',
      actions: [{ id: 'run', title: 'Run Search Emoji & Symbols' }],
    };
    const commander = state({ hits: [item], selectedIndex: 0 });
    render(<Launcher state={commander} />);

    fireEvent.keyDown(window, { key: 'Enter' });

    await waitFor(() => expect(commander.executeCommand).toHaveBeenCalledWith(item.id, 'run', 'settings'));
  });

  it('shows the newest launched commands before a top-level search term and restores it with Return', () => {
    const commander = state({
      query: '',
      selectedIndex: 2,
      recentSearches: [
        {
          query: '1password',
          commands: [
            {
              itemId: 'app:1password',
              actionId: 'open',
              title: '1Password',
              subtitle: '/Applications/1Password.app',
              kind: 'application',
              actionTitle: 'Open',
            },
            {
              itemId: 'builtin:settings',
              actionId: 'open-settings',
              title: 'Commander Settings',
              subtitle: 'Change preferences',
              kind: 'builtin',
              actionTitle: 'Open Settings',
            },
          ],
        },
        { query: 'settings', commands: [] },
      ],
    });
    render(<Launcher state={commander} />);

    expect(screen.getByRole('heading', { name: /History/ })).toBeVisible();
    expect(screen.getByRole('heading', { name: /Suggestions/ })).toBeVisible();
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveTextContent('1Password');
    expect(options[1]).toHaveTextContent('Commander Settings');
    expect(options[2]).toHaveTextContent('1password');
    expect(options[2]).toHaveClass('result-row', 'selected');
    expect(options[2]).not.toHaveClass('history-query-row');
    expect(options[4]).toHaveTextContent('Commander Settings');

    fireEvent.keyDown(window, { key: 'Enter' });

    expect(commander.setQuery).toHaveBeenCalledWith('1password');
    expect(commander.executeCommand).not.toHaveBeenCalled();
  });

  it('runs a command from its search-session history with Return', async () => {
    const search = {
      query: 'passwords',
      commands: [
        {
          itemId: 'app:1password',
          actionId: 'open',
          title: '1Password',
          kind: 'application' as const,
          actionTitle: 'Open',
        },
      ],
    };
    const commander = state({ query: '', recentSearches: [search], selectedIndex: 0 });
    render(<Launcher state={commander} />);

    fireEvent.keyDown(window, { key: 'Enter' });

    await waitFor(() =>
      expect(commander.executeCommand).toHaveBeenCalledWith('app:1password', 'open', 'passwords'),
    );
    expect(commander.rememberRecentSearch).toHaveBeenCalledWith('passwords', search.commands[0]);
  });

  it('shows eight search sessions initially and expands the retained history interactively', () => {
    const recentSearches = Array.from({ length: 10 }, (_, index) => ({
      query: `search ${index}`,
      commands: [],
    }));
    const commander = state({ query: '', recentSearches });
    render(<Launcher state={commander} />);

    const showMore = screen.getByRole('button', { name: 'Show More' });
    expect(showMore).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('8 of 10')).toBeVisible();
    expect(screen.queryByRole('option', { name: /search 8/i })).not.toBeInTheDocument();

    fireEvent.click(showMore);

    expect(screen.getByRole('option', { name: /search 8/i })).toBeVisible();
    const showLess = screen.getByRole('button', { name: 'Show Less' });
    expect(showLess).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('10 of 10')).toBeVisible();

    fireEvent.click(showLess);
    expect(screen.queryByRole('option', { name: /search 8/i })).not.toBeInTheDocument();
    expect(commander.setSelectedIndex).toHaveBeenCalledWith(0);
  });

  it('navigates and executes the Command-K action selector', async () => {
    const actionHits = [
      {
        ...hits[1]!,
        actions: [
          { id: 'open', title: 'Open' },
          { id: 'copy-path', title: 'Copy Path' },
        ],
      },
    ];
    const commander = state({ hits: actionHits, selectedIndex: 0, actionsOpen: true });
    render(<Launcher state={commander} />);
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() =>
      expect(commander.executeCommand).toHaveBeenCalledWith('app:notes', 'copy-path', 'settings'),
    );
  });

  it('prepares a native file drag only for a result with an explicit source path', async () => {
    const commander = state({ hits: [hits[1]!], selectedIndex: 0 });
    render(<Launcher state={commander} />);
    const row = screen.getByRole('option', { name: /Notes/ });

    expect(row).toHaveClass('draggable-result');
    fireEvent.pointerDown(row, { button: 2 });
    expect(nativeRequest).not.toHaveBeenCalledWith('filesystem.beginDrag', expect.anything());
    fireEvent.pointerDown(row);

    await waitFor(() =>
      expect(nativeRequest).toHaveBeenCalledWith('filesystem.beginDrag', {
        path: '/Applications/Notes.app',
      }),
    );
    expect(commander.setSelectedIndex).toHaveBeenCalledWith(0);
  });

  it('groups ranked results and renders application names without the package suffix', () => {
    const application = { ...hits[1]!, title: 'Notes.app', score: 10_000 };
    render(<Launcher state={state({ hits: [hits[0]!, application] })} />);

    const headings = screen.getAllByRole('heading', { level: 3 });
    expect(headings.map((heading) => heading.textContent)).toEqual(['Apps', 'Commands']);
    expect(screen.getByText('Notes', { selector: '.result-title' })).toBeVisible();
    expect(screen.getByText('.app', { selector: '.app-extension-badge' })).toBeVisible();
  });

  it('opens a path-specific right-click menu with Finder, copy, trash, and delete actions', async () => {
    const file: SearchHit = {
      ...hits[1]!,
      id: 'index:file:report',
      title: 'report.pdf',
      subtitle: '/Users/test/report.pdf',
      path: '/Users/test/report.pdf',
      kind: 'file',
      actions: [
        { id: 'open', title: 'Open' },
        { id: 'show-in-finder', title: 'Show in Finder' },
        { id: 'copy-file', title: 'Copy' },
        { id: 'copy-path', title: 'Copy Path' },
        { id: 'move-to-trash', title: 'Move to Trash', destructive: true },
        { id: 'delete', title: 'Delete Immediately…', destructive: true },
      ],
    };
    const commander = state({ hits: [file], selectedIndex: 0 });
    render(<Launcher state={commander} />);

    fireEvent.contextMenu(screen.getByRole('option', { name: /report.pdf/ }), {
      clientX: 180,
      clientY: 140,
    });

    expect(screen.getByRole('menuitem', { name: /Show in Finder/ })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: /^Copy$/ })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: /Move to Trash/ })).toBeVisible();
    fireEvent.click(screen.getByRole('menuitem', { name: /Move to Trash/ }));
    await waitFor(() =>
      expect(commander.executeCommand).toHaveBeenCalledWith(file.id, 'move-to-trash', 'settings'),
    );
  });

  it('keeps stale results visible but non-executable while the next search is streaming', () => {
    const commander = state({ searchPending: true, resultsStale: true });
    render(<Launcher state={commander} />);

    const staleResult = screen.getByRole('option', { name: /Commander Settings/ });
    expect(staleResult).toHaveAttribute('aria-disabled', 'true');
    expect(staleResult).not.toHaveClass('stale-result');
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(commander.executeCommand).not.toHaveBeenCalled();
  });

  it('keeps one fixed loading spinner mounted while search results stream', () => {
    const commander = state({ hits: [], searchPending: true });
    const view = render(<Launcher state={commander} />);

    const spinner = screen.getByLabelText('Updating results');
    expect(spinner).toHaveClass('search-spinner');
    expect(view.container.querySelectorAll('.search-spinner')).toHaveLength(1);
    expect(screen.getByText('Searching…')).toBeVisible();

    view.rerender(<Launcher state={{ ...commander, hits }} />);

    expect(screen.getByLabelText('Updating results')).toBe(spinner);
    expect(view.container.querySelectorAll('.search-spinner')).toHaveLength(1);
  });

  it('shows searchable total and index age while indexing stays in the background', () => {
    render(
      <Launcher
        state={state({
          indexingStatus: {
            available: true,
            running: ['files'],
            totalRecords: 4_000,
            searchableRecords: 4_020,
            lastIndexedAtMs: Date.now() - 120_000,
            databaseSizeBytes: 1_024,
            kinds: [],
            commands: { count: 20 },
            automaticRefresh: { applicationsMinutes: 5, filesystemMinutes: 360 },
            customTimeoutMs: null,
            resourceLimits: DEFAULT_SETTINGS.indexing.resourceLimits,
            timing: { samples: 0 },
            timeoutAttempts: [],
            progress: {
              scope: 'files',
              label: 'Indexing Files',
              processed: 1_250,
              total: 4_000,
              startedAtMs: 1,
            },
          },
        })}
      />,
    );

    expect(screen.getByText('4,020 searchable items · indexed 2m ago')).toBeVisible();
    expect(screen.queryByText(/Indexing Files/)).toBeNull();
  });

  it('pins the current window and offers a right-click Open New Window action', async () => {
    vi.mocked(nativeRequest).mockImplementation(async (method) => {
      if (method === 'launcher.state') return { windowId: 'window-1', pinned: false, pinningEnabled: true };
      if (method === 'launcher.pin') return { windowId: 'window-1', pinned: true, pinningEnabled: true };
      return undefined;
    });
    render(<Launcher state={state()} />);
    const pin = screen.getByRole('button', { name: 'Pin Commander window' });

    fireEvent.click(pin);
    await waitFor(() => expect(nativeRequest).toHaveBeenCalledWith('launcher.pin', { pinned: true }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Unpin Commander window' })).toBeVisible());

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Unpin Commander window' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open New Window' }));
    await waitFor(() => expect(nativeRequest).toHaveBeenCalledWith('launcher.openNewWindow'));
  });

  it.each([false, true])(
    'toggles the shared new-window pin default from %s without pinning this window',
    async (defaultPinned) => {
      const settings = {
        ...DEFAULT_SETTINGS,
        windowPinning: { ...DEFAULT_SETTINGS.windowPinning, defaultPinned },
      };
      vi.mocked(nativeRequest).mockImplementation(async (method) =>
        method === 'launcher.state'
          ? { windowId: 'window-1', pinned: false, pinningEnabled: true }
          : undefined,
      );
      const commander = state({ bootstrap: { ...bootstrap, settings } });
      const view = render(<Launcher state={commander} />);
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Pin Commander window' })).toHaveAttribute(
          'aria-pressed',
          'false',
        ),
      );
      fireEvent.contextMenu(screen.getByRole('button', { name: 'Pin Commander window' }));
      const toggle = screen.getByRole('switch', { name: 'Open New Windows Pinned' });
      expect(toggle).toHaveAttribute('aria-checked', String(defaultPinned));
      fireEvent.click(toggle);
      const nextSettings = {
        ...settings,
        windowPinning: { ...settings.windowPinning, defaultPinned: !defaultPinned },
      };
      expect(commander.saveSettings).toHaveBeenCalledExactlyOnceWith(nextSettings);
      expect(nativeRequest).not.toHaveBeenCalledWith('launcher.pin', expect.anything());
      expect(screen.queryByRole('switch', { name: 'Open New Windows Pinned' })).not.toBeInTheDocument();

      view.rerender(
        <Launcher state={{ ...commander, bootstrap: { ...bootstrap, settings: nextSettings } }} />,
      );
      fireEvent.contextMenu(screen.getByRole('button', { name: 'Pin Commander window' }));
      expect(screen.getByRole('switch', { name: 'Open New Windows Pinned' })).toHaveAttribute(
        'aria-checked',
        String(!defaultPinned),
      );
      expect(screen.getByRole('button', { name: 'Pin Commander window' })).toHaveAttribute(
        'aria-pressed',
        'false',
      );

      // A failed save/refetch (or a change from General settings) must update the
      // checkmark from the shared settings, not leave a separate local toggle.
      view.rerender(<Launcher state={commander} />);
      expect(screen.getByRole('switch', { name: 'Open New Windows Pinned' })).toHaveAttribute(
        'aria-checked',
        String(defaultPinned),
      );
    },
  );
});

describe('launcher index summary', () => {
  const status: IndexingStatus = {
    available: true,
    running: ['all'],
    totalRecords: 0,
    databaseSizeBytes: 0,
    kinds: [],
    commands: { count: 0 },
    automaticRefresh: { applicationsMinutes: 360, filesystemMinutes: 360 },
    customTimeoutMs: null,
    resourceLimits: DEFAULT_SETTINGS.indexing.resourceLimits,
    timing: { samples: 0 },
    timeoutAttempts: [],
  };
  it('stays ready to search when eligible counts are unknown', () => {
    expect(indexSummary(null)).toBe('Ready to search');
    expect(indexSummary({ ...status, countsCurrent: false })).toBe('Ready to search');
  });
  it('shows a known count without implying a wait when its timestamp is unavailable', () => {
    expect(indexSummary({ ...status, searchableRecords: 42 })).toBe('42 searchable items');
  });
});

describe('Launcher held-arrow navigation', () => {
  const manyHits = Array.from({ length: 200 }, (_, index): SearchHit => ({
    ...hits[0]!,
    id: `command:${index}`,
    title: `Result ${index}`,
    score: 200 - index,
  }));
  function interactive(overrides: Partial<CommanderState> = {}) {
    const commander = state({ hits: manyHits, ...overrides });
    function Interactive({ changes = {} }: { changes?: Partial<CommanderState> }) {
      const [selectedIndex, setSelectedIndex] = useState(commander.selectedIndex);
      return <Launcher state={{ ...commander, selectedIndex, setSelectedIndex, ...changes }} />;
    }
    const view = render(<Interactive />);
    return {
      commander,
      ...view,
      update: (changes: Partial<CommanderState>) => view.rerender(<Interactive changes={changes} />),
    };
  }
  const selected = () =>
    screen.getAllByRole('option').findIndex((row) => row.getAttribute('aria-selected') === 'true');
  const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
    resetNativeFileIconSchedulerForTests();
    vi.useRealTimers();
  });

  it('moves on the first event, preserves burst taps before a render, and Enter runs the newest cursor', async () => {
    const { commander } = interactive();
    act(() => {
      for (let tap = 0; tap < 3; tap += 1) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }));
        window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown' }));
      }
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    });
    expect(selected()).toBe(3);
    await act(async () => {
      await Promise.resolve();
    });
    expect(commander.executeCommand).toHaveBeenCalledWith('command:3', 'open-settings', 'settings');
    advance(2_000);
    expect(selected()).toBe(3);
  });

  it('accelerates from elapsed hold time without OS repeat events and stops exactly on release', () => {
    interactive();
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(selected()).toBe(1);
    advance(179);
    expect(selected()).toBe(1);
    advance(1);
    expect(selected()).toBe(2);
    advance(420);
    const early = selected();
    advance(600);
    const middle = selected();
    advance(600);
    const late = selected();
    expect(middle - early).toBeGreaterThan(early - 1);
    expect(late - middle).toBeGreaterThan(middle - early);
    fireEvent.keyUp(window, { key: 'ArrowDown' });
    advance(5_000);
    expect(selected()).toBe(late);
  });

  it('ignores OS repeat events and reverses immediately without the old key release ending the new hold', () => {
    interactive({ selectedIndex: 30 });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    for (let repeat = 0; repeat < 10; repeat += 1)
      fireEvent.keyDown(window, { key: 'ArrowDown', repeat: true });
    expect(selected()).toBe(31);
    advance(180);
    expect(selected()).toBe(32);
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(selected()).toBe(31);
    fireEvent.keyUp(window, { key: 'ArrowDown' });
    advance(180);
    expect(selected()).toBe(30);
    fireEvent.keyUp(window, { key: 'ArrowUp' });
    advance(2_000);
    expect(selected()).toBe(30);
  });

  it.each(['blur', 'compositionstart', 'commander:launcher-opened', 'pointerdown'])(
    'cancels a held arrow on %s and does not restart from a stray native repeat',
    (event) => {
      interactive();
      fireEvent.keyDown(window, { key: 'ArrowDown' });
      advance(300);
      fireEvent(window, new Event(event));
      const stopped = selected();
      fireEvent.keyDown(window, { key: 'ArrowDown', repeat: true });
      advance(2_000);
      expect(selected()).toBe(stopped);
    },
  );

  it('cancels when hidden, when focus enters toolbar controls, and on unmount', () => {
    const view = interactive();
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    fireEvent(document, new Event('visibilitychange'));
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    advance(1_000);
    expect(selected()).toBe(1);
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    screen.getByRole('button', { name: 'Open Commander Settings' }).focus();
    advance(1_000);
    expect(selected()).toBe(2);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Open Commander Settings' }), { key: 'ArrowDown' });
    expect(selected()).toBe(2);
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    { query: 'different query' },
    { hits: [manyHits[0]!, manyHits[1]!, manyHits[2]!, manyHits[3]!] },
    { actionsOpen: true },
    { activeView: 'emoji-symbols' as const },
    { resultsStale: true },
  ])('cancels when navigation scope changes: %#', (changes) => {
    const view = interactive();
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    advance(300);
    const stopped = selected();
    view.update(changes);
    advance(2_000);
    expect(selected()).toBe(stopped);
  });

  it.each([
    { metaKey: true },
    { ctrlKey: true },
    { altKey: true },
    { shiftKey: true },
    { isComposing: true },
    { keyCode: 229 },
  ])('preserves modified arrow and input composition ownership: %j', (event) => {
    interactive();
    const input = screen.getByRole('textbox');
    expect(fireEvent.keyDown(input, { key: 'ArrowDown', ...event })).toBe(true);
    advance(2_000);
    expect(selected()).toBe(0);
  });

  it.each(['pin', 'context'])('stops mid-hold when the %s menu takes ownership', (menu) => {
    const view = interactive({
      hits: manyHits.map((hit) => ({ ...hit, path: `/tmp/${hit.id}`, kind: 'file' })),
    });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    advance(300);
    const stopped = selected();
    if (menu === 'pin') {
      fireEvent.contextMenu(screen.getByRole('button', { name: 'Pin Commander window' }));
    } else {
      fireEvent.contextMenu(screen.getAllByRole('option')[stopped]!);
    }
    fireEvent.keyDown(window, { key: 'ArrowDown', repeat: true });
    advance(2_000);
    expect(selected()).toBe(stopped);
    view.unmount();
  });

  it('keeps unrelated rows and their unresolved native icon requests mounted while selection moves', () => {
    const cancels = new Map<string, ReturnType<typeof vi.fn>>();
    const request = vi.spyOn(nativeFileIcons, 'requestNativeFileIcon').mockImplementation((path) => {
      const cancel = vi.fn();
      cancels.set(path, cancel);
      return { promise: new Promise(() => undefined), cancel };
    });
    try {
      interactive({
        hits: manyHits.slice(0, 20).map((hit) => ({ ...hit, path: `/tmp/${hit.id}`, kind: 'file' })),
      });
      const untouched = cancels.get('/tmp/command:19')!;
      for (let tap = 0; tap < 3; tap += 1) {
        fireEvent.keyDown(window, { key: 'ArrowDown' });
        fireEvent.keyUp(window, { key: 'ArrowDown' });
      }
      expect(selected()).toBe(3);
      expect(request.mock.calls.filter(([path]) => path === '/tmp/command:19')).toHaveLength(1);
      expect(untouched).not.toHaveBeenCalled();
    } finally {
      request.mockRestore();
    }
  });

  it('clamps at both terminal rows, cancels removed results and never wraps or queues catch-up', () => {
    const view = interactive({ hits: manyHits.slice(0, 3) });
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    advance(2_000);
    expect(selected()).toBe(0);
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    advance(2_000);
    expect(selected()).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
    view.update({ hits: [manyHits[0]!] });
    expect(selected()).toBe(0);
    advance(2_000);
    expect(selected()).toBe(0);
    view.update({ hits: [] });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    advance(2_000);
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('reveals an unchanged selection after its list viewport resizes and coalesces resize notifications', () => {
    let notifyResize!: () => void;
    const observer = { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    vi.stubGlobal(
      'ResizeObserver',
      vi.fn(function (callback: ResizeObserverCallback) {
        notifyResize = () => callback([], observer);
        return observer;
      }),
    );
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    try {
      const view = interactive({ selectedIndex: 29 });
      const list = screen.getByRole('listbox');
      const selectedRow = screen.getAllByRole('option')[29]!;
      expect(observer.observe).toHaveBeenCalledExactlyOnceWith(list);
      scroll.mockClear();
      // The selected row and index stay unchanged while the native viewport
      // shrinks beneath it. Multiple layout notifications need only one reveal.
      act(() => {
        notifyResize();
        notifyResize();
        notifyResize();
      });
      expect(scroll).not.toHaveBeenCalled();
      advance(16);
      expect(selected()).toBe(29);
      expect(scroll).toHaveBeenCalledExactlyOnceWith({ behavior: 'instant', block: 'nearest' });
      expect(scroll.mock.contexts[0]).toBe(selectedRow);
      act(() => notifyResize());
      view.unmount();
      advance(16);
      expect(scroll).toHaveBeenCalledTimes(1);
      expect(observer.disconnect).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  });

  it('scrolls the current row before paint with instant nearest positioning, including replaced rows', () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const view = interactive();
    scroll.mockClear();
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(scroll).toHaveBeenLastCalledWith({ behavior: 'instant', block: 'nearest' });
    scroll.mockClear();
    view.update({ hits: manyHits.slice(0, 10) });
    expect(scroll).toHaveBeenCalledExactlyOnceWith({ behavior: 'instant', block: 'nearest' });
    delete (Element.prototype as Partial<Element>).scrollIntoView;
  });
});
