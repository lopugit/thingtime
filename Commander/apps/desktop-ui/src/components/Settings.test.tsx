// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_SETTINGS, type BootstrapResponse } from '@commander/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommanderState } from '../hooks/useCommander.js';
import { Settings } from './Settings.js';

vi.mock('../lib/api.js', () => ({
  api: {
    listRaycastExtensions: vi.fn(async () => ({ available: true, extensions: [] })),
    browseStore: vi.fn(async () => ({ extensions: [] })),
  },
}));
vi.mock('../lib/nativeBridge.js', () => ({ beginWindowDrag: vi.fn(), nativeRequest: vi.fn() }));

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

function state(): CommanderState {
  return {
    bootstrap,
    query: '',
    hits: [],
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
  };
}

describe('Commander settings deep links', () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState({}, '', '/');
  });

  it('opens the requested URL tab and responds to native tab events', () => {
    window.history.replaceState({}, '', '/settings.html?tab=extensions');
    render(<Settings state={state()} />);

    expect(screen.getByRole('button', { name: 'Extensions' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Installed' })).toBeVisible();

    fireEvent(window, new CustomEvent('commander:settings-tab', { detail: 'account' }));
    expect(screen.getByRole('button', { name: 'Account' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Thingtime Account')).toBeVisible();
  });
});
