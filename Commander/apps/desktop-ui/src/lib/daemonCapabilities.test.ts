import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertDaemonLoginCapabilities, verifyDaemonLoginCapabilities } from './daemonCapabilities';

const origin = 'http://127.0.0.1:47820';
const manifest = (version = '1.1.0') => ({
  schemaVersion: 1,
  origin,
  features: { 'commander.accounts-login': { version } },
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Commander login capability negotiation', () => {
  it.each(['1.1.0', '1.1.1', '1.2.0'])('accepts compatible %s', (version) => {
    expect(() => assertDaemonLoginCapabilities(manifest(version), origin)).not.toThrow();
  });
  it.each(['1.0.99', '2.0.0', 'invalid'])('rejects incompatible %s', (version) => {
    expect(() => assertDaemonLoginCapabilities(manifest(version), origin)).toThrow('requires');
  });
  it('rejects missing operations and wrong origin or schema', () => {
    expect(() => assertDaemonLoginCapabilities({ ...manifest(), features: {} }, origin)).toThrow('requires');
    expect(() => assertDaemonLoginCapabilities(manifest(), 'http://127.0.0.1:47821')).toThrow('invalid');
    expect(() => assertDaemonLoginCapabilities({ ...manifest(), schemaVersion: 2 }, origin)).toThrow(
      'invalid',
    );
  });
  it('checks the exact origin without redirects before sign-in', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(manifest()));
    vi.stubGlobal('fetch', fetchMock);
    await verifyDaemonLoginCapabilities(origin);
    expect(String(fetchMock.mock.calls[0]![0])).toBe(`${origin}/.well-known/commander-capabilities.json`);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ redirect: 'error', signal: expect.any(AbortSignal) });
  });
  it('fails closed when the daemon manifest is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(verifyDaemonLoginCapabilities(origin)).rejects.toThrow('compatibility (404)');
  });
});

it('requires the additive searchable-count status contract and rejects missing/breaking origins', async () => {
  const { assertDaemonIndexCapabilities } = await import('./daemonCapabilities');
  const manifest = {
    schemaVersion: 1,
    origin: 'http://127.0.0.1:47820',
    features: { 'commander.index-status': { version: '1.1.0' } },
  };
  expect(() => assertDaemonIndexCapabilities(manifest, manifest.origin)).not.toThrow();
  expect(() =>
    assertDaemonIndexCapabilities(
      { ...manifest, features: { 'commander.index-status': { version: '1.2.0' } } },
      manifest.origin,
    ),
  ).not.toThrow();
  for (const features of [
    {},
    { 'commander.index-status': { version: '1.0.0' } },
    { 'commander.index-status': { version: '2.0.0' } },
  ]) {
    expect(() => assertDaemonIndexCapabilities({ ...manifest, features }, manifest.origin)).toThrow();
  }
  expect(() => assertDaemonIndexCapabilities(manifest, 'http://127.0.0.1:49999')).toThrow();
});
