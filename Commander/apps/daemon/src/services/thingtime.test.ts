import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type CommanderSettings } from '@commander/protocol';
import { ThingtimeService } from './thingtime.js';

const configuredSettings = (overrides: Partial<CommanderSettings> = {}): CommanderSettings => ({
  ...DEFAULT_SETTINGS,
  thingtimeBaseUrl: 'https://thingtime.test/some/ignored/path?and=query',
  thingtimeClientId: 'commander-test-client',
  ...overrides,
});

const jsonResponse = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ThingtimeService OAuth', () => {
  it('builds an S256 authorization request and exchanges its one-time verifier using the desktop contract', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          accessToken: 'test-access-token',
          expiresAt: '2030-01-02T03:04:05.000Z',
          scopes: ['profile.username', 'app-data'],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          scopes: ['profile.username', 'app-data'],
          user: {
            id: 'thing-user-1',
            username: 'commander-tester',
            displayName: 'Commander Tester',
            avatarUrl: null,
            profileUrl: 'https://thingtime.test/@commander-tester',
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const service = new ThingtimeService();
    const settings = configuredSettings();
    const redirectUri = 'com.thingtime.commander://oauth/callback';
    const login = service.beginLogin(settings, redirectUri);
    const authorizeUrl = new URL(login.authorizeUrl);

    expect(authorizeUrl.origin + authorizeUrl.pathname).toBe('https://thingtime.test/authorize');
    expect(authorizeUrl.searchParams.get('client_id')).toBe(settings.thingtimeClientId);
    expect(authorizeUrl.searchParams.get('redirect_uri')).toBe(redirectUri);
    expect(authorizeUrl.searchParams.get('state')).toBe(login.state);
    expect(authorizeUrl.searchParams.get('scope')).toBe('profile.username app-data');
    expect(authorizeUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorizeUrl.searchParams.get('code_challenge')).toBe(
      createHash('sha256').update(login.verifier).digest('base64url'),
    );

    const result = await service.exchange(settings, login.state, 'authorization-code', redirectUri);

    expect(result).toEqual({
      token: 'test-access-token',
      account: {
        id: 'thing-user-1',
        username: 'commander-tester',
        displayName: 'Commander Tester',
        avatarUrl: null,
        profileUrl: 'https://thingtime.test/@commander-tester',
        scopes: ['profile.username', 'app-data'],
        expiresAt: '2030-01-02T03:04:05.000Z',
        environment: {
          baseUrl: 'https://thingtime.test',
          clientId: 'commander-test-client',
        },
      },
    });

    const [tokenInput, tokenInit] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(tokenInput.toString()).toBe('https://thingtime.test/api/v1/oauth/token');
    expect(tokenInit.method).toBe('POST');
    expect(tokenInit.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(String(tokenInit.body))).toEqual({
      grantType: 'authorization_code',
      clientId: 'commander-test-client',
      code: 'authorization-code',
      codeVerifier: login.verifier,
      redirectUri,
    });

    const [profileInput, profileInit] = fetchMock.mock.calls[1] as [URL, RequestInit];
    expect(profileInput.toString()).toBe('https://thingtime.test/api/v1/oauth/userinfo');
    expect(profileInit.headers).toEqual({ authorization: 'Bearer test-access-token' });

    await expect(service.exchange(settings, login.state, 'replayed-code', redirectUri)).rejects.toThrow(
      'Thingtime login expired; start again',
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects non-loopback plaintext Thingtime origins before creating an authorization request', () => {
    const service = new ThingtimeService();

    expect(() =>
      service.beginLogin(
        configuredSettings({ thingtimeBaseUrl: 'http://thingtime.test' }),
        'http://127.0.0.1:47820/oauth/callback',
      ),
    ).toThrow('Thingtime must use HTTPS');
    expect(() =>
      service.beginLogin(
        configuredSettings({ thingtimeBaseUrl: 'https://user:password@thingtime.test' }),
        'http://127.0.0.1:47820/oauth/callback',
      ),
    ).toThrow('Thingtime URL must not contain credentials');
  });
});

