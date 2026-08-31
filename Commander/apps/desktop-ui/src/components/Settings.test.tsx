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
import { nativeRequest } from '../lib/nativeBridge.js';
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
      customTimeoutMs: null,
      resourceLimits: DEFAULT_INDEXING_RESOURCE_LIMITS,
      timing: { samples: 2, averageDurationMs: 12_500, lastDurationMs: 13_000, longestDurationMs: 13_000 },
      timeoutAttempts: [
        {
          id: 'timeout-1',
          scope: 'files',
          occurredAtMs: Date.now() - 1_000,
          timeoutMs: 90_000,
          message:
            'Index Files timed out after 90 seconds. Increase the custom index timeout if this scan needs longer.',
        },
      ],
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
    activityNetwork: vi.fn(async () => ({
      sampledAtMs: 1,
      ping: { roundTripMs: 18, requestMs: 7, responseMs: 11 },
    })),
    activityNetworkSpeed: vi.fn(async () => ({
      sampledAtMs: 2,
      ping: { roundTripMs: 18, requestMs: 7, responseMs: 11 },
      speed: {
        packetBytes: [57344],
        downloads: [{ bytes: 57344, durationMs: 100, megabitsPerSecond: 4.6 }],
        uploads: [{ bytes: 57344, durationMs: 200, megabitsPerSecond: 2.3 }],
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
        customTimeoutMs: null,
        resourceLimits: DEFAULT_INDEXING_RESOURCE_LIMITS,
        timing: { samples: 0 },
        timeoutAttempts: [],
      },
    })),
  },
}));
vi.mock('../lib/nativeBridge.js', () => ({
  beginWindowDrag: vi.fn(),
  nativeBridgeAvailable: vi.fn(() => true),
  nativeRequest: vi.fn(async (method: string) => {
    if (method === 'permission.fullDiskAccess') return { granted: true };
    if (method === 'application.control') return { submitted: true };
    return {
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
        memory: {
          usedBytes: 8 * 1024 * 1024 * 1024,
          totalBytes: 16 * 1024 * 1024 * 1024,
          activeBytes: 4 * 1024 * 1024 * 1024,
          wiredBytes: 2 * 1024 * 1024 * 1024,
          cachedBytes: 1024 * 1024 * 1024,
          compressedBytes: 512 * 1024 * 1024,
          purgeableBytes: 256 * 1024 * 1024,
        },
        filesystem: {
          usedBytes: 200 * 1024 * 1024 * 1024,
          totalBytes: 500 * 1024 * 1024 * 1024,
          availableBytes: 300 * 1024 * 1024 * 1024,
          purgeableBytes: 12 * 1024 * 1024 * 1024,
        },
        responsivenessApplications: [
          { pid: 101, name: 'Thingtime', kind: 'ui', signal: 'repeatedAccessibilityTimeout' },
          { pid: 102, name: 'Thingtime Agent', kind: 'agent', signal: 'accessibilityProbeInconclusive' },
        ],
        processes: [
          {
            pid: 99,
            parentPid: 1,
            name: 'Commander',
            cpuPercent: 12,
            residentMemoryBytes: 256 * 1024 * 1024,
            diskReadBytesPerSecond: 1024,
            diskWriteBytesPerSecond: 2048,
          },
          {
            pid: 100,
            parentPid: 99,
            name: 'Commander Daemon',
            cpuPercent: 3,
            residentMemoryBytes: 128 * 1024 * 1024,
            diskReadBytesPerSecond: 0,
            diskWriteBytesPerSecond: 0,
          },
        ],
        gpu: { name: 'Apple GPU', available: true, utilizationPercent: 16, source: 'io-registry' },
      },
    };
  }),
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

  it('switches built-in Thingtime environments and saves a reusable custom environment', () => {
    window.history.replaceState({}, '', '/settings.html?tab=advanced');
    const commander = state();
    render(<Settings state={commander} />);

    const environment = screen.getByRole('combobox', { name: 'Thingtime environment' });
    expect(environment).toHaveValue('production');
    fireEvent.change(environment, { target: { value: 'development' } });
    expect(commander.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        thingtimeBaseUrl: 'https://dev.thingtime.com',
        thingtimeClientId: 'ttapp_5aec98d2-b17b-4396-b450-528ccc730d0e',
      }),
    );

    fireEvent.change(screen.getByLabelText('Thingtime URL'), {
      target: { value: 'https://staging.thingtime.com' },
    });
    fireEvent.change(screen.getByLabelText('Public client ID override'), {
      target: { value: 'ttapp_staging' },
    });
    fireEvent.change(screen.getByLabelText('Custom environment name'), { target: { value: 'Staging' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add custom environment' }));

    expect(commander.saveSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({
        thingtimeBaseUrl: 'https://staging.thingtime.com',
        thingtimeClientId: 'ttapp_staging',
        thingtimeCustomEnvironments: [
          expect.objectContaining({
            name: 'Staging',
            baseUrl: 'https://staging.thingtime.com',
            clientId: 'ttapp_staging',
          }),
        ],
      }),
    );
  });

  it('opens the native Activity tab with Commander and machine metrics', async () => {
    window.history.replaceState({}, '', '/settings.html?tab=activity');
    render(<Settings state={state()} />);

    expect(screen.getByRole('button', { name: 'Activity' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { name: 'Commander usage' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Machine usage' })).toBeVisible();
    await waitFor(() => expect(screen.getAllByText('256 MB').length).toBeGreaterThan(0));
    expect(screen.getByText('Apple GPU')).toBeVisible();
    expect(screen.getByText('Active memory')).toBeVisible();
    expect(screen.getByText('Purgeable filesystem')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Processes' })).toBeVisible();
    expect(screen.getByText('Commander Daemon')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Thingtime network' })).toBeVisible();
    expect(screen.getByText(/nothing here leaves this device/i)).toBeVisible();
  });

  it('labels responsiveness evidence and offers deliberate controls for every listed process', async () => {
    window.history.replaceState({}, '', '/settings.html?tab=activity');
    render(<Settings state={state()} />);

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Responsiveness signals' })).toBeVisible(),
    );
    expect(screen.getByText('Thingtime')).toBeVisible();
    expect(screen.getByText('UI app')).toBeVisible();
    expect(screen.getByText('2 AX timeouts')).toBeVisible();
    expect(screen.getByText('Thingtime Agent')).toBeVisible();
    expect(screen.getByText('Agent')).toBeVisible();
    expect(screen.getByText('AX probe inconclusive')).toBeVisible();
    fireEvent.click(screen.getAllByRole('button', { name: 'Quit' })[0]!);
    await waitFor(() =>
      expect(nativeRequest).toHaveBeenCalledWith('application.control', { pid: 101, action: 'quit' }),
    );
    expect(screen.getAllByRole('button', { name: 'Force quit' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Quit & restart' })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: 'Quit' })[1]!);
    await waitFor(() =>
      expect(nativeRequest).toHaveBeenCalledWith('application.control', { pid: 102, action: 'quit' }),
    );
  });

  it('shows indexing roots and ignore rules and can request a scoped refresh', async () => {
    window.history.replaceState({}, '', '/settings.html?tab=search');
    const commander = state();
    render(<Settings state={commander} />);

    expect(screen.getByRole('heading', { name: 'Search Index' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Search' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Fuzzy and adaptive everywhere')).toBeVisible();
    expect(screen.getByDisplayValue('/')).toBeVisible();
    expect(screen.getByDisplayValue('**/node_modules/**')).toBeVisible();
    expect(screen.getByDisplayValue('**/*.noindex/**')).toBeVisible();
    expect(screen.getByText(/files and folders reconcile every 6 hours/i)).toBeVisible();
    expect(screen.getByRole('spinbutton', { name: 'Scanner threads' })).toHaveValue(2);
    expect(screen.getByRole('spinbutton', { name: 'Max CPU' })).toHaveValue(60);
    expect(screen.getByRole('spinbutton', { name: 'Maximum index entries' })).toHaveValue(null);
    expect(screen.getByRole('textbox', { name: 'Custom index timeout in milliseconds' })).toHaveAttribute(
      'inputmode',
      'numeric',
    );
    expect(screen.getByRole('checkbox', { name: 'Include hidden files' })).toBeChecked();
    await waitFor(() =>
      expect(screen.getByLabelText('Last index resource usage')).toHaveTextContent(
        /last run used 4 workers, averaged 23% cpu/i,
      ),
    );
    expect(screen.getByLabelText('Search index database size')).toHaveTextContent('Database 700 MB');
    expect(screen.getByLabelText('Recent index timing')).toHaveTextContent(
      /12\.5 s average across 2 successful runs/i,
    );
    expect(screen.getByLabelText('Timed out index attempts')).toHaveTextContent(
      /index files timed out after 90 seconds/i,
    );
    await waitFor(() => expect(screen.getByText('Full Disk Access granted')).toBeVisible());
    const fullDiskAccessCard = screen.getByRole('region', { name: 'macOS whole-volume access' });
    expect(fullDiskAccessCard).toBeVisible();
    expect(fullDiskAccessCard.parentElement).toHaveClass('search-settings-stack');
    expect(
      fullDiskAccessCard.compareDocumentPosition(screen.getByText('Fuzzy and adaptive everywhere')),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(nativeRequest).toHaveBeenCalledWith('permission.fullDiskAccess');

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

    const timeout = screen.getByRole('textbox', { name: 'Custom index timeout in milliseconds' });
    fireEvent.change(timeout, { target: { value: '900000' } });
    fireEvent.blur(timeout);
    expect(commander.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ indexing: expect.objectContaining({ customTimeoutMs: 900_000 }) }),
    );
    fireEvent.change(timeout, { target: { value: '900000ms' } });
    expect(timeout).toHaveValue('900000');
  });

  it('reports a missing Full Disk Access grant and allows a native recheck', async () => {
    window.history.replaceState({}, '', '/settings.html?tab=search');
    vi.mocked(nativeRequest).mockImplementation(async (method: string) => {
      if (method === 'permission.fullDiskAccess') return { granted: false };
      return undefined;
    });
    vi.mocked(nativeRequest).mockClear();
    render(<Settings state={state()} />);

    await waitFor(() => expect(screen.getByText('Full Disk Access not granted')).toBeVisible());
    fireEvent.click(screen.getByRole('button', { name: 'Recheck' }));
    await waitFor(() =>
      expect(
        vi.mocked(nativeRequest).mock.calls.filter(([method]) => method === 'permission.fullDiskAccess'),
      ).toHaveLength(2),
    );
  });
});
