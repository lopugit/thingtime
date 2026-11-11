import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@commander/protocol';
import { LOGIN_REQUIREMENTS, registeredLoginRedirect } from './loginRegistration.js';
import { ThingtimeService } from './thingtime.js';

const origin = 'https://thingtime.test';
const native = 'com.thingtime.commander://oauth/callback';
const loopback = 'http://127.0.0.1:47820/oauth/callback';
const clientId = 'test-client';
const manifest = (): {
  schemaVersion: number;
  origin: string;
  features: Record<string, { version: string }>;
} => ({
  schemaVersion: 1,
  origin,
  features: Object.fromEntries(
    Object.entries(LOGIN_REQUIREMENTS).map(([key, version]) => [key, { version }]),
  ),
});
const registered = (redirect: string) => Response.json({ ok: true, app: { clientId }, origin: redirect });
const refused = () =>
  Response.json({ ok: false, error: 'This desktop callback is not registered on the app' }, { status: 403 });
const select = () => registeredLoginRedirect(new URL(origin), clientId, native, loopback);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('registered Thingtime sign-in callbacks', () => {
  it('prefers the registered native callback and checks the selected origin capabilities first', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(manifest()))
      .mockResolvedValueOnce(registered(native));
    vi.stubGlobal('fetch', fetchMock);
    expect(await select()).toBe(native);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]![0])).toBe(`${origin}/.well-known/thingtime-capabilities.json`);
    const lookup = new URL(String(fetchMock.mock.calls[1]![0]));
    expect(lookup.origin).toBe(origin);
    expect(lookup.searchParams.get('redirect_uri')).toBe(native);
    expect(lookup.searchParams.get('scope')).toBe('profile.username app-data');
    for (const [, init] of fetchMock.mock.calls)
      expect(init).toMatchObject({ redirect: 'error', signal: expect.any(AbortSignal) });
  });

  it('selects only the exact verified loopback after explicit native registration refusal and exchanges with that URI', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(manifest()))
      .mockResolvedValueOnce(refused())
      .mockResolvedValueOnce(registered(loopback))
      .mockResolvedValueOnce(Response.json({ accessToken: 'test-token' }))
      .mockResolvedValueOnce(Response.json({ user: { id: 'test-user', username: 'tester' } }));
    vi.stubGlobal('fetch', fetchMock);
    const service = new ThingtimeService();
    const settings = { ...DEFAULT_SETTINGS, thingtimeBaseUrl: origin, thingtimeClientId: clientId };
    const login = await service.beginRegisteredLogin(settings, native, loopback);
    expect(new URL(login.authorizeUrl).searchParams.get('redirect_uri')).toBe(loopback);
    expect(new URL(String(fetchMock.mock.calls[2]![0])).searchParams.get('redirect_uri')).toBe(loopback);
    await service.exchange(settings, login.state, 'code', loopback);
    expect(JSON.parse(String(fetchMock.mock.calls[3]![1].body))).toMatchObject({
      redirectUri: loopback,
      clientId,
    });
    await expect(service.exchange(settings, login.state, 'code', loopback)).rejects.toThrow('login expired');
  });

  it.each([
    [403, 'This app has been suspended by an administrator'],
    [403, 'Unknown refusal'],
    [404, 'App not found'],
    [429, 'Too many requests'],
    [500, 'This desktop callback is not registered on the app'],
  ])('never falls back after a %s %s response', async (status, error) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(manifest()))
      .mockResolvedValueOnce(Response.json({ ok: false, error }, { status }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(select()).rejects.toThrow('Could not verify');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not fall back on a transport failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(manifest()))
      .mockRejectedValueOnce(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(select()).rejects.toThrow('offline');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails when both exact callbacks are unregistered', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(manifest()))
      .mockResolvedValueOnce(refused())
      .mockResolvedValueOnce(refused());
    vi.stubGlobal('fetch', fetchMock);
    await expect(select()).rejects.toThrow('Neither Commander callback');
  });

  it.each(['missing', 'breaking', 'old', 'wrong-origin', 'wrong-schema'])(
    'rejects %s capabilities before lookup',
    async (mode) => {
      const value = manifest();
      if (mode === 'missing') delete (value.features as Record<string, unknown>)['api.apps-public'];
      if (mode === 'breaking') value.features['api.oauth-token'] = { version: '2.0.0' };
      if (mode === 'old') value.features['api.oauth-token'] = { version: '1.1.99' };
      if (mode === 'wrong-origin') value.origin = 'https://other.test';
      if (mode === 'wrong-schema') value.schemaVersion = 2;
      const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(value));
      vi.stubGlobal('fetch', fetchMock);
      await expect(select()).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('accepts compatible capability updates', async () => {
    const value = manifest();
    value.features['api.apps-public'] = { version: '1.9.2' };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(Response.json(value)).mockResolvedValueOnce(registered(native)),
    );
    expect(await select()).toBe(native);
  });

  it.each([
    { ok: true, app: { clientId: 'other-client' }, origin: native },
    { ok: true, app: { clientId }, origin: loopback },
    { ok: true, sandbox: true, app: { clientId }, origin: native },
  ])('refuses an unrelated or sandbox success payload', async (body) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(manifest()))
      .mockResolvedValueOnce(Response.json(body));
    vi.stubGlobal('fetch', fetchMock);
    await expect(select()).rejects.toThrow('invalid callback registration');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
