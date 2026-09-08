import { createHash, randomBytes } from 'node:crypto';
import type { CommanderAccount, CommanderSettings, ThingtimeNetworkProbe } from '@commander/protocol';
import {
  assertNetworkProbeCapabilities,
  fetchNetworkProbeCapabilities,
  NETWORK_PROBE_PACKET_BYTES,
  networkProbeUploadChunks,
} from './networkProbe.js';
const NETWORK_PROBE_TIMEOUT_MS = 90_000;

interface LoginStart {
  authorizeUrl: string;
  state: string;
  verifier: string;
}

export class ThingtimeService {
  #pending = new Map<string, { verifier: string; createdAt: number }>();
  #networkCapabilities: { origin: string; expiresAt: number; manifest: unknown } | undefined;
  #speedProbe: { origin: string; identity: string; result: Promise<ThingtimeNetworkProbe> } | undefined;

  beginLogin(settings: CommanderSettings, redirectUri: string): LoginStart {
    if (!settings.thingtimeClientId)
      throw new Error('Set a Thingtime client ID in Commander before signing in');
    const baseUrl = validatedThingtimeBaseUrl(settings.thingtimeBaseUrl);
    const state = randomBytes(24).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    this.#pending.set(state, { verifier, createdAt: Date.now() });
    const url = new URL('/authorize', baseUrl);
    url.searchParams.set('client_id', settings.thingtimeClientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('scope', 'profile.username app-data');
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return { authorizeUrl: url.toString(), state, verifier };
  }

  async exchange(
    settings: CommanderSettings,
    state: string,
    code: string,
    redirectUri: string,
  ): Promise<{ account: CommanderAccount; token: string }> {
    const pending = this.#pending.get(state);
    this.#pending.delete(state);
    if (!pending || Date.now() - pending.createdAt > 10 * 60_000)
      throw new Error('Thingtime login expired; start again');
    const baseUrl = validatedThingtimeBaseUrl(settings.thingtimeBaseUrl);
    const response = await fetch(new URL('/api/v1/oauth/token', baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grantType: 'authorization_code',
        clientId: settings.thingtimeClientId,
        code,
        codeVerifier: pending.verifier,
        redirectUri,
      }),
    });
    const session = (await response.json()) as {
      ok?: boolean;
      accessToken?: string;
      expiresAt?: string;
      scopes?: string[];
      error?: string;
    };
    if (!response.ok || !session.accessToken)
      throw new Error(session.error ?? 'Thingtime token exchange failed');
    const profileResponse = await fetch(new URL('/api/v1/oauth/userinfo', baseUrl), {
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    const profile = (await profileResponse.json()) as {
      ok?: boolean;
      scopes?: string[];
      user?: Record<string, unknown>;
      error?: string;
    };
    if (!profileResponse.ok || !profile.user)
      throw new Error(profile.error ?? 'Thingtime profile lookup failed');
    const user = profile.user;
    const id = String(user.id ?? '');
    const username = String(user.username ?? '');
    if (!id || !username) throw new Error('Thingtime returned an incomplete user profile');
    return {
      token: session.accessToken,
      account: {
        id,
        username,
        ...(typeof user.displayName === 'string' ? { displayName: user.displayName } : {}),
        ...(typeof user.avatarUrl === 'string' || user.avatarUrl === null
          ? { avatarUrl: user.avatarUrl as string | null }
          : {}),
        ...(typeof user.profileUrl === 'string' ? { profileUrl: user.profileUrl } : {}),
        scopes: profile.scopes ?? session.scopes ?? [],
        expiresAt: session.expiresAt ?? new Date(Date.now() + 30 * 86_400_000).toISOString(),
        environment: {
          baseUrl: baseUrl.origin,
          clientId: settings.thingtimeClientId,
        },
      },
    };
  }

  cancel(state: string): boolean {
    const pending = this.#pending.get(state);
    this.#pending.delete(state);
    return Boolean(pending && Date.now() - pending.createdAt <= 10 * 60_000);
  }

  async sync(token: string, settings: CommanderSettings): Promise<CommanderSettings> {
    const baseUrl = validatedThingtimeBaseUrl(settings.thingtimeBaseUrl);
    const endpoint = new URL('/api/v1/app-data', baseUrl);
    endpoint.searchParams.set('key', 'commander.settings.v1');
    const response = await fetch(endpoint, { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`Thingtime settings read failed (${response.status})`);
    const body = (await response.json()) as { entry?: { value?: CloudSettings } | null };
    const remote = body.entry?.value;
    const localRevision = settings.syncRevision ?? 0;
    const remoteRevision = typeof remote?.revision === 'number' ? remote.revision : -1;
    if (remote && remoteRevision > localRevision && !settings.syncDirty) {
      const preferences = sanitizeCloudPreferences(remote.preferences);
      return {
        ...settings,
        ...preferences,
        version: 1,
        syncRevision: remoteRevision,
        syncUpdatedAt: typeof remote.updatedAt === 'string' ? remote.updatedAt : new Date().toISOString(),
        syncDirty: false,
        thingtimeClientId: settings.thingtimeClientId,
        thingtimeBaseUrl: settings.thingtimeBaseUrl,
        activeAccountId: settings.activeAccountId,
        hotkey: settings.hotkey,
        openAtLogin: settings.openAtLogin,
        showMenuBarIcon: settings.showMenuBarIcon,
      };
    }
    if (remote && remoteRevision === localRevision && !settings.syncDirty) {
      return {
        ...settings,
        syncUpdatedAt: typeof remote.updatedAt === 'string' ? remote.updatedAt : settings.syncUpdatedAt,
      };
    }
    const updatedAt = new Date().toISOString();
    const nextRevision = Math.max(localRevision, remoteRevision, 0) + 1;
    const value: CloudSettings = {
      schemaVersion: 1,
      revision: nextRevision,
      updatedAt,
      preferences: {
        appearance: settings.appearance,
        textSize: settings.textSize,
        windowMode: settings.windowMode,
        showFavouritesInCompactMode: settings.showFavouritesInCompactMode,
      },
    };
    const write = await fetch(new URL('/api/v1/app-data', baseUrl), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'commander.settings.v1', value, visibility: 'private' }),
    });
    if (!write.ok) throw new Error(`Thingtime settings write failed (${write.status})`);
    return { ...settings, syncRevision: nextRevision, syncUpdatedAt: updatedAt, syncDirty: false };
  }

  async networkProbe(
    settings: CommanderSettings,
    includeSpeed = false,
    token?: string,
  ): Promise<ThingtimeNetworkProbe> {
    const baseUrl = validatedThingtimeBaseUrl(settings.thingtimeBaseUrl);
    if (!includeSpeed) return this.#runNetworkProbe(baseUrl, false);
    if (settings.activeAccountId && !token)
      throw new Error('Unlock or sign in to the active Thingtime account before running a speed test');
    const identity = token ? createHash('sha256').update(token).digest('hex') : 'guest';
    // All windows share this service: overlapping clicks join one run instead
    // of multiplying traffic, consuming the quota, and skewing measurements.
    if (this.#speedProbe) {
      if (this.#speedProbe.origin !== baseUrl.origin || this.#speedProbe.identity !== identity)
        throw new Error('A speed test is already running for another Thingtime server or account');
      return this.#speedProbe.result;
    }
    const result = this.#runNetworkProbe(baseUrl, true, token);
    this.#speedProbe = { origin: baseUrl.origin, identity, result };
    try {
      return await result;
    } finally {
      this.#speedProbe = undefined;
    }
  }

  async #runNetworkProbe(
    baseUrl: URL,
    includeSpeed: boolean,
    token?: string,
  ): Promise<ThingtimeNetworkProbe> {
    let cached = this.#networkCapabilities;
    if (!cached || cached.origin !== baseUrl.origin || cached.expiresAt <= Date.now()) {
      cached = {
        origin: baseUrl.origin,
        expiresAt: Date.now() + 5 * 60_000,
        manifest: await fetchNetworkProbeCapabilities(baseUrl),
      };
    }
    try {
      assertNetworkProbeCapabilities(cached.manifest, baseUrl.origin, includeSpeed);
    } catch (error) {
      this.#networkCapabilities = undefined;
      throw error;
    }
    this.#networkCapabilities = cached;
    const ping = await this.#ping(baseUrl, token);
    if (!includeSpeed) return { sampledAtMs: Date.now(), ping };

    const downloads: NonNullable<ThingtimeNetworkProbe['speed']>['downloads'] = [];
    const uploads: NonNullable<ThingtimeNetworkProbe['speed']>['uploads'] = [];
    const errors: NonNullable<ThingtimeNetworkProbe['speed']>['errors'] = [];
    // Keep each transfer serial and bounded: one full run is exactly the
    // documented five-packet ladder in each direction (17.6 MiB each way).
    for (const direction of ['download', 'upload'] as const) {
      const samples = direction === 'download' ? downloads : uploads;
      try {
        for (const bytes of NETWORK_PROBE_PACKET_BYTES) {
          samples.push(
            await (direction === 'download'
              ? this.#download(baseUrl, bytes, token)
              : this.#uploadSample(baseUrl, bytes, token)),
          );
        }
      } catch (error) {
        // Stop this direction on its first failure, including 429. Keep its
        // completed samples and still measure the independently limited other direction.
        errors.push({ direction, message: error instanceof Error ? error.message : 'Transfer failed' });
      }
    }
    const sampledAtMs = Date.now();
    return {
      sampledAtMs,
      ping,
      speed: { sampledAtMs, packetBytes: [...NETWORK_PROBE_PACKET_BYTES], downloads, uploads, errors },
    };
  }

  async #ping(baseUrl: URL, token?: string): Promise<ThingtimeNetworkProbe['ping']> {
    const startedAt = performance.now();
    const response = await fetch(new URL('/api/v1/network-probe/ping', baseUrl), {
      headers: { 'accept-encoding': 'identity', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      redirect: 'error',
      signal: AbortSignal.timeout(NETWORK_PROBE_TIMEOUT_MS),
    });
    const headersAt = performance.now();
    if (!response.ok) throw await networkProbeError(response, 'Thingtime ping failed');
    await response.arrayBuffer();
    const completedAt = performance.now();
    return {
      requestMs: headersAt - startedAt,
      responseMs: completedAt - headersAt,
      roundTripMs: completedAt - startedAt,
    };
  }

  async #download(
    baseUrl: URL,
    bytes: number,
    token?: string,
  ): Promise<{ bytes: number; durationMs: number; megabitsPerSecond: number }> {
    const startedAt = performance.now();
    const response = await fetch(new URL(`/api/v1/network-probe/download?bytes=${bytes}`, baseUrl), {
      headers: { 'accept-encoding': 'identity', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      redirect: 'error',
      signal: AbortSignal.timeout(NETWORK_PROBE_TIMEOUT_MS),
    });
    if (!response.ok)
      throw await networkProbeError(response, `Thingtime download probe failed for ${bytes} bytes`);
    const body = await response.arrayBuffer();
    const durationMs = Math.max(1, performance.now() - startedAt);
    if (body.byteLength !== bytes)
      throw new Error(`Thingtime download probe returned ${body.byteLength} bytes, expected ${bytes}`);
    return { bytes, durationMs, megabitsPerSecond: megabitsPerSecond(bytes, durationMs) };
  }

  async #upload(
    baseUrl: URL,
    bytes: number,
    token?: string,
  ): Promise<{ bytes: number; durationMs: number; megabitsPerSecond: number }> {
    const payload = new Uint8Array(bytes);
    const startedAt = performance.now();
    const response = await fetch(new URL(`/api/v1/network-probe/upload?bytes=${bytes}`, baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(bytes),
        'accept-encoding': 'identity',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: payload,
      redirect: 'error',
      signal: AbortSignal.timeout(NETWORK_PROBE_TIMEOUT_MS),
    });
    const durationMs = Math.max(1, performance.now() - startedAt);
    if (!response.ok)
      throw await networkProbeError(response, `Thingtime upload probe failed for ${bytes} bytes`);
    const result = (await response.json()) as { ok?: boolean; bytes?: unknown };
    if (result.ok !== true || result.bytes !== bytes)
      throw new Error(`Thingtime upload probe did not acknowledge ${bytes} bytes`);
    return { bytes, durationMs, megabitsPerSecond: megabitsPerSecond(bytes, durationMs) };
  }

  async #uploadSample(
    baseUrl: URL,
    bytes: number,
    token?: string,
  ): Promise<{ bytes: number; durationMs: number; megabitsPerSecond: number }> {
    const started = performance.now();
    for (const chunkBytes of networkProbeUploadChunks(bytes)) await this.#upload(baseUrl, chunkBytes, token);
    const durationMs = Math.max(1, performance.now() - started);
    return { bytes, durationMs, megabitsPerSecond: megabitsPerSecond(bytes, durationMs) };
  }
}

