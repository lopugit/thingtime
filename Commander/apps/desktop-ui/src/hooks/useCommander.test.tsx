// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { DEFAULT_SETTINGS } from '@commander/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api.js';
import { useCommander } from './useCommander.js';

vi.mock('../lib/api.js', () => ({
  api: {
    bootstrap: vi.fn(),
    search: vi.fn(),
    addRecentSearch: vi.fn(),
    saveSettings: vi.fn(),
  },
}));

const bootstrap = {
  protocolVersion: 1 as const,
  platform: 'macos' as const,
  settings: DEFAULT_SETTINGS,
  accounts: [],
  extensions: [],
  recentSearches: ['settings'],
  capabilities: {
    nativeBridge: true,
    globalHotkey: true,
    secureCredentialStore: true,
    openAtLogin: true,
    sideloadPicker: true,
  },
};

describe('useCommander launcher sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.bootstrap).mockResolvedValue(bootstrap);
    vi.mocked(api.search).mockResolvedValue({ hits: [] });
    vi.mocked(api.addRecentSearch).mockImplementation(async (query) => ({
      recentSearches: [query, 'settings'],
    }));
  });

  afterEach(cleanup);

  it('saves the previous query, clears it, and shows history when the launcher reopens', async () => {
    const { result } = renderHook(() => useCommander());
    await waitFor(() => expect(result.current.bootstrap).not.toBeNull());

    act(() => result.current.setQuery('1password'));
    act(() => window.dispatchEvent(new CustomEvent('commander:launcher-opened')));

    expect(result.current.query).toBe('');
    expect(result.current.selectedIndex).toBe(0);
    expect(result.current.actionsOpen).toBe(false);
    await waitFor(() => expect(api.addRecentSearch).toHaveBeenCalledWith('1password'));
    expect(result.current.recentSearches).toEqual(['1password', 'settings']);
  });
});