describe('ThingtimeService network probe', () => {
  it('measures the fixed packet ladder without accepting arbitrary remote URLs or sizes', async () => {
    const fetchMock = vi.fn(async (input: URL, init?: RequestInit) => {
      const url = new URL(input);
      if (url.pathname.endsWith('/ping')) return new Response(new Uint8Array(256));
      const bytes = Number(url.searchParams.get('bytes'));
      if (url.pathname.endsWith('/download')) return new Response(new Uint8Array(bytes));
      expect(init?.method).toBe('POST');
      expect(init?.headers).toMatchObject({
        'content-type': 'application/octet-stream',
        'content-length': String(bytes),
      });
      return jsonResponse({ ok: true, bytes });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new ThingtimeService().networkProbe(configuredSettings(), true);

    expect(result.ping.roundTripMs).toBeGreaterThanOrEqual(0);
    expect(result.speed?.packetBytes).toEqual([
      56 * 1024,
      500 * 1024,
      2 * 1024 * 1024,
      5 * 1024 * 1024,
      10 * 1024 * 1024,
    ]);
    expect(result.speed?.downloads).toHaveLength(5);
    expect(result.speed?.uploads).toHaveLength(5);
    expect(fetchMock).toHaveBeenCalledTimes(11);
    expect((fetchMock.mock.calls[0]?.[0] as URL).toString()).toBe(
      'https://thingtime.test/api/v1/network-probe/ping',
    );
    expect((fetchMock.mock.calls[1]?.[0] as URL).toString()).toBe(
      'https://thingtime.test/api/v1/network-probe/download?bytes=57344',
    );
  });
});

describe('ThingtimeService settings sync', () => {
  it('applies a newer clean cloud revision while preserving device-local and account settings', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        entry: {
          value: {
            schemaVersion: 1,
            revision: 7,
            updatedAt: '2029-06-07T08:09:10.000Z',
            preferences: {
              appearance: 'dark',
              textSize: 'large',
              windowMode: 'compact',
              showFavouritesInCompactMode: false,
            },
          },
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const settings = configuredSettings({
      appearance: 'light',
      textSize: 'default',
      windowMode: 'default',
      showFavouritesInCompactMode: true,
      hotkey: 'Command+Shift+Space',
      openAtLogin: true,
      showMenuBarIcon: false,
      activeAccountId: 'thing-user-1',
      syncRevision: 6,
      syncDirty: false,
    });
    const synced = await new ThingtimeService().sync('sync-token', settings);

    expect(synced).toMatchObject({
      appearance: 'dark',
      textSize: 'large',
      windowMode: 'compact',
      showFavouritesInCompactMode: false,
      syncRevision: 7,
      syncUpdatedAt: '2029-06-07T08:09:10.000Z',
      syncDirty: false,
      hotkey: 'Command+Shift+Space',
      openAtLogin: true,
      showMenuBarIcon: false,
      activeAccountId: 'thing-user-1',
      thingtimeClientId: 'commander-test-client',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(input.toString()).toBe('https://thingtime.test/api/v1/app-data?key=commander.settings.v1');
    expect(init.headers).toEqual({ authorization: 'Bearer sync-token' });
  });

  it('writes dirty local preferences privately with a revision newer than both sides', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          entry: {
            value: {
              schemaVersion: 1,
              revision: 8,
              updatedAt: '2029-01-01T00:00:00.000Z',
              preferences: {
                appearance: 'light',
                textSize: 'default',
                windowMode: 'default',
                showFavouritesInCompactMode: false,
              },
            },
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const settings = configuredSettings({
      appearance: 'dark',
      textSize: 'large',
      windowMode: 'compact',
      showFavouritesInCompactMode: true,
      syncRevision: 4,
      syncDirty: true,
    });
    const synced = await new ThingtimeService().sync('sync-token', settings);

    expect(synced.syncRevision).toBe(9);
    expect(synced.syncDirty).toBe(false);
    expect(synced.syncUpdatedAt).toEqual(expect.any(String));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [writeInput, writeInit] = fetchMock.mock.calls[1] as [URL, RequestInit];
    expect(writeInput.toString()).toBe('https://thingtime.test/api/v1/app-data');
    expect(writeInit.method).toBe('POST');
    expect(writeInit.headers).toEqual({
      authorization: 'Bearer sync-token',
      'content-type': 'application/json',
    });
    expect(JSON.parse(String(writeInit.body))).toEqual({
      key: 'commander.settings.v1',
      visibility: 'private',
      value: {
        schemaVersion: 1,
        revision: 9,
        updatedAt: synced.syncUpdatedAt,
        preferences: {
          appearance: 'dark',
          textSize: 'large',
          windowMode: 'compact',
          showFavouritesInCompactMode: true,
        },
      },
    });
  });
});
