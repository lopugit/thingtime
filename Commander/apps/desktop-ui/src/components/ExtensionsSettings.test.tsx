// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DEFAULT_SETTINGS, type CommanderExtension, type LocalRaycastExtension } from '@commander/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api.js';
import { nativeRequest } from '../lib/nativeBridge.js';
import { ExtensionsSettings } from './ExtensionsSettings.js';

vi.mock('../lib/api.js', () => ({
  api: {
    listRaycastExtensions: vi.fn(),
    addRaycastExtension: vi.fn(),
    syncRaycastExtension: vi.fn(),
  },
}));
vi.mock('../lib/nativeBridge.js', () => ({ nativeRequest: vi.fn(async () => undefined) }));

const raycastExtension: LocalRaycastExtension = {
  id: 'raycast-local:github:11111111-1111-1111-1111-111111111111',
  name: 'github',
  title: 'GitHub',
  description: 'Extension detected in this Mac’s Raycast profile.',
  installationId: '11111111-1111-1111-1111-111111111111',
  development: false,
  installedInCommander: false,
  canAdd: true,
  detectedPreferenceCount: 3,
  syncedPreferenceCount: 0,
  protectedPreferenceCount: 0,
};

const emojiExtension: CommanderExtension = {
  id: 'builtin:emoji-symbols',
  name: 'emoji-symbols',
  title: 'Emoji & Symbols',
  description: 'Search, copy, and paste emoji and Unicode symbols.',
  version: '0.1.0',
  author: 'Thingtime',
  icon: 'emoji',
  source: 'builtin',
  enabled: true,
  compatibility: 'native',
  commands: [
    {
      name: 'search-emoji-symbols',
      title: 'Search Emoji & Symbols',
      mode: 'view',
      keywords: ['emoji', 'symbols'],
      disabled: false,
    },
  ],
};

const calculatorExtension: CommanderExtension = {
  id: 'builtin:calculator',
  name: 'calculator',
  title: 'Calculator',
  description: 'Evaluate arithmetic expressions automatically as you type in Commander.',
  version: '0.1.0',
  author: 'Thingtime',
  icon: 'calculator',
  source: 'builtin',
  enabled: true,
  compatibility: 'native',
  commands: [],
};

const macosSystemExtension: CommanderExtension = {
  id: 'builtin:macos-system',
  name: 'macos-system',
  title: 'macOS System',
  description: 'Open indexed macOS System Settings destinations directly from Commander.',
  version: '0.1.0',
  author: 'Thingtime',
  icon: 'settings',
  source: 'builtin',
  enabled: true,
  compatibility: 'native',
  commands: [
    {
      name: 'open-accessibility-settings',
      title: 'Accessibility Settings',
      mode: 'no-view',
      keywords: ['accessibility'],
      disabled: false,
    },
  ],
};

function renderExtensions(
  initial: CommanderExtension[] = [],
  settings = DEFAULT_SETTINGS,
): { onChange: ReturnType<typeof vi.fn>; onError: ReturnType<typeof vi.fn> } {
  const onChange = vi.fn();
  const onError = vi.fn();
  render(<ExtensionsSettings initial={initial} settings={settings} onChange={onChange} onError={onError} />);
  return { onChange, onError };
}

