import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCommanderServer, type CommanderServer } from './server.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Commander daemon HTTP trust boundaries', () => {
  it('keeps UI and native API tokens separate and never exposes a native credential in bootstrap state', async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'commander-daemon-test-'));
    const uiPath = path.join(temporary, 'ui');
    await mkdir(uiPath);
    await writeFile(path.join(uiPath, 'launcher.html'), '<!doctype html><title>Commander test</title>');
    vi.stubEnv('COMMANDER_DATA_DIR', path.join(temporary, 'data'));

    let server: CommanderServer | undefined;
    try {
      server = await createCommanderServer({ host: '127.0.0.1', port: 0, uiPath });
      expect(server.token).not.toBe(server.nativeToken);

      const health = await fetch(`${server.url}/healthz`);
      expect(health.status).toBe(200);
      expect(health.headers.get('cache-control')).toBe('no-store');
      expect(await health.json()).toEqual({ ok: true, protocolVersion: 1, pid: process.pid });

      const unauthenticated = await fetch(`${server.url}/api/bootstrap`);
      expect(unauthenticated.status).toBe(401);
      expect(await unauthenticated.json()).toEqual({ error: 'Unauthorized' });

      const wrongSession = await fetch(`${server.url}/api/bootstrap`, {
        headers: { 'x-commander-session': `${server.token}-wrong` },
      });
      expect(wrongSession.status).toBe(401);

      const nativeRouteWithUiToken = await fetch(`${server.url}/api/native/credentials`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'x-commander-session': server.token,
        },
        body: JSON.stringify({ accountId: 'thing-user-1', token: 'native-only-test-token' }),
      });
      expect(nativeRouteWithUiToken.status).toBe(401);

      const credentialWrite = await fetch(`${server.url}/api/native/credentials`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'x-commander-native': server.nativeToken,
        },
        body: JSON.stringify({ accountId: 'thing-user-1', token: 'native-only-test-token' }),
      });
      expect(credentialWrite.status).toBe(200);
      expect(await credentialWrite.json()).toEqual({ ok: true });

      const uiRouteWithNativeToken = await fetch(`${server.url}/api/bootstrap`, {
        headers: { 'x-commander-native': server.nativeToken },
      });
      expect(uiRouteWithNativeToken.status).toBe(401);

      const bootstrap = await fetch(`${server.url}/api/bootstrap`, {
        headers: { 'x-commander-session': server.token },
      });
      expect(bootstrap.status).toBe(200);
      const bootstrapText = await bootstrap.text();
      expect(bootstrapText).not.toContain('native-only-test-token');
      expect(JSON.parse(bootstrapText)).toMatchObject({
        protocolVersion: 1,
        settings: { version: 1 },
        accounts: [],
        extensions: [],
        capabilities: { secureCredentialStore: true },
      });

      const settingsSearch = await fetch(`${server.url}/api/search?q=settings`, {
        headers: { 'x-commander-session': server.token },
      });
      expect(settingsSearch.status).toBe(200);
      const settingsResults = (await settingsSearch.json()) as { hits: unknown[] };
      expect(settingsResults.hits[0]).toMatchObject({
        id: 'builtin:settings',
        title: 'Settings',
        subtitle: 'Commander Settings',
      });

      const missingClaim = await fetch(`${server.url}/api/native/credentials/claim`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-commander-native': server.nativeToken,
        },
        body: JSON.stringify({ accountId: 'thing-user-1' }),
      });
      expect(missingClaim.status).toBe(404);
      expect(await missingClaim.json()).toEqual({ error: 'No pending credential for this account' });
    } finally {
      await server?.close();
      await rm(temporary, { recursive: true, force: true });
    }
  });
});
