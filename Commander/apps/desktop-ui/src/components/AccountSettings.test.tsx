// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COMMANDER_THINGTIME_DEVELOPMENT_CLIENT_ID,
  COMMANDER_THINGTIME_DEVELOPMENT_URL,
  COMMANDER_THINGTIME_PRODUCTION_CLIENT_ID,
  COMMANDER_THINGTIME_PRODUCTION_URL,
  DEFAULT_SETTINGS,
  type CommanderAccount,
} from '@commander/protocol';
import { AccountSettings } from './AccountSettings.js';
import { api } from '../lib/api.js';

vi.mock('../lib/api.js', () => ({ api: { reconcileAccountEnvironments: vi.fn(), switchAccount: vi.fn() } }));
vi.mock('../lib/nativeBridge.js', () => ({ nativeRequest: vi.fn() }));

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AccountSettings', () => {
  it('shows the environment that issued each connected account', () => {
    const accounts: CommanderAccount[] = [
      {
        id: 'production-user',
        username: 'lopu',
        scopes: [],
        expiresAt: '2030-01-01T00:00:00.000Z',
        environment: {
          baseUrl: COMMANDER_THINGTIME_PRODUCTION_URL,
          clientId: COMMANDER_THINGTIME_PRODUCTION_CLIENT_ID,
        },
      },
      {
        id: 'development-user',
        username: 'lopu-dev',
        scopes: [],
        expiresAt: '2030-01-01T00:00:00.000Z',
        environment: {
          baseUrl: COMMANDER_THINGTIME_DEVELOPMENT_URL,
          clientId: COMMANDER_THINGTIME_DEVELOPMENT_CLIENT_ID,
        },
      },
    ];
    render(
      <AccountSettings
        accounts={accounts}
        settings={{
          ...DEFAULT_SETTINGS,
          activeAccountId: 'development-user',
          thingtimeBaseUrl: COMMANDER_THINGTIME_PRODUCTION_URL,
          thingtimeClientId: COMMANDER_THINGTIME_PRODUCTION_CLIENT_ID,
        }}
        onSettings={vi.fn()}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getAllByText('Production')).toHaveLength(1);
    expect(screen.getAllByText('Develop')).toHaveLength(1);
    expect(screen.getByText('@lopu-dev · Develop')).toBeVisible();
  });

  it('migrates an older local account from matching Keychain metadata instead of the selected profile', async () => {
    const legacy: CommanderAccount = {
      id: 'legacy-user',
      username: 'lopu',
      scopes: [],
      expiresAt: '2030-01-01T00:00:00.000Z',
    };
    const reconciled: CommanderAccount = {
      ...legacy,
      environment: {
        baseUrl: COMMANDER_THINGTIME_PRODUCTION_URL,
        clientId: COMMANDER_THINGTIME_PRODUCTION_CLIENT_ID,
      },
    };
    const { nativeRequest } = await import('../lib/nativeBridge.js');
    vi.mocked(nativeRequest).mockResolvedValue({
      environments: [
        {
          accountId: 'legacy-user',
          baseUrl: COMMANDER_THINGTIME_PRODUCTION_URL,
          clientId: COMMANDER_THINGTIME_PRODUCTION_CLIENT_ID,
        },
      ],
    });
    vi.mocked(api.reconcileAccountEnvironments).mockResolvedValue({ accounts: [reconciled] });
    vi.mocked(api.switchAccount).mockResolvedValue({ account: reconciled });
    const onSettings = vi.fn();
    render(
      <AccountSettings
        accounts={[legacy]}
        settings={{
          ...DEFAULT_SETTINGS,
          activeAccountId: 'different-active-account',
          thingtimeBaseUrl: COMMANDER_THINGTIME_DEVELOPMENT_URL,
          thingtimeClientId: COMMANDER_THINGTIME_DEVELOPMENT_CLIENT_ID,
        }}
        onSettings={onSettings}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    await waitFor(() => expect(screen.getByText('Production')).toBeVisible());
    fireEvent.click(screen.getByRole('button', { name: 'Switch' }));
    await waitFor(() =>
      expect(onSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          activeAccountId: 'legacy-user',
          thingtimeBaseUrl: COMMANDER_THINGTIME_PRODUCTION_URL,
          thingtimeClientId: COMMANDER_THINGTIME_PRODUCTION_CLIENT_ID,
        }),
      ),
    );
  });
});
