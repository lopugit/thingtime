// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { BootstrapResponse, SearchHit } from '@commander/protocol';
import { DEFAULT_SETTINGS } from '@commander/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommanderState } from '../hooks/useCommander.js';
import { api } from '../lib/api.js';
import { Launcher } from './Launcher.js';

vi.mock('../lib/api.js', () => ({ api: { execute: vi.fn(async () => ({ ok: true })) } }));
vi.mock('../lib/nativeBridge.js', () => ({
  hideLauncher: vi.fn(async () => undefined),
  nativeRequest: vi.fn(async () => undefined),
}));

const bootstrap: BootstrapResponse = {
  protocolVersion: 1,
  platform: 'macos',
  settings: DEFAULT_SETTINGS,
  accounts: [],
  extensions: [],
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
    selectedIndex: 0,
    actionsOpen: false,
    error: null,
    setQuery: vi.fn(),
    setSelectedIndex: vi.fn(),
    setActionsOpen: vi.fn(),
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

  it('runs the selected primary action with Return', async () => {
    render(<Launcher state={state({ selectedIndex: 1 })} />);
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(api.execute).toHaveBeenCalledWith('app:notes', 'open'));
    expect(screen.getByRole('option', { name: /Notes/ })).toHaveAttribute('aria-selected', 'true');
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