describe('Your Raycast extensions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listRaycastExtensions).mockResolvedValue({
      available: true,
      extensions: [raycastExtension],
      message: 'Password preferences stay protected in Raycast.',
    });
  });
  afterEach(cleanup);

  it('lists local Raycast extensions and adds one with its settings', async () => {
    vi.mocked(api.addRaycastExtension).mockResolvedValue({
      extension: {
        id: 'raycast:raycast/github',
        name: 'github',
        title: 'GitHub',
        description: 'GitHub tools',
        version: '1.0.0',
        source: 'store',
        enabled: true,
        compatibility: 'partial',
        commands: [],
      },
      preparation: {
        source: 'folder',
        readyNoViewCommands: 0,
        diagnostics: [],
        build: { attempted: false },
      },
      sync: {
        copied: 2,
        defaultsApplied: 1,
        missing: 0,
        protected: 1,
        syncedAt: '2026-08-17T00:00:00.000Z',
      },
    });

    renderExtensions();
    fireEvent.click(screen.getByRole('button', { name: 'Your Raycast' }));

    expect(await screen.findByText('GitHub')).toBeVisible();
    expect(screen.getByText(/3 local settings detected/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Add to Commander' }));

    await waitFor(() =>
      expect(api.addRaycastExtension).toHaveBeenCalledWith('github', '11111111-1111-1111-1111-111111111111'),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('2 copied');
    expect(screen.getByRole('status')).toHaveTextContent('1 password fields left protected in Raycast');
  });

  it('syncs an extension that Commander already has', async () => {
    vi.mocked(api.listRaycastExtensions).mockResolvedValue({
      available: true,
      extensions: [{ ...raycastExtension, installedInCommander: true }],
    });
    vi.mocked(api.syncRaycastExtension).mockResolvedValue({
      extension: {
        id: 'raycast:raycast/github',
        name: 'github',
        title: 'GitHub',
        description: 'GitHub tools',
        version: '1.0.0',
        source: 'store',
        enabled: true,
        compatibility: 'partial',
        commands: [],
      },
      sync: {
        copied: 3,
        defaultsApplied: 0,
        missing: 0,
        protected: 0,
        syncedAt: '2026-08-17T00:00:00.000Z',
      },
    });

    renderExtensions();
    fireEvent.click(screen.getByRole('button', { name: 'Your Raycast' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sync to Commander' }));

    await waitFor(() =>
      expect(api.syncRaycastExtension).toHaveBeenCalledWith('github', '11111111-1111-1111-1111-111111111111'),
    );
  });

  it('lists Commander-native equivalents under Bundled Commands', () => {
    renderExtensions([emojiExtension, calculatorExtension, macosSystemExtension]);

    fireEvent.click(screen.getByRole('button', { name: 'Bundled' }));

    expect(screen.getByText('Bundled Commands')).toBeVisible();
    expect(screen.getByText('Emoji & Symbols')).toBeVisible();
    expect(screen.getByText('Calculator')).toBeVisible();
    expect(screen.queryByText('macOS System')).not.toBeInTheDocument();
    expect(screen.getByText('1 bundled command · by Thingtime')).toBeVisible();
    expect(screen.getByText(/Automatic result provider/)).toBeVisible();
    expect(screen.getAllByText('Built in')).toHaveLength(2);

    fireEvent.change(screen.getByPlaceholderText('Search…'), { target: { value: 'emjoi' } });
    expect(screen.getByText('Emoji & Symbols')).toBeVisible();
  });

  it('configures the automatic calculator from its own bundled extension card', () => {
    const { onChange } = renderExtensions([calculatorExtension]);
    fireEvent.click(screen.getByRole('button', { name: 'Bundled' }));

    fireEvent.click(screen.getByRole('checkbox', { name: 'Show automatic calculator results' }));
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_SETTINGS,
      calculator: { ...DEFAULT_SETTINGS.calculator, enabled: false },
    });

    fireEvent.change(screen.getByRole('combobox', { name: 'Calculator maximum decimal places' }), {
      target: { value: '6' },
    });
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_SETTINGS,
      calculator: { ...DEFAULT_SETTINGS.calculator, maxDecimalPlaces: 6 },
    });
  });

  it('click-records and natively validates a per-command shortcut before saving it', async () => {
    const itemId = 'extension:builtin:emoji-symbols:search-emoji-symbols';
    const settings = {
      ...DEFAULT_SETTINGS,
      commandShortcuts: { [itemId]: 'Command+E' },
    };
    const { onChange, onError } = renderExtensions([emojiExtension], settings);

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Rebind shortcut for Search Emoji & Symbols, currently ⌘ E',
      }),
    );
    fireEvent.keyDown(window, { key: '€', code: 'KeyE', metaKey: true, altKey: true });

    await waitFor(() =>
      expect(nativeRequest).toHaveBeenCalledWith('commandHotkeys.update', {
        shortcuts: { [itemId]: 'Command+Option+E' },
      }),
    );
    expect(onChange).toHaveBeenCalledWith({
      ...settings,
      commandShortcuts: { [itemId]: 'Command+Option+E' },
    });
    expect(onError).toHaveBeenCalledWith(null);
  });

  it('keeps persisted command shortcuts unchanged when macOS rejects a conflict', async () => {
    const { onChange, onError } = renderExtensions([emojiExtension]);
    vi.mocked(nativeRequest).mockRejectedValueOnce(new Error('macOS rejected this shortcut'));

    fireEvent.click(screen.getByRole('button', { name: 'Record shortcut for Search Emoji & Symbols' }));
    fireEvent.keyDown(window, { key: ' ', code: 'Space', metaKey: true });

    await waitFor(() => expect(onError).toHaveBeenCalledWith('macOS rejected this shortcut'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('clears an existing command shortcut with an unmodified Delete key', async () => {
    const itemId = 'extension:builtin:emoji-symbols:search-emoji-symbols';
    const settings = {
      ...DEFAULT_SETTINGS,
      commandShortcuts: { [itemId]: 'Command+Option+E' },
    };
    const { onChange } = renderExtensions([emojiExtension], settings);

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Rebind shortcut for Search Emoji & Symbols, currently ⌘ ⌥ E',
      }),
    );
    fireEvent.keyDown(window, { key: 'Delete', code: 'Delete' });

    await waitFor(() =>
      expect(nativeRequest).toHaveBeenCalledWith('commandHotkeys.update', { shortcuts: {} }),
    );
    expect(onChange).toHaveBeenCalledWith({ ...settings, commandShortcuts: {} });
  });
});
