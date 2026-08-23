// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COMMANDER_THINGTIME_DEVELOPMENT_CLIENT_ID,
  COMMANDER_THINGTIME_DEVELOPMENT_URL,
  COMMANDER_THINGTIME_PRODUCTION_CLIENT_ID,
  COMMANDER_THINGTIME_PRODUCTION_URL,
  DEFAULT_SETTINGS,
  type CommanderAccount,
} from '@commander/protocol';
import { AccountSettings } from './AccountSettings.js';

vi.mock('../lib/api.js', () => ({ api: {} }));
vi.mock('../lib/nativeBridge.js', () => ({ nativeRequest: vi.fn() }));

afterEach(cleanup);

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
        settings={{ ...DEFAULT_SETTINGS, activeAccountId: 'development-user' }}
        onSettings={vi.fn()}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getAllByText('Production')).toHaveLength(1);
    expect(screen.getAllByText('Develop')).toHaveLength(1);
    expect(screen.getByText('@lopu-dev · Develop')).toBeVisible();
  });
});
