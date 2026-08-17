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
        recentSearches: [],
        extensions: [
          {
            id: 'builtin:commander',
            name: 'commander',
            source: 'builtin',
            compatibility: 'native',
            commands: [
              {
                name: 'close-commander',
                title: 'Close Commander',
                description: 'Quit the Commander app and stop its background service.',
                keywords: expect.arrayContaining(['exit', 'quit', 'terminate']),
              },
              {
                name: 'close-commander-window',
                title: 'Close Commander Window',
                description: 'Hide the floating Commander window without quitting the app.',
                keywords: expect.arrayContaining(['close window', 'dismiss', 'hide']),
              },
              {
                name: 'open-commander',
                title: 'Open Commander',
                description: 'Open and focus the floating Commander window.',
                keywords: expect.arrayContaining(['open', 'launch', 'show']),
              },
            ],
          },
        ],
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

      const extensionSettings = await fetch(`${server.url}/api/execute`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-commander-session': server.token,
        },
        body: JSON.stringify({ itemId: 'builtin:extensions', actionId: 'open-settings' }),
      });
      expect(extensionSettings.status).toBe(200);
      expect(await extensionSettings.json()).toEqual({
        ok: true,
        nativeRequest: { method: 'settings.open', params: { tab: 'extensions' } },
      });

      const accountSettings = await fetch(`${server.url}/api/execute`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-commander-session': server.token,
        },
        body: JSON.stringify({ itemId: 'builtin:accounts', actionId: 'open-settings' }),
      });
      expect(accountSettings.status).toBe(200);
      expect(await accountSettings.json()).toEqual({
        ok: true,
        nativeRequest: { method: 'settings.open', params: { tab: 'account' } },
      });

      const exitSearch = await fetch(`${server.url}/api/search?q=exit`, {
        headers: { 'x-commander-session': server.token },
      });
      expect(exitSearch.status).toBe(200);
      const exitResults = (await exitSearch.json()) as { hits: Array<{ id: string }> };
      expect(exitResults.hits[0]).toMatchObject({
        id: 'extension:builtin:commander:close-commander',
        title: 'Close Commander',
        subtitle: 'Commander',
        extensionId: 'builtin:commander',
        commandName: 'close-commander',
      });

      const closeCommander = await fetch(`${server.url}/api/execute`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-commander-session': server.token,
        },
        body: JSON.stringify({
          itemId: 'extension:builtin:commander:close-commander',
          actionId: 'run',
        }),
      });
      expect(closeCommander.status).toBe(200);
      expect(await closeCommander.json()).toEqual({
        ok: true,
        nativeRequest: { method: 'application.quit' },
      });

      const closeWindow = await fetch(`${server.url}/api/execute`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-commander-session': server.token,
        },
        body: JSON.stringify({
          itemId: 'extension:builtin:commander:close-commander-window',
          actionId: 'run',
        }),
      });
      expect(closeWindow.status).toBe(200);
      expect(await closeWindow.json()).toEqual({
        ok: true,
        nativeRequest: { method: 'launcher.hide' },
      });

      const openCommander = await fetch(`${server.url}/api/execute`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-commander-session': server.token,
        },
        body: JSON.stringify({
          itemId: 'extension:builtin:commander:open-commander',
          actionId: 'run',
        }),
      });
      expect(openCommander.status).toBe(200);
      expect(await openCommander.json()).toEqual({
        ok: true,
        nativeRequest: { method: 'launcher.show' },
      });

      const rememberedSearch = await fetch(`${server.url}/api/history`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-commander-session': server.token,
        },
        body: JSON.stringify({
          query: '1password',
          command: {
            itemId: 'app:1password',
            actionId: 'open',
            title: '1Password',
            subtitle: '/Applications/1Password.app',
            icon: 'application',
            kind: 'application',
            actionTitle: 'Open',
          },
        }),
      });
      expect(rememberedSearch.status).toBe(200);
      expect(await rememberedSearch.json()).toEqual({
        recentSearches: [
          {
            query: '1password',
            commands: [
              {
                itemId: 'app:1password',
                actionId: 'open',
                title: '1Password',
                subtitle: '/Applications/1Password.app',
                icon: 'application',
                kind: 'application',
                actionTitle: 'Open',
              },
            ],
          },
        ],
      });

      const historyBootstrap = await fetch(`${server.url}/api/bootstrap`, {
        headers: { 'x-commander-session': server.token },
      });
      expect(historyBootstrap.status).toBe(200);
      expect(await historyBootstrap.json()).toMatchObject({
        recentSearches: [
          {
            query: '1password',
            commands: [expect.objectContaining({ itemId: 'app:1password', actionId: 'open' })],
          },
        ],
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
