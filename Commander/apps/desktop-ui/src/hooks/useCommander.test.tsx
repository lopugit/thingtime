// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { SearchHit } from '@commander/protocol';
import { DEFAULT_SETTINGS } from '@commander/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api.js';
import { hideLauncher, nativeRequest } from '../lib/nativeBridge.js';
import { useCommander } from './useCommander.js';

vi.mock('../lib/api.js', () => ({
  api: {
    bootstrap: vi.fn(),
    search: vi.fn(),
    addRecentSearch: vi.fn(),
    saveSettings: vi.fn(),
    execute: vi.fn(),
    sideload: vi.fn(),
  },
}));
vi.mock('../lib/nativeBridge.js', () => ({
  hideLauncher: vi.fn(async () => undefined),
  nativeRequest: vi.fn(async () => undefined),
}));

const bootstrap = {
  protocolVersion: 1 as const,
  platform: 'macos' as const,
  settings: DEFAULT_SETTINGS,
  accounts: [],
  extensions: [],
  recentSearches: [{ query: 'settings', commands: [] }],
  capabilities: {
    nativeBridge: true,
    globalHotkey: true,
    secureCredentialStore: true,
    openAtLogin: true,
    sideloadPicker: true,
    filesystemIndex: true,
  },
};

describe('useCommander launcher sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.bootstrap).mockResolvedValue(bootstrap);
    vi.mocked(api.search).mockResolvedValue({ hits: [] });
    vi.mocked(api.addRecentSearch).mockImplementation(async (query, command) => ({
      recentSearches: [
        { query, commands: command ? [command] : [] },
        { query: 'settings', commands: [] },
      ],
    }));
    vi.mocked(api.execute).mockResolvedValue({ ok: true });
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
    await waitFor(() => expect(api.addRecentSearch).toHaveBeenCalledWith('1password', undefined));
    expect(result.current.recentSearches).toEqual([
      { query: '1password', commands: [] },
      { query: 'settings', commands: [] },
    ]);
  });

  it('clears results immediately when a new query starts so Return cannot run a stale item', async () => {
    const staleHit: SearchHit = {
      id: 'builtin:settings',
      title: 'Commander Settings',
      kind: 'builtin',
      keywords: ['settings'],
      favourite: true,
      actions: [{ id: 'open-settings', title: 'Open Settings' }],
      score: 100,
      matchedRanges: [],
    };
    vi.mocked(api.search).mockResolvedValueOnce({ hits: [staleHit] });
    const { result } = renderHook(() => useCommander());
    await waitFor(() => expect(result.current.hits).toEqual([staleHit]));

    act(() => result.current.setQuery('emoji'));

    expect(result.current.hits).toEqual([]);
    expect(result.current.selectedIndex).toBe(0);
  });

  it('runs a native action and hides the launcher through the shared command executor', async () => {
    vi.mocked(api.execute).mockResolvedValueOnce({
      ok: true,
      nativeRequest: { method: 'application.open', params: { path: '/Applications/Notes.app' } },
    });
    const { result } = renderHook(() => useCommander());
    await waitFor(() => expect(result.current.bootstrap).not.toBeNull());

    await act(() => result.current.executeCommand('app:/Applications/Notes.app', 'open'));

    expect(nativeRequest).toHaveBeenCalledWith('application.open', {
      path: '/Applications/Notes.app',
    });
    expect(hideLauncher).toHaveBeenCalledOnce();
  });

  it('executes a registered command hotkey event and opens its Commander view', async () => {
    const itemId = 'extension:builtin:emoji-symbols:search-emoji-symbols';
    vi.mocked(api.execute).mockResolvedValueOnce({
      ok: true,
      view: { id: 'emoji-symbols' },
    });
    const { result } = renderHook(() => useCommander());
    await waitFor(() => expect(result.current.bootstrap).not.toBeNull());

    act(() => window.dispatchEvent(new CustomEvent('commander:command-hotkey', { detail: itemId })));

    await waitFor(() => expect(api.execute).toHaveBeenCalledWith(itemId, 'run'));
    await waitFor(() => expect(result.current.activeView).toBe('emoji-symbols'));
    expect(hideLauncher).not.toHaveBeenCalled();
  });
});