function megabitsPerSecond(bytes: number, durationMs: number): number {
  return (bytes * 8) / (durationMs * 1_000);
}

async function networkProbeError(response: Response, fallback: string): Promise<Error> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  if (response.status === 404)
    return new Error('This Thingtime deployment has not enabled Commander network probes yet (404)');
  if (response.status === 429) {
    const seconds = Number(response.headers.get('retry-after'));
    return new Error(
      Number.isFinite(seconds) && seconds > 0
        ? `Speed-test cooldown; retry in ${Math.ceil(seconds / 60)} minute(s) (429)`
        : 'Speed-test cooldown; please retry later (429)',
    );
  }
  const detail = typeof body?.error === 'string' ? body.error : fallback;
  return new Error(`${detail} (${response.status})`);
}

interface CloudSettings {
  schemaVersion: 1;
  revision: number;
  updatedAt: string;
  preferences: Pick<
    CommanderSettings,
    'appearance' | 'textSize' | 'windowMode' | 'showFavouritesInCompactMode'
  >;
}

function sanitizeCloudPreferences(value: unknown): CloudSettings['preferences'] {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    appearance:
      source.appearance === 'light' || source.appearance === 'dark' || source.appearance === 'system'
        ? source.appearance
        : 'system',
    textSize: source.textSize === 'large' ? 'large' : 'default',
    windowMode: source.windowMode === 'compact' ? 'compact' : 'default',
    showFavouritesInCompactMode:
      typeof source.showFavouritesInCompactMode === 'boolean' ? source.showFavouritesInCompactMode : true,
  };
}

function validatedThingtimeBaseUrl(value: string): URL {
  const url = new URL(value);
  const loopback = url.hostname === '127.0.0.1' || url.hostname === '[::1]' || url.hostname === 'localhost';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('Thingtime must use HTTPS (HTTP is allowed only for a local development server)');
  }
  if (url.username || url.password) throw new Error('Thingtime URL must not contain credentials');
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url;
}
