// Require only the local operation used by sign-in. The server's coarse
// protocolVersion and deployment identity are not feature compatibility proof.
export const DAEMON_LOGIN_REQUIREMENTS = { 'commander.accounts-login': '1.1.0' } as const;

export function assertDaemonLoginCapabilities(manifest: unknown, origin: string): void {
  const value = manifest as {
    schemaVersion?: unknown;
    origin?: unknown;
    features?: Record<string, { version?: unknown }>;
  } | null;
  if (value?.schemaVersion !== 1 || value.origin !== origin || !value.features)
    throw new Error('Commander returned an invalid local capability manifest');
  for (const [feature, minimum] of Object.entries(DAEMON_LOGIN_REQUIREMENTS)) {
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
      throw new Error(`Commander sign-in requires ${feature} ${minimum} or a compatible update`);
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
