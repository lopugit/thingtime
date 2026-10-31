export const LOGIN_REQUIREMENTS = {
  'api.apps-public': '1.1.0',
  'api.oauth-desktop-authorize': '1.2.0',
  'api.oauth-token': '1.2.0',
  'api.oauth-userinfo': '1.0.0',
} as const;

const UNREGISTERED_CALLBACK = 'This desktop callback is not registered on the app';

export async function registeredLoginRedirect(
  baseUrl: URL,
  clientId: string,
  nativeRedirect: string,
  loopbackRedirect: string,
): Promise<string> {
  const loopback = new URL(loopbackRedirect);
  if (
    loopback.protocol !== 'http:' ||
    !['127.0.0.1', '[::1]'].includes(loopback.hostname) ||
    !loopback.port ||
    Number(loopback.port) < 1024 ||
    loopback.pathname !== '/oauth/callback' ||
    loopback.username ||
    loopback.password ||
    loopback.search ||
    loopback.hash
  )
    throw new Error('Commander requires its exact bound loopback callback');

  const { response, body } = await readPublicJson(
    new URL('/.well-known/thingtime-capabilities.json', baseUrl),
  );
  if (!response.ok || body?.schemaVersion !== 1 || body.origin !== baseUrl.origin || !body.features)
    throw new Error('Thingtime returned an invalid sign-in capability manifest');
  for (const [feature, minimum] of Object.entries(LOGIN_REQUIREMENTS)) {
    const version = body.features[feature]?.version;
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
      throw new Error(`Thingtime sign-in requires ${feature} ${minimum} or a compatible update`);
  }

  const lookup = async (redirect: string) => {
    const url = new URL('/api/v1/apps/public', baseUrl);
    url.searchParams.set('clientId', clientId);
    url.searchParams.set('redirect_uri', redirect);
    url.searchParams.set('scope', 'profile.username app-data');
    const result = await readPublicJson(url);
    if (result.response.ok) {
      if (
        result.body?.ok !== true ||
        result.body.sandbox === true ||
        result.body.app?.clientId !== clientId ||
        result.body.origin !== redirect
      )
        throw new Error('Thingtime returned an invalid callback registration');
      return true;
    }
    if (
      result.response.status === 403 &&
      result.body?.ok === false &&
      result.body.error === UNREGISTERED_CALLBACK
    )
      return false;
    // Suspension, missing apps, transport errors and server errors must never
    // cause a different callback to be selected.
    throw new Error(`Could not verify Thingtime callback registration (${result.response.status})`);
  };
  if (await lookup(nativeRedirect)) return nativeRedirect;
  if (await lookup(loopbackRedirect)) return loopbackRedirect;
  throw new Error('Neither Commander callback is registered on this Thingtime app');
}

async function readPublicJson(url: URL): Promise<{
  response: Response;
  body: {
    schemaVersion?: unknown;
    origin?: unknown;
    features?: Record<string, { version?: unknown }>;
    ok?: unknown;
    sandbox?: unknown;
    app?: { clientId?: unknown };
    error?: unknown;
  } | null;
}> {
  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
    headers: { accept: 'application/json' },
  });
  if (!response.body) throw new Error('Thingtime returned an empty sign-in response');
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
        throw new Error('Thingtime sign-in response is too large');
      }
      text += decoder.decode(value, { stream: true });
    }
    return { response, body: JSON.parse(text + decoder.decode()) };
  } finally {
    reader.releaseLock();
  }
}
