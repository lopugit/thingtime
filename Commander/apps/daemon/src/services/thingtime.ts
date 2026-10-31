import { createHash, randomBytes } from 'node:crypto';
import type { CommanderAccount, CommanderSettings } from '@commander/protocol';

interface LoginStart {
  authorizeUrl: string;
  state: string;
  verifier: string;
}

export class ThingtimeService {
  #pending = new Map<string, { verifier: string; createdAt: number }>();

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
