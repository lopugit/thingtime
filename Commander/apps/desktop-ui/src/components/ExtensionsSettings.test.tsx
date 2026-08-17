// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { LocalRaycastExtension } from '@commander/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api.js';
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

    render(<ExtensionsSettings initial={[]} />);
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

    render(<ExtensionsSettings initial={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Your Raycast' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sync to Commander' }));

    await waitFor(() =>
      expect(api.syncRaycastExtension).toHaveBeenCalledWith('github', '11111111-1111-1111-1111-111111111111'),
    );
  });
});
