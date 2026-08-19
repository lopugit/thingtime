// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { BootstrapResponse, SearchHit } from '@commander/protocol';
import { DEFAULT_SETTINGS } from '@commander/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommanderState } from '../hooks/useCommander.js';
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
    ...overrides,
  };
}

describe('Launcher keyboard navigation', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

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
    const input = screen.getByRole('textbox', { name: 'Search apps and commands' }) as HTMLInputElement;
    input.focus();
    input.setSelectionRange(2, 5);

    fireEvent.keyDown(input, { key: 'a', ...modifier });

    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });

  it('preserves the standard macOS Control-A editing shortcut', () => {
    render(<Launcher state={state()} />);
    const input = screen.getByRole('textbox', { name: 'Search apps and commands' }) as HTMLInputElement;
    input.focus();
    input.setSelectionRange(2, 5);

    fireEvent.keyDown(input, { key: 'a', ctrlKey: true });

    expect(input.selectionStart).toBe(2);
    expect(input.selectionEnd).toBe(5);
  });

  it('disables browser spelling and autocorrect UI in the root search field', () => {
    render(<Launcher state={state()} />);
    const input = screen.getByRole('textbox', { name: 'Search apps and commands' });

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
    vi.mocked(nativeRequest).mockResolvedValueOnce({
      dataUrl: 'data:image/png;base64,aWNvbg==',
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
});
