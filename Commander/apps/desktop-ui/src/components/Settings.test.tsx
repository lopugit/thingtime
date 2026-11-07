// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  DEFAULT_INDEXING_RESOURCE_LIMITS,
  DEFAULT_SETTINGS,
  type BootstrapResponse,
} from '@commander/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommanderState } from '../hooks/useCommander.js';
import { api } from '../lib/api.js';
import { Settings } from './Settings.js';

vi.mock('../lib/api.js', () => ({
  api: {
    listRaycastExtensions: vi.fn(async () => ({ available: true, extensions: [] })),
    browseStore: vi.fn(async () => ({ extensions: [] })),
    indexingStatus: vi.fn(async () => ({
      available: true,
      running: [],
      totalRecords: 0,
      databaseSizeBytes: 734_003_200,
      kinds: [],
      commands: { count: 0 },
      automaticRefresh: { applicationsMinutes: 5, filesystemMinutes: 30 },
      resourceLimits: DEFAULT_INDEXING_RESOURCE_LIMITS,
      lastRunResources: {
        effective: {
          logicalCpuCount: 8,
          workerThreads: 4,
          maxOpenDirectories: 16,
          maxCpuPercent: 60,
          maxMemoryMiB: 512,
          channelCapacity: 2_048,
          sqliteCacheKib: 65_536,
        },
        cpuTimeMs: 1_000,
        averageCpuPercent: 23,
        peakMemoryBytes: 96 * 1024 * 1024,
        throttledMs: 250,
        memoryChecks: 4,
      },
    })),
    indexNow: vi.fn(async (scope: string) => ({
      ok: true,
      scope,
      status: {
        available: true,
        running: [scope],
        totalRecords: 0,
        databaseSizeBytes: 734_003_200,
        kinds: [],
        commands: { count: 0 },
        automaticRefresh: { applicationsMinutes: 5, filesystemMinutes: 30 },
        resourceLimits: DEFAULT_INDEXING_RESOURCE_LIMITS,
      },
    })),
  },
}));
vi.mock('../lib/nativeBridge.js', () => ({
  beginWindowDrag: vi.fn(),
  nativeBridgeAvailable: vi.fn(() => true),
  nativeRequest: vi.fn(async () => ({
    sampledAtMs: 1,
    commander: {
      cpuPercent: 12,
      residentMemoryBytes: 256 * 1024 * 1024,
      virtualMemoryBytes: 1024 * 1024 * 1024,
      storageBytes: 64 * 1024 * 1024,
      processCount: 2,
    },
    machine: {
      cpuPercent: 42,
      logicalCpuCount: 8,
      memoryUsedBytes: 8 * 1024 * 1024 * 1024,
      memoryTotalBytes: 16 * 1024 * 1024 * 1024,
      thermalState: 'nominal',
      filesystemUsedBytes: 200 * 1024 * 1024 * 1024,
      filesystemTotalBytes: 500 * 1024 * 1024 * 1024,
      filesystemAvailableBytes: 300 * 1024 * 1024 * 1024,
      gpu: { name: 'Apple GPU', available: true, utilizationPercent: 16, source: 'io-registry' },
    },
  })),
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

function state(): CommanderState {
  return {
    bootstrap,
    query: '',
    hits: [],
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

  it('opens the native Activity tab with Commander and machine metrics', async () => {
    window.history.replaceState({}, '', '/settings.html?tab=activity');
    render(<Settings state={state()} />);

    expect(screen.getByRole('button', { name: 'Activity' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { name: 'Commander usage' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Machine usage' })).toBeVisible();
    await waitFor(() => expect(screen.getByText('256 MB')).toBeVisible());
    expect(screen.getByText('Apple GPU')).toBeVisible();
    expect(screen.getByText(/nothing here leaves this device/i)).toBeVisible();
  });

  it('shows indexing roots and ignore rules and can request a scoped refresh', async () => {
    window.history.replaceState({}, '', '/settings.html?tab=search');
    const commander = state();
    render(<Settings state={commander} />);

    expect(screen.getByRole('heading', { name: 'Search Index' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Search' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Fuzzy and adaptive everywhere')).toBeVisible();
    expect(screen.getByDisplayValue('~')).toBeVisible();
    expect(screen.getByDisplayValue('**/node_modules/**')).toBeVisible();
    expect(screen.getByDisplayValue('**/*.noindex/**')).toBeVisible();
    expect(screen.getByText(/files and folders reconcile every 6 hours/i)).toBeVisible();
    expect(screen.getByRole('spinbutton', { name: 'Scanner threads' })).toHaveValue(2);
    expect(screen.getByRole('spinbutton', { name: 'Max CPU' })).toHaveValue(60);
    expect(screen.getByRole('spinbutton', { name: 'Maximum index entries' })).toHaveValue(null);
    expect(screen.getByRole('checkbox', { name: 'Include hidden files' })).toBeChecked();
    await waitFor(() =>
      expect(screen.getByLabelText('Last index resource usage')).toHaveTextContent(
        /last run used 4 workers, averaged 23% cpu/i,
      ),
    );
    expect(screen.getByLabelText('Search index database size')).toHaveTextContent('Database 700 MB');

    fireEvent.click(screen.getByRole('button', { name: 'Files' }));
    await waitFor(() => expect(api.indexNow).toHaveBeenCalledWith('files'));

    fireEvent.click(screen.getByRole('button', { name: 'Add Ignore' }));
    expect(screen.getByDisplayValue('**/build/**')).toBeVisible();
    expect(commander.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        indexing: expect.objectContaining({
          customIgnores: expect.arrayContaining([{ kind: 'glob', pattern: '**/build/**' }]),
        }),
      }),
    );

    const threads = screen.getByRole('spinbutton', { name: 'Scanner threads' });
    fireEvent.change(threads, { target: { value: '3' } });
    fireEvent.blur(threads);
    expect(commander.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        indexing: expect.objectContaining({
          resourceLimits: expect.objectContaining({ maxThreads: 3 }),
        }),
      }),
    );

    const capacity = screen.getByRole('spinbutton', { name: 'Maximum index entries' });
    fireEvent.change(capacity, { target: { value: '750000' } });
    fireEvent.blur(capacity);
    expect(commander.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ indexing: expect.objectContaining({ maxEntries: 750_000 }) }),
    );
  });
});
