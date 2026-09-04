// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { BootstrapResponse, SearchHit } from '@commander/protocol';
import { DEFAULT_SETTINGS } from '@commander/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommanderState } from '../hooks/useCommander.js';
import { resetNativeFileIconSchedulerForTests } from '../lib/nativeFileIcons.js';
import { beginWindowDrag, nativeRequest } from '../lib/nativeBridge.js';
import { Launcher } from './Launcher.js';

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

  it('shows live index progress in the footer', () => {
    render(
      <Launcher
        state={state({
          indexingStatus: {
            available: true,
            running: ['files'],
            totalRecords: 4_000,
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

    expect(screen.getByText('Indexing Files · 1,250 / 4,000')).toBeVisible();
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
});
