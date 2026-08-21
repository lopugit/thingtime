import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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
      server = await createCommanderServer({ host: '127.0.0.1', port: 0, uiPath, platform: 'macos' });
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
            commands: expect.arrayContaining([
              expect.objectContaining({
                name: 'close-commander',
                title: 'Close Commander',
                description: 'Quit the Commander app and stop its background service.',
                keywords: expect.arrayContaining(['exit', 'quit', 'terminate']),
              }),
              expect.objectContaining({
                name: 'close-commander-window',
                title: 'Close Commander Window',
                description: 'Hide the floating Commander window without quitting the app.',
                keywords: expect.arrayContaining(['close window', 'dismiss', 'hide']),
              }),
              expect.objectContaining({
                name: 'open-commander',
                title: 'Open Commander',
                description: 'Open and focus the floating Commander window.',
                keywords: expect.arrayContaining(['open', 'launch', 'show']),
              }),
              expect.objectContaining({
                name: 'index-now',
                title: 'Index Now',
                keywords: expect.arrayContaining(['reindex', 'index everything']),
              }),
              expect.objectContaining({ name: 'index-applications', title: 'Index Apps Now' }),
              expect.objectContaining({ name: 'index-commands', title: 'Index Commands Now' }),
              expect.objectContaining({ name: 'index-files', title: 'Index Files Now' }),
              expect.objectContaining({ name: 'index-directories', title: 'Index Directories Now' }),
            ]),
          },
          {
            id: 'builtin:emoji-symbols',
            name: 'emoji-symbols',
            title: 'Emoji & Symbols',
            source: 'builtin',
            compatibility: 'native',
            commands: [
              {
                name: 'search-emoji-symbols',
                title: 'Search Emoji & Symbols',
                mode: 'view',
                keywords: expect.arrayContaining(['emoji', 'symbol', 'unicode', 'heart']),
              },
            ],
          },
          {
            id: 'builtin:macos-system',
            name: 'macos-system',
            title: 'macOS System',
            source: 'builtin',
            compatibility: 'native',
            commands: expect.arrayContaining([
              expect.objectContaining({
                name: 'open-accessibility-settings',
                title: 'Accessibility Settings',
                mode: 'no-view',
                keywords: expect.arrayContaining(['accessibility', 'assistive access', 'system settings']),
              }),
              expect.objectContaining({
                name: 'open-screen-recording-settings',
                title: 'Screen & System Audio Recording Settings',
              }),
            ]),
          },
        ],
        capabilities: { secureCredentialStore: true, filesystemIndex: false },
      });

      const indexingStatus = await fetch(`${server.url}/api/index/status`, {
        headers: { 'x-commander-session': server.token },
      });
      expect(indexingStatus.status).toBe(200);
      expect(await indexingStatus.json()).toMatchObject({
        available: false,
        running: [],
        databaseSizeBytes: 0,
        commands: { count: expect.any(Number), lastIndexedAtMs: expect.any(Number) },
        automaticRefresh: { applicationsMinutes: 5, filesystemMinutes: 360 },
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
        body: JSON.stringify({
          itemId: 'builtin:extensions',
          actionId: 'open-settings',
          query: 'extension prefs',
        }),
      });
      expect(extensionSettings.status).toBe(200);
      expect(await extensionSettings.json()).toEqual({
        ok: true,
        nativeRequest: { method: 'settings.open', params: { tab: 'extensions' } },
      });
      expect(
        JSON.parse(await readFile(path.join(temporary, 'data', 'state.json'), 'utf8')).searchPreferences,
      ).toEqual([
        expect.objectContaining({
          query: 'extension prefs',
          itemId: 'builtin:extensions',
          actionId: 'open-settings',
          count: 1,
        }),
      ]);

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

      const indexingSettings = await fetch(`${server.url}/api/execute`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-commander-session': server.token,
        },
        body: JSON.stringify({ itemId: 'builtin:indexing', actionId: 'open-settings' }),
      });
      expect(indexingSettings.status).toBe(200);
      expect(await indexingSettings.json()).toEqual({
        ok: true,
        nativeRequest: { method: 'settings.open', params: { tab: 'search' } },
      });

      const indexSearch = await fetch(`${server.url}/api/search?q=index%20now`, {
        headers: { 'x-commander-session': server.token },
      });
      expect(indexSearch.status).toBe(200);
      expect((await indexSearch.json()) as { hits: unknown[] }).toMatchObject({
        hits: expect.arrayContaining([
          expect.objectContaining({
            id: 'extension:builtin:commander:index-now',
            title: 'Index Now',
          }),
        ]),
      });

      const indexCommands = await fetch(`${server.url}/api/execute`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-commander-session': server.token,
        },
        body: JSON.stringify({
          itemId: 'extension:builtin:commander:index-commands',
          actionId: 'run',
        }),
      });
      expect(indexCommands.status).toBe(202);
      expect(await indexCommands.json()).toEqual({
        ok: true,
        notice: 'Indexing commands…',
      });

      const invalidIndexScope = await fetch(`${server.url}/api/index`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-commander-session': server.token,
        },
        body: JSON.stringify({ scope: 'secrets' }),
      });
      expect(invalidIndexScope.status).toBe(400);

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

      const emojiSearch = await fetch(`${server.url}/api/search?q=emoji`, {
        headers: { 'x-commander-session': server.token },
      });
      expect(emojiSearch.status).toBe(200);
      const emojiResults = (await emojiSearch.json()) as { hits: Array<{ id: string }> };
      expect(emojiResults.hits[0]).toMatchObject({
        id: 'extension:builtin:emoji-symbols:search-emoji-symbols',
        title: 'Search Emoji & Symbols',
        subtitle: 'Emoji & Symbols',
        extensionId: 'builtin:emoji-symbols',
        commandName: 'search-emoji-symbols',
      });

      const openEmojiPicker = await fetch(`${server.url}/api/execute`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-commander-session': server.token,
        },
        body: JSON.stringify({
          itemId: 'extension:builtin:emoji-symbols:search-emoji-symbols',
          actionId: 'run',
        }),
      });
      expect(openEmojiPicker.status).toBe(200);
      expect(await openEmojiPicker.json()).toEqual({
        ok: true,
        view: { id: 'emoji-symbols' },
      });

      const accessibilitySearch = await fetch(`${server.url}/api/search?q=accessibility`, {
        headers: { 'x-commander-session': server.token },
      });
      expect(accessibilitySearch.status).toBe(200);
      const accessibilityResults = (await accessibilitySearch.json()) as {
        hits: Array<{ id: string }>;
      };
      expect(accessibilityResults.hits[0]).toMatchObject({
        id: 'extension:builtin:macos-system:open-accessibility-settings',
        title: 'Accessibility Settings',
        subtitle: 'macOS System',
        kind: 'system',
        extensionId: 'builtin:macos-system',
        commandName: 'open-accessibility-settings',
      });

      const openAccessibilitySettings = await fetch(`${server.url}/api/execute`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-commander-session': server.token,
        },
        body: JSON.stringify({
          itemId: 'extension:builtin:macos-system:open-accessibility-settings',
          actionId: 'run',
        }),
      });
      expect(openAccessibilitySettings.status).toBe(200);
      expect(await openAccessibilitySettings.json()).toEqual({
        ok: true,
        nativeRequest: {
          method: 'application.open',
          params: {
            path: 'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility',
          },
        },
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

      const resetSearchCache = await fetch(`${server.url}/api/search/cache`, {
        method: 'DELETE',
        headers: { 'x-commander-session': server.token },
      });
      expect(resetSearchCache.status).toBe(200);

      const streamedSearch = await fetch(`${server.url}/api/search/stream?q=settings`, {
        headers: { 'x-commander-session': server.token },
      });
      expect(streamedSearch.status).toBe(200);
      expect(streamedSearch.headers.get('content-type')).toContain('application/x-ndjson');
      const streamedEvents = (await streamedSearch.text())
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { phase: string; complete: boolean; hits: unknown[] });
      expect(streamedEvents).toMatchObject([
        { phase: 'catalog', complete: false, hits: expect.any(Array) },
        { phase: 'complete', complete: true, hits: expect.any(Array) },
      ]);

      await vi.waitFor(async () => {
        const status = await fetch(`${server!.url}/api/search/cache/status`, {
          headers: { 'x-commander-session': server!.token },
        });
        expect(await status.json()).toMatchObject({
          enabled: true,
          entryCount: 1,
          effectiveDirectory: expect.stringContaining('search-results-v1'),
        });
      });
      const cachedSearch = await fetch(`${server.url}/api/search/stream?q=settings`, {
        headers: { 'x-commander-session': server.token },
      });
      const cachedEvents = (await cachedSearch.text())
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { phase: string; cached: boolean });
      expect(cachedEvents[0]).toMatchObject({ phase: 'cache', cached: true });

      const clearedCache = await fetch(`${server.url}/api/search/cache`, {
        method: 'DELETE',
        headers: { 'x-commander-session': server.token },
      });
      expect(clearedCache.status).toBe(200);
      expect(await clearedCache.json()).toMatchObject({
        ok: true,
        status: { entryCount: 0, sizeBytes: 0 },
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
