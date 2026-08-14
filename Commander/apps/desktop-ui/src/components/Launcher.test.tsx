// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { BootstrapResponse, SearchHit } from '@commander/protocol';
import { DEFAULT_SETTINGS } from '@commander/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommanderState } from '../hooks/useCommander.js';
import { api } from '../lib/api.js';
import { beginWindowDrag, hideLauncher, nativeRequest } from '../lib/nativeBridge.js';
import { Launcher } from './Launcher.js';

vi.mock('../lib/api.js', () => ({ api: { execute: vi.fn(async () => ({ ok: true })) } }));
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
    kind: 'application',
    keywords: ['app'],
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
    setQuery: vi.fn(),
    setSelectedIndex: vi.fn(),
    setActionsOpen: vi.fn(),
    rememberRecentSearch: vi.fn(async () => undefined),
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

  it('runs the selected primary action with Return', async () => {
    const commander = state({ selectedIndex: 1 });
    render(<Launcher state={commander} />);
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(api.execute).toHaveBeenCalledWith('app:notes', 'open'));
    expect(commander.rememberRecentSearch).toHaveBeenCalledWith('settings');
    expect(screen.getByRole('option', { name: /Notes/ })).toHaveAttribute('aria-selected', 'true');
  });

  it.each([
    ['Close Commander', 'close-commander', 'application.quit' as const],
    ['Close Commander Window', 'close-commander-window', 'launcher.hide' as const],
    ['Open Commander', 'open-commander', 'launcher.show' as const],
  ])('runs %s through its native lifecycle request', async (title, commandName, method) => {
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
    vi.mocked(api.execute).mockResolvedValueOnce({ ok: true, nativeRequest: { method } });
    render(<Launcher state={state({ hits: [item], selectedIndex: 0 })} />);

    fireEvent.keyDown(window, { key: 'Enter' });

    await waitFor(() => expect(api.execute).toHaveBeenCalledWith(item.id, 'run'));
    expect(nativeRequest).toHaveBeenCalledWith(method, undefined);
    expect(hideLauncher).not.toHaveBeenCalled();
  });

  it('shows recent searches before suggestions and restores one with Return', () => {
    const commander = state({ query: '', recentSearches: ['1password', 'settings'] });
    render(<Launcher state={commander} />);

    expect(screen.getByRole('heading', { name: /History/ })).toBeVisible();
    expect(screen.getByRole('heading', { name: /Suggestions/ })).toBeVisible();
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveTextContent('1password');
    expect(options[2]).toHaveTextContent('Commander Settings');

    fireEvent.keyDown(window, { key: 'Enter' });

    expect(commander.setQuery).toHaveBeenCalledWith('1password');
    expect(api.execute).not.toHaveBeenCalled();
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
    render(<Launcher state={state({ hits: actionHits, selectedIndex: 0, actionsOpen: true })} />);
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(api.execute).toHaveBeenCalledWith('app:notes', 'copy-path'));
  });
});
