// Require only the local operation used by sign-in. The server's coarse
// protocolVersion and deployment identity are not feature compatibility proof.
export const DAEMON_LOGIN_REQUIREMENTS = { 'commander.accounts-login': '1.1.0' } as const;
export const DAEMON_INDEX_REQUIREMENTS = { 'commander.index-status': '1.1.0' } as const;

export function assertDaemonLoginCapabilities(manifest: unknown, origin: string): void {
  assertDaemonCapabilities(manifest, origin, DAEMON_LOGIN_REQUIREMENTS, 'sign-in');
}

export function assertDaemonIndexCapabilities(manifest: unknown, origin: string): void {
  assertDaemonCapabilities(manifest, origin, DAEMON_INDEX_REQUIREMENTS, 'search status');
}

function assertDaemonCapabilities(
  manifest: unknown,
  origin: string,
  requirements: Record<string, string>,
  label: string,
): void {
  const value = manifest as {
    schemaVersion?: unknown;
    origin?: unknown;
    features?: Record<string, { version?: unknown }>;
  } | null;
  if (value?.schemaVersion !== 1 || value.origin !== origin || !value.features)
    throw new Error('Commander returned an invalid local capability manifest');
  for (const [feature, minimum] of Object.entries(requirements)) {
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
    )
      throw new Error(`Commander ${label} requires ${feature} ${minimum} or a compatible update`);
  }
}

export async function verifyDaemonLoginCapabilities(origin: string): Promise<void> {
  const response = await fetch(new URL('/.well-known/commander-capabilities.json', origin), {
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Could not check Commander sign-in compatibility (${response.status})`);
  assertDaemonLoginCapabilities(await response.json(), origin);
}

// A local daemon instance serves one negotiated contract for its lifetime.
// Failed checks are evicted so relaunch/retry can recover without reloading UI.
const indexChecks = new Map<string, Promise<void>>();
export function verifyDaemonIndexCapabilities(origin: string): Promise<void> {
  const existing = indexChecks.get(origin);
  if (existing) return existing;
  const pending = (async () => {
    const response = await fetch(new URL('/.well-known/commander-capabilities.json', origin), {
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      headers: { accept: 'application/json' },
    });
    if (!response.ok)
      throw new Error(`Could not check Commander search status compatibility (${response.status})`);
    assertDaemonIndexCapabilities(await response.json(), origin);
  })();
  indexChecks.set(origin, pending);
  void pending.catch(() => {
    if (indexChecks.get(origin) === pending) indexChecks.delete(origin);
  });
  return pending;
}
