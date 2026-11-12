import type { CommanderAccount, CommanderSettings } from '@commander/protocol';

export const NETWORK_PROBE_PACKET_BYTES = [
  56 * 1024,
  500 * 1024,
  2 * 1024 * 1024,
  5 * 1024 * 1024,
  10 * 1024 * 1024,
] as const;
export const NETWORK_PROBE_MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
export const NETWORK_PROBE_REQUIREMENTS = {
  'api.network-probe-ping': '1.1.0',
  'api.network-probe-download': '1.1.0',
  'api.network-probe-upload': '2.1.0',
} as const;

export function networkProbeCredential(
  settings: CommanderSettings,
  accounts: CommanderAccount[],
  credentials: ReadonlyMap<string, string>,
): string | undefined {
  if (!settings.activeAccountId) return undefined;
  const account = accounts.find((entry) => entry.id === settings.activeAccountId);
  if (
    !account?.environment ||
    account.environment.baseUrl !== new URL(settings.thingtimeBaseUrl).origin ||
    account.environment.clientId !== settings.thingtimeClientId
  )
    throw new Error(
      'The active account belongs to a different Thingtime environment. Select or sign in to an account for this server.',
    );
  const token = credentials.get(account.id);
  if (!token)
    throw new Error('Unlock or sign in to the active Thingtime account before running a speed test');
  return token;
}

export function networkProbeUploadChunks(bytes: number): number[] {
  if (!NETWORK_PROBE_PACKET_BYTES.includes(bytes as (typeof NETWORK_PROBE_PACKET_BYTES)[number])) {
    throw new Error('Unsupported speed-test sample size');
  }
  const chunks: number[] = [];
  for (let remaining = bytes; remaining > 0; remaining -= NETWORK_PROBE_MAX_UPLOAD_BYTES) {
    chunks.push(Math.min(remaining, NETWORK_PROBE_MAX_UPLOAD_BYTES));
  }
  return chunks;
}

export function assertNetworkProbeCapabilities(
  manifest: unknown,
  origin: string,
  includeSpeed: boolean,
): void {
  const value = manifest as {
    schemaVersion?: unknown;
    origin?: unknown;
    features?: Record<string, { version?: unknown }>;
  } | null;
  if (value?.schemaVersion !== 1 || value.origin !== origin || !value.features) {
    throw new Error('Thingtime returned an invalid network-test capability manifest');
  }
  for (const [feature, minimum] of Object.entries(NETWORK_PROBE_REQUIREMENTS)) {
    if (!includeSpeed && feature !== 'api.network-probe-ping') continue;
    const version = value.features[feature]?.version;
    const actual =
      typeof version === 'string' && /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version)
        ? version.split('.').map(Number)
        : [];
    const required = minimum.split('.').map(Number);
    if (
      actual.length !== 3 ||
      actual[0] !== required[0] ||
      actual[1]! < required[1]! ||
      (actual[1] === required[1] && actual[2]! < required[2]!)
    ) {
      throw new Error(
        `This Thingtime server needs ${feature} ${minimum} or a compatible update before running this test`,
      );
    }
  }
}

export async function fetchNetworkProbeCapabilities(baseUrl: URL): Promise<unknown> {
  const response = await fetch(new URL('/.well-known/thingtime-capabilities.json', baseUrl), {
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
    headers: { accept: 'application/json' },
  });
  if (!response.ok || !response.body)
    throw new Error(`Could not check Thingtime network-test compatibility (${response.status})`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 512 * 1024) {
        await reader.cancel();
        throw new Error('Thingtime capability manifest is too large');
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } finally {
    reader.releaseLock();
  }
}
