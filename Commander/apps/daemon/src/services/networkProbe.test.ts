import { describe, expect, it } from 'vitest';
import {
  assertNetworkProbeCapabilities,
  NETWORK_PROBE_PACKET_BYTES,
  NETWORK_PROBE_REQUIREMENTS,
  networkProbeUploadChunks,
} from './networkProbe.js';

const manifest = (upload = '2.0.0', origin = 'https://thingtime.test') => ({
  schemaVersion: 1,
  origin,
  features: Object.fromEntries(
    Object.entries({ ...NETWORK_PROBE_REQUIREMENTS, 'api.network-probe-upload': upload }).map(
      ([key, version]) => [key, { version }],
    ),
  ),
});

describe('network test protocol', () => {
  it('preserves every logical sample and the total bytes across 11 small uploads', () => {
    const chunks = NETWORK_PROBE_PACKET_BYTES.flatMap(networkProbeUploadChunks);
    expect(chunks).toHaveLength(11);
    for (const bytes of NETWORK_PROBE_PACKET_BYTES)
      expect(networkProbeUploadChunks(bytes).reduce((a, b) => a + b, 0)).toBe(bytes);
    expect(Math.max(...chunks)).toBe(2 * 1024 * 1024);
    expect(() => networkProbeUploadChunks(Infinity)).toThrow();
  });
  it.each(['2.0.0', '2.0.1', '2.1.0'])('accepts compatible version %s', (version) => {
    expect(() =>
      assertNetworkProbeCapabilities(manifest(version), 'https://thingtime.test', true),
    ).not.toThrow();
  });
  it.each(['1.9.9', '3.0.0', '2.0.0-beta', '2', '', '02.0.0'])(
    'rejects incompatible version %s',
    (version) => {
      expect(() =>
        assertNetworkProbeCapabilities(manifest(version), 'https://thingtime.test', true),
      ).toThrow();
    },
  );
  it('rejects missing contracts and a manifest from another origin', () => {
    expect(() =>
      assertNetworkProbeCapabilities(
        { schemaVersion: 1, origin: 'https://thingtime.test', features: {} },
        'https://thingtime.test',
        true,
      ),
    ).toThrow();
    expect(() => assertNetworkProbeCapabilities(manifest(), 'https://other.test', true)).toThrow();
    expect(() =>
      assertNetworkProbeCapabilities(manifest('1.0.0'), 'https://thingtime.test', false),
    ).not.toThrow();
  });
});
