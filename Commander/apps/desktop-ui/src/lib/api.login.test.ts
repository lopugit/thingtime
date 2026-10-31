import { afterEach, describe, expect, it, vi } from 'vitest';

const origin = 'http://127.0.0.1:47820';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('login API compatibility gate', () => {
  it.each(['1.1.0', '2.0.0'])('negotiates %s before sending a login request', async (version) => {
    vi.stubGlobal('window', { location: { origin, search: '?token=test-session' } });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ schemaVersion: 1, origin, features: { 'commander.accounts-login': { version } } }),
      )
      .mockResolvedValueOnce(
        Response.json({ authorizeUrl: 'https://thingtime.test/authorize', state: 'test-state' }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('./api');
    if (version === '2.0.0') {
      await expect(api.beginLogin()).rejects.toThrow('requires');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } else {
      await expect(api.beginLogin()).resolves.toMatchObject({ state: 'test-state' });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1]![0]).toBe('/api/accounts/login');
      expect(fetchMock.mock.calls[1]![1]).toMatchObject({ method: 'POST' });
    }
  });
});
