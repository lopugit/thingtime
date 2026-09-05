import { createReadStream } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type {
  BootstrapResponse,
  CommanderAccount,
  CommanderExtension,
  CommanderSettings,
  IndexScope,
  NativeRequest,
  RecentSearchCommand,
  SearchHit,
  SearchItem,
  SearchStreamEvent,
  StoreExtension,
} from '@commander/protocol';
import { PROTOCOL_VERSION } from '@commander/protocol';
import {
  browseRaycastStore,
  materializePublicRaycastExtensionSource,
  prepareRaycastExtensionSource,
  prepareRaycastSideload,
  RaycastExtensionRuntime,
} from '@commander/raycast-compat';
import { commanderCacheDirectory, currentPlatform, type RuntimeOptions } from './services/config.js';
import {
  availableExtensions,
  builtins,
  closeCommanderCommandName,
  closeCommanderWindowCommandName,
  commanderExtension,
  emojiSymbolsExtension,
  extensionItems,
  indexApplicationsCommandName,
  indexCommandsCommandName,
  indexDirectoriesCommandName,
  indexFilesCommandName,
  indexNowCommandName,
  openCommanderCommandName,
  searchEmojiSymbolsCommandName,
} from './services/catalog.js';
import { IndexingService } from './services/indexing.js';
import { PersistentStore, type AccountEnvironmentUpdate } from './services/persistence.js';
import { macosSystemExtension, macosSystemShortcutURL } from './services/macosSystem.js';
import { preferenceValuesForCommand, RaycastLocalService } from './services/raycastLocal.js';
import { SearchService } from './services/search.js';
import { SearchResultCache } from './services/searchCache.js';
import { ThingtimeService } from './services/thingtime.js';
import { CALCULATOR_RESULT_ITEM_ID, calculatorSearchHit } from './services/calculator.js';

// Bump these whenever ranking or result-presentation semantics change so an
// installed Commander never replays results produced by an older search core.
const SEARCH_CONTEXT_VERSION = 4;
const SEARCH_CACHE_KEY_VERSION = 3;
const COMMANDER_NATIVE_REDIRECT_URI = 'com.thingtime.commander://oauth/callback';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

export interface CommanderServer {
  port: number;
  token: string;
  nativeToken: string;
  url: string;
  close(): Promise<void>;
}

export async function createCommanderServer(options: RuntimeOptions): Promise<CommanderServer> {
  const token = randomBytes(32).toString('base64url');
  const nativeToken = randomBytes(32).toString('base64url');
  const store = new PersistentStore();
  await store.load();
  const indexingSettingsMigrated = store.consumeIndexingMigration();
  const platform = options.platform ?? currentPlatform();
  const search = new SearchService(options.rustBinary);
  const searchCache = new SearchResultCache(store.snapshot().settings.searchCache);
  const searchCacheWarm = searchCache.warm().catch(() => undefined);
  const extensions = new RaycastExtensionRuntime();
  const thingtime = new ThingtimeService();
  const localRaycast = new RaycastLocalService();
  const credentials = new Map<string, string>();
  let pendingCredential: { accountId: string; token: string; createdAt: number } | null = null;
  let applications: SearchItem[] = [];
  let searchRevision = 0;

  const refreshCatalog = () => {
    const state = store.snapshot();
    search.setItems([
      ...builtins,
      ...extensionItems(availableExtensions(state.extensions, platform)),
      ...applications,
    ]);
    searchRevision += 1;
  };
  const indexing = new IndexingService({
    binaryPath: options.indexerBinary,
    platform,
    settings: store.snapshot().settings,
    callbacks: {
      applications(items) {
        applications = items;
        refreshCatalog();
      },
      commands() {
        refreshCatalog();
        return search.items().filter((item) => item.kind !== 'application').length;
      },
    },
  });
  applications = await indexing.initialize();
  refreshCatalog();
  await searchCacheWarm;
  if (indexingSettingsMigrated) void indexing.start('all').catch(() => undefined);

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', `http://${options.host}`);
      if (request.method === 'GET' && url.pathname === '/healthz') {
        return json(response, 200, { ok: true, protocolVersion: PROTOCOL_VERSION, pid: process.pid });
      }
      if (url.pathname.startsWith('/api/native/')) {
        if (!safeToken(request.headers['x-commander-native'], nativeToken))
          return json(response, 401, { error: 'Unauthorized' });
        return await routeNativeApi(request, response, url);
      }
      if (url.pathname.startsWith('/api/')) {
        if (!safeToken(request.headers['x-commander-session'], token))
          return json(response, 401, { error: 'Unauthorized' });
        return await routeApi(request, response, url);
      }
      if (url.pathname === '/oauth/callback') return await oauthCallback(response, url);
      return await serveStatic(response, options.uiPath, url.pathname);
    } catch (error) {
      return json(response, 500, { error: error instanceof Error ? error.message : 'Internal error' });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Commander daemon did not bind a TCP port');
  const baseUrl = `http://${options.host}:${address.port}`;

  const searchNow = async (
    query: string,
    onUpdate?: (event: SearchStreamEvent) => void,
  ): Promise<SearchHit[]> => {
    const snapshot = store.snapshot();
    // A catalog refresh is a single atomic swap. Every request deliberately
    // uses one snapshot, so a query in progress never combines an old catalog
    // preview with a newer final result; the next keystroke/request gets the
    // latest committed catalog without waiting for indexing.
    const catalog = search.snapshot();
    const catalogRevision = searchRevision;
    const calculation = calculatorSearchHit(query, snapshot.settings.calculator);
    const present = (hits: SearchHit[]) =>
      [
        ...(calculation ? [calculation] : []),
        ...hits.filter((hit) => hit.id !== CALCULATOR_RESULT_ITEM_ID && hit.kind !== 'calculator'),
      ].slice(0, 30);
    const normalizedQuery = query.trim().toLowerCase();
    const contextKey = JSON.stringify({
      version: SEARCH_CONTEXT_VERSION,
      order: snapshot.settings.resultCategoryOrder,
      windowMode: snapshot.settings.windowMode,
      favourites: snapshot.settings.showFavouritesInCompactMode,
      revision: catalogRevision,
    });
    const key = JSON.stringify({
      version: SEARCH_CACHE_KEY_VERSION,
      query: normalizedQuery,
      order: snapshot.settings.resultCategoryOrder,
      windowMode: snapshot.settings.windowMode,
      favourites: snapshot.settings.showFavouritesInCompactMode,
      revision: catalogRevision,
    });
    const indexedItemsPromise = indexing.queryItems(query);
    const cached = await searchCache.lookup({ key, contextKey, query: normalizedQuery });
    const preferenceScores = store.preferenceScores(query);
    let emittedCachedResults = false;
    if (calculation) {
      onUpdate?.({
        type: 'results',
        phase: 'catalog',
        hits: [calculation],
        complete: false,
        cached: false,
      });
    }
    if (cached?.exact && cached.hits.length) {
      const cachedHits = present(cached.hits);
      onUpdate?.({
        type: 'results',
        phase: 'cache',
        hits: cachedHits,
        complete: false,
        cached: true,
      });
      emittedCachedResults = true;
    } else if (cached?.indexedItems.length) {
      let previewHits = await search.searchSnapshot(
        query,
        catalog,
        30,
        cached.indexedItems,
        preferenceScores,
        snapshot.settings.resultCategoryOrder,
      );
      previewHits = compactFavourites(previewHits, query, snapshot.settings);
      const presentedPreviewHits = present(previewHits);
      if (presentedPreviewHits.length) {
        onUpdate?.({
          type: 'results',
          phase: 'cache',
          hits: presentedPreviewHits,
          complete: false,
          cached: true,
        });
        emittedCachedResults = true;
      }
    }

    if (!emittedCachedResults) {
      let catalogHits = await search.searchSnapshot(
        query,
        catalog,
        30,
        [],
        preferenceScores,
        snapshot.settings.resultCategoryOrder,
      );
      catalogHits = compactFavourites(catalogHits, query, snapshot.settings);
      onUpdate?.({
        type: 'results',
        phase: 'catalog',
        hits: present(catalogHits),
        complete: false,
        cached: false,
      });
    }

    const indexedItems = await indexedItemsPromise;
    let hits = await search.searchSnapshot(
      query,
      catalog,
      30,
      indexedItems,
      preferenceScores,
      snapshot.settings.resultCategoryOrder,
    );
    hits = compactFavourites(hits, query, snapshot.settings);
    const presentedHits = present(hits);
    onUpdate?.({
      type: 'results',
      phase: indexedItems.length ? 'filesystem' : 'complete',
      hits: presentedHits,
      complete: true,
      cached: false,
    });
    // Never let a just-finished, older snapshot overwrite cache state after a
    // live catalog update. Its response is still valid for its caller.
    if (catalogRevision === searchRevision) {
      void searchCache
        .put({ key, contextKey, query: normalizedQuery, hits, indexedItems })
        .catch(() => undefined);
    }
    return presentedHits;
  };

  async function routeApi(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    const state = store.snapshot();
    const extensionsForState = availableExtensions(state.extensions, platform);
    if (request.method === 'GET' && url.pathname === '/api/bootstrap') {
      const body: BootstrapResponse = {
        protocolVersion: PROTOCOL_VERSION,
        platform,
        settings: state.settings,
        accounts: state.accounts,
        extensions: extensionsForState,
        recentSearches: state.recentSearches,
        capabilities: {
          nativeBridge: true,
          globalHotkey: platform === 'macos',
          secureCredentialStore: true,
          openAtLogin: platform === 'macos',
          sideloadPicker: true,
          filesystemIndex: Boolean(options.indexerBinary),
        },
      };
      return json(response, 200, body);
    }
    if (request.method === 'GET' && url.pathname === '/api/activity/network') {
      return json(response, 200, await thingtime.networkProbe(state.settings));
    }
    if (request.method === 'POST' && url.pathname === '/api/activity/network/speed') {
      return json(response, 200, await thingtime.networkProbe(state.settings, true));
    }
    if (request.method === 'GET' && url.pathname === '/api/search') {
      const query = url.searchParams.get('q') ?? '';
      return json(response, 200, { hits: await searchNow(query) });
    }
    if (request.method === 'GET' && url.pathname === '/api/search/stream') {
      const query = url.searchParams.get('q') ?? '';
      response.writeHead(200, {
        'content-type': 'application/x-ndjson; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
      });
      try {
        await searchNow(query, (event) => {
          if (!response.destroyed) response.write(`${JSON.stringify(event)}\n`);
        });
      } catch (error) {
        if (!response.destroyed)
          response.write(
            `${JSON.stringify({ error: error instanceof Error ? error.message : 'Search failed' })}\n`,
          );
      }
      if (!response.destroyed) response.end();
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/search/cache/status')
      return json(response, 200, await searchCache.status());
    if (request.method === 'DELETE' && url.pathname === '/api/search/cache') {
      await searchCache.clear();
      return json(response, 200, { ok: true, status: await searchCache.status() });
    }
    if (request.method === 'GET' && url.pathname === '/api/index/status')
      return json(response, 200, await indexing.status());
    if (request.method === 'POST' && url.pathname === '/api/index') {
      const { scope } = await readBody<{ scope?: IndexScope }>(request);
      if (!scope || !isIndexScope(scope))
        return json(response, 400, { error: 'A valid index scope is required' });
      void indexing.start(scope).catch(() => undefined);
      return json(response, 202, { ok: true, scope, status: await indexing.status() });
    }
    if (request.method === 'POST' && url.pathname === '/api/history') {
      const { query, command } = await readBody<{ query?: string; command?: RecentSearchCommand }>(request);
      if (typeof query !== 'string' || !query.trim())
        return json(response, 400, { error: 'query is required' });
      return json(response, 200, { recentSearches: await store.addRecentSearch(query, command) });
    }
    if (request.method === 'PUT' && url.pathname === '/api/settings') {
      const settings = await store.setSettings(await readBody<CommanderSettings>(request));
      indexing.updateSettings(settings);
      searchCache.updateSettings(settings.searchCache);
      searchRevision += 1;
      return json(response, 200, { settings });
    }
    if (request.method === 'GET' && url.pathname === '/api/extensions')
      return json(response, 200, { extensions: extensionsForState });
    if (request.method === 'GET' && url.pathname === '/api/extensions/raycast') {
      return json(response, 200, await localRaycast.list(extensionsForState, state.extensionPreferences));
    }
    if (request.method === 'POST' && url.pathname === '/api/extensions/raycast/add') {
      const { name, installationId } = await readBody<{ name?: string; installationId?: string }>(request);
      if (!name || !installationId)
        return json(response, 400, { error: 'name and installationId are required' });
      const installation = await localRaycast.requireInstallation(name, installationId);
      if (installation.development)
        return json(response, 409, {
          error:
            'Development extensions keep their source outside Raycast; choose Sideload to add that folder.',
        });
      if (extensionsForState.some((extension) => extension.name === name))
        return json(response, 409, {
          error: 'This extension is already installed in Commander; sync it instead.',
        });
      const destinationRoot = path.join(commanderCacheDirectory(), 'raycast-imports');
      const existingPath = path.join(destinationRoot, name);
      let prepared: Awaited<ReturnType<typeof prepareRaycastExtensionSource>>;
      try {
        await access(existingPath);
        prepared = await prepareRaycastExtensionSource(existingPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        const materialized = await materializePublicRaycastExtensionSource(name, destinationRoot);
        prepared = { report: materialized.report, build: { attempted: false } };
      }
      const extension: CommanderExtension = { ...prepared.report.extension, source: 'store' };
      const sync = await localRaycast.syncPreferences(extension, installation);
      await store.upsertExtension(extension);
      await store.upsertExtensionPreferences(sync.state);
      refreshCatalog();
      return json(response, 200, {
        extension,
        preparation: preparationSummary(prepared),
        sync: sync.summary,
      });
    }
    if (request.method === 'POST' && url.pathname === '/api/extensions/raycast/sync') {
      const { name, installationId } = await readBody<{ name?: string; installationId?: string }>(request);
      if (!name || !installationId)
        return json(response, 400, { error: 'name and installationId are required' });
      const installation = await localRaycast.requireInstallation(name, installationId);
      const extension = extensionsForState.find((candidate) => candidate.name === name);
      if (!extension)
        return json(response, 404, {
          error: 'Install this Raycast extension in Commander before syncing it.',
        });
      const sync = await localRaycast.syncPreferences(extension, installation);
      await store.upsertExtensionPreferences(sync.state);
      return json(response, 200, { extension, sync: sync.summary });
    }
    if (request.method === 'POST' && url.pathname === '/api/extensions/sideload') {
      const { path: extensionPath, allowUntrustedBuildScripts = false } = await readBody<{
        path?: string;
        allowUntrustedBuildScripts?: boolean;
      }>(request);
      if (!extensionPath) return json(response, 400, { error: 'path is required' });
      const prepared = await prepareRaycastSideload(extensionPath, {
        destinationRoot: path.join(commanderCacheDirectory(), 'extensions'),
        build: allowUntrustedBuildScripts,
        allowUntrustedBuildScripts,
        buildTimeoutMs: 120_000,
      });
      const extension = prepared.report.extension;
      await store.upsertExtension(extension);
      refreshCatalog();
      return json(response, 200, {
        extension,
        preparation: {
          source: prepared.source,
          readyNoViewCommands: prepared.report.readyNoViewCommands,
          diagnostics: prepared.report.diagnostics,
          build: prepared.build,
        },
      });
    }
    if (request.method === 'GET' && url.pathname === '/api/extensions/store') {
      const current = new Set(extensionsForState.map((extension) => extension.name));
      const catalog = await browseRaycastStore(url.searchParams.get('q') ?? '');
      return json(response, 200, {
        extensions: catalog.map((extension) => ({ ...extension, installed: current.has(extension.name) })),
      });
    }
    if (request.method === 'POST' && url.pathname === '/api/extensions/store/install') {
      const candidate = await readBody<StoreExtension>(request);
      if (!candidate.repositoryUrl)
        return json(response, 409, {
          error: 'This store entry opens in the browser. Clone its repository, then use Sideload.',
        });
      return json(response, 409, {
        error:
          'Store discovery is live; one-click source installation is not exposed by the Raycast Store. Open it, clone the extension, then use Sideload.',
      });
    }
    if (request.method === 'POST' && url.pathname === '/api/execute') {
      const {
        itemId,
        actionId,
        query = '',
      } = await readBody<{
        itemId: string;
        actionId: string;
        query?: string;
      }>(request);
      const executionQuery = typeof query === 'string' ? query : '';
      if (itemId === CALCULATOR_RESULT_ITEM_ID) {
        const calculationHit = calculatorSearchHit(executionQuery, state.settings.calculator);
        if (!calculationHit?.calculation)
          return json(response, 400, { error: 'The calculation is no longer valid' });
        const text =
          actionId === 'copy-result'
            ? calculationHit.calculation.result
            : actionId === 'copy-expression'
              ? calculationHit.calculation.expression
              : undefined;
        if (text === undefined) return json(response, 400, { error: 'Unknown calculator action' });
        await store.recordSearchSelection(executionQuery, itemId, actionId);
        searchRevision += 1;
        return json(response, 200, {
          ok: true,
          nativeRequest: { method: 'clipboard.write', params: { text } },
          dismissLauncher: true,
        });
      }
      const item =
        search.items().find((candidate) => candidate.id === itemId) ?? (await indexing.resolveItem(itemId));
      if (!item) return json(response, 404, { error: 'Search item not found' });
      await store.recordSearchSelection(executionQuery, itemId, actionId);
      searchRevision += 1;
      if (actionId === 'open-settings')
        return json(response, 200, {
          ok: true,
          nativeRequest: {
            method: 'settings.open',
            params: {
              tab:
                item.id === 'builtin:extensions'
                  ? 'extensions'
                  : item.id === 'builtin:accounts'
                    ? 'account'
                    : item.id === 'builtin:indexing'
                      ? 'search'
                      : item.id === 'builtin:activity'
                        ? 'activity'
                        : 'general',
            },
          } satisfies Omit<NativeRequest, 'id'>,
        });
      if (actionId === 'open-store')
        return json(response, 200, {
          ok: true,
          nativeRequest: { method: 'application.open', params: { path: 'https://www.raycast.com/store' } },
        });
      if (actionId === 'sideload')
        return json(response, 200, {
          ok: true,
          nativeRequest: { method: 'extension.choose' } satisfies Omit<NativeRequest, 'id'>,
        });
      if (actionId === 'show-in-finder' && item.path)
        return json(response, 200, {
          ok: true,
          nativeRequest: { method: 'filesystem.reveal', params: { path: item.path } },
        });
      if (actionId === 'copy-path' && item.path)
        return json(response, 200, {
          ok: true,
          nativeRequest: { method: 'clipboard.write', params: { text: item.path } },
        });
      if (actionId === 'copy-name' && item.path)
        return json(response, 200, {
          ok: true,
          nativeRequest: { method: 'clipboard.write', params: { text: path.basename(item.path) } },
        });
      if (actionId === 'copy-file' && item.path)
        return json(response, 200, {
          ok: true,
          nativeRequest: { method: 'filesystem.copy', params: { path: item.path } },
        });
      if (actionId === 'move-to-trash' && item.path)
        return json(response, 200, {
          ok: true,
          nativeRequest: { method: 'filesystem.trash', params: { path: item.path } },
        });
      if (actionId === 'delete' && item.path)
        return json(response, 200, {
          ok: true,
          nativeRequest: { method: 'filesystem.delete', params: { path: item.path } },
        });
      if ((item.kind === 'application' || item.kind === 'file' || item.kind === 'directory') && item.path)
        return json(response, 200, {
          ok: true,
          nativeRequest: { method: 'application.open', params: { path: item.path } },
        });
      if (item.extensionId && item.commandName) {
        const extension = extensionsForState.find((candidate) => candidate.id === item.extensionId);
        if (!extension) return json(response, 404, { error: 'Extension not found' });
        if (extension.id === commanderExtension.id && item.commandName === closeCommanderCommandName) {
          return json(response, 200, {
            ok: true,
            nativeRequest: { method: 'application.quit' } satisfies Omit<NativeRequest, 'id'>,
          });
        }
        if (extension.id === commanderExtension.id && item.commandName === closeCommanderWindowCommandName) {
          return json(response, 200, {
            ok: true,
            nativeRequest: { method: 'launcher.hide' } satisfies Omit<NativeRequest, 'id'>,
          });
        }
        if (extension.id === commanderExtension.id && item.commandName === openCommanderCommandName) {
          return json(response, 200, {
            ok: true,
            nativeRequest: { method: 'launcher.show' } satisfies Omit<NativeRequest, 'id'>,
          });
        }
        const indexScope = commanderIndexScope(item.commandName);
        if (extension.id === commanderExtension.id && indexScope) {
          void indexing.start(indexScope).catch(() => undefined);
          return json(response, 202, {
            ok: true,
            notice:
              indexScope === 'all'
                ? 'Indexing applications, commands, files, and directories…'
                : `Indexing ${indexScope}…`,
          });
        }
        if (extension.id === emojiSymbolsExtension.id && item.commandName === searchEmojiSymbolsCommandName) {
          return json(response, 200, { ok: true, view: { id: 'emoji-symbols' } });
        }
        if (extension.id === macosSystemExtension.id) {
          const settingsURL = macosSystemShortcutURL(item.commandName);
          if (!settingsURL)
            return json(response, 404, { error: 'macOS System Settings destination not found' });
          return json(response, 200, {
            ok: true,
            nativeRequest: {
              method: 'application.open',
              params: { path: settingsURL },
            } satisfies Omit<NativeRequest, 'id'>,
          });
        }
        if (extension.source === 'builtin')
          return json(response, 409, { error: 'This built-in command is not available' });
        await extensions.execute(extension, item.commandName, {
          preferences: preferenceValuesForCommand(store.extensionPreferences(extension.id), item.commandName),
        });
        return json(response, 200, { ok: true });
      }
      return json(response, 200, { ok: true });
    }
    if (request.method === 'POST' && url.pathname === '/api/accounts/login') {
      const start = thingtime.beginLogin(state.settings, COMMANDER_NATIVE_REDIRECT_URI);
      return json(response, 200, { authorizeUrl: start.authorizeUrl, state: start.state });
    }
    if (request.method === 'PUT' && url.pathname === '/api/accounts/active') {
      const { id } = await readBody<{ id: string }>(request);
      return json(response, 200, { account: await store.setActiveAccount(id) });
    }
    if (request.method === 'PUT' && url.pathname === '/api/accounts/environments') {
      const { environments } = await readBody<{ environments?: AccountEnvironmentUpdate[] }>(request);
      if (!Array.isArray(environments) || environments.length > 64)
        return json(response, 400, { error: 'A bounded list of account environments is required' });
      return json(response, 200, {
        accounts: await store.reconcileAccountEnvironments(environments),
      });
    }
    if (request.method === 'DELETE' && url.pathname.startsWith('/api/accounts/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/accounts/'.length));
      credentials.delete(id);
      await store.removeAccount(id);
      return json(response, 200, { ok: true });
    }
    if (request.method === 'PUT' && url.pathname === '/api/accounts/credentials') {
      const input = await readBody<{ accountId: string; token: string }>(request);
      if (!input.accountId || !input.token)
        return json(response, 400, { error: 'accountId and token are required' });
      credentials.set(input.accountId, input.token);
      return json(response, 200, { ok: true });
    }
    if (request.method === 'POST' && url.pathname === '/api/accounts/credentials/pending') {
      if (pendingCredential && Date.now() - pendingCredential.createdAt > 5 * 60_000)
        pendingCredential = null;
      return json(response, 200, {
        credential: pendingCredential ? { accountId: pendingCredential.accountId } : null,
      });
    }
    if (request.method === 'POST' && url.pathname === '/api/sync') {
      const active = state.settings.activeAccountId;
      const credential = active ? credentials.get(active) : undefined;
      if (!credential)
        return json(response, 401, { error: 'Unlock or sign in to the active Thingtime account first' });
      const settings = await thingtime.sync(credential, state.settings);
      await store.setSettings(settings, { markCloudChanges: false });
      return json(response, 200, { settings, syncedAt: new Date().toISOString() });
    }
    return json(response, 404, { error: 'Not found' });
  }

  async function routeNativeApi(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    if (request.method === 'POST' && url.pathname === '/api/native/oauth/callback') {
      const { callbackUrl } = await readBody<{ callbackUrl?: string }>(request);
      const callback = parseNativeOAuthCallback(callbackUrl);
      if (!callback)
        return json(response, 400, { error: 'Commander rejected an invalid native sign-in callback' });
      const result = await completeOAuthCallback(callback, COMMANDER_NATIVE_REDIRECT_URI);
      return json(response, 200, { ok: true, accountId: result.account.id });
    }
    if (request.method === 'POST' && url.pathname === '/api/native/credentials/claim') {
      const { accountId } = await readBody<{ accountId?: string }>(request);
      if (!accountId || pendingCredential?.accountId !== accountId)
        return json(response, 404, { error: 'No pending credential for this account' });
      return json(response, 200, { accountId: pendingCredential.accountId, token: pendingCredential.token });
    }
    if (request.method === 'POST' && url.pathname === '/api/native/credentials/ack') {
      const { accountId } = await readBody<{ accountId?: string }>(request);
      if (!accountId || pendingCredential?.accountId !== accountId)
        return json(response, 404, { error: 'No pending credential for this account' });
      pendingCredential = null;
      return json(response, 200, { ok: true });
    }
    if (request.method === 'PUT' && url.pathname === '/api/native/credentials') {
      const input = await readBody<{ accountId?: string; token?: string }>(request);
      if (!input.accountId || !input.token)
        return json(response, 400, { error: 'accountId and token are required' });
      credentials.set(input.accountId, input.token);
      return json(response, 200, { ok: true });
    }
    return json(response, 404, { error: 'Not found' });
  }

  async function oauthCallback(response: ServerResponse, url: URL): Promise<void> {
    try {
      const result = await completeOAuthCallback(url, `${baseUrl}/oauth/callback`);
      return html(
        response,
        200,
        callbackPage(
          'You’re signed in',
          `Commander connected @${result.account.username}. You can close this tab.`,
          true,
        ),
      );
    } catch (error) {
      return html(
        response,
        400,
        callbackPage(
          'Thingtime sign-in failed',
          error instanceof Error ? error.message : 'Commander could not complete sign-in.',
          false,
        ),
      );
    }
  }

  async function completeOAuthCallback(
    url: URL,
    redirectUri: string,
  ): Promise<{ account: CommanderAccount }> {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');
    if (error) {
      if (!state || !thingtime.cancel(state))
        throw new Error('The authorization response was not requested by Commander.');
      throw new Error(error);
    }
    if (!code || !state) throw new Error('Missing authorization response');
    const snapshot = store.snapshot();
    const result = await thingtime.exchange(snapshot.settings, state, code, redirectUri);
    credentials.set(result.account.id, result.token);
    pendingCredential = { accountId: result.account.id, token: result.token, createdAt: Date.now() };
    await store.upsertAccount(result.account);
    return { account: result.account };
  }

  return {
    port: address.port,
    token,
    nativeToken,
    url: baseUrl,
    close: async () => {
      search.close();
      await indexing.close();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

function preparationSummary(prepared: Awaited<ReturnType<typeof prepareRaycastExtensionSource>>) {
  return {
    source: 'folder' as const,
    readyNoViewCommands: prepared.report.readyNoViewCommands,
    diagnostics: prepared.report.diagnostics,
    build: prepared.build,
  };
}

function isIndexScope(value: string): value is IndexScope {
  return ['all', 'applications', 'commands', 'files', 'directories'].includes(value);
}

function commanderIndexScope(commandName: string): IndexScope | undefined {
  if (commandName === indexNowCommandName) return 'all';
  if (commandName === indexApplicationsCommandName) return 'applications';
  if (commandName === indexCommandsCommandName) return 'commands';
  if (commandName === indexFilesCommandName) return 'files';
  if (commandName === indexDirectoriesCommandName) return 'directories';
  return undefined;
}

function compactFavourites(hits: SearchHit[], query: string, settings: CommanderSettings): SearchHit[] {
  return !query.trim() && settings.windowMode === 'compact' && settings.showFavouritesInCompactMode
    ? hits.filter((hit) => hit.favourite)
    : hits;
}

async function readBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    length += buffer.length;
    if (length > 1_000_000) throw new Error('Request body is too large');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
}
function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  });
  response.end(JSON.stringify(value));
}
function html(response: ServerResponse, status: number, value: string): void {
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
  });
  response.end(value);
}
function callbackPage(title: string, message: string, success: boolean): string {
  return `<!doctype html><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font:16px system-ui;display:grid;place-content:center;min-height:100vh;margin:0;background:#f5f5f7;color:#18181b}.card{max-width:420px;padding:32px;border:1px solid #ddd;border-radius:18px;background:white;box-shadow:0 20px 70px #0002}.mark{width:44px;height:44px;display:grid;place-content:center;border-radius:12px;background:linear-gradient(135deg,#7657ff,#52c7ff);color:white;font-weight:700}h1{font-size:23px;margin:18px 0 8px}p{color:#666;line-height:1.5}</style><main class="card"><div class="mark">›_</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>${success ? '<script>setTimeout(()=>window.close(),1200)</script>' : ''}</main>`;
}
function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );
}
function safeToken(candidate: string | string[] | undefined, expected: string): boolean {
  if (typeof candidate !== 'string') return false;
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * The native URL handler is an untrusted browser entry point. Keep its parser
 * just as strict as the AppKit side before it reaches the pending PKCE state.
 */
function parseNativeOAuthCallback(value: unknown): URL | null {
  if (typeof value !== 'string' || !value || value.length > 8_192) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== 'com.thingtime.commander:' ||
    url.hostname !== 'oauth' ||
    url.pathname !== '/callback' ||
    url.port ||
    url.username ||
    url.password ||
    url.hash
  )
    return null;

  const allowed = new Set(['code', 'state', 'error', 'error_description']);
  const entries = [...url.searchParams.entries()];
  if (entries.some(([key]) => !allowed.has(key))) return null;
  const grouped = new Map<string, string[]>();
  for (const [key, item] of entries) grouped.set(key, [...(grouped.get(key) ?? []), item]);
  if ([...grouped.values()].some((items) => items.length !== 1)) return null;
  const state = grouped.get('state')?.[0];
  const code = grouped.get('code')?.[0];
  const error = grouped.get('error')?.[0];
  const description = grouped.get('error_description')?.[0];
  if (!state || state.length < 16 || state.length > 512) return null;
  if ((code === undefined) === (error === undefined)) return null;
  if (code !== undefined && (!code || code.length > 4096)) return null;
  if (error !== undefined && (!error || error.length > 1024)) return null;
  if (description !== undefined && description.length > 1024) return null;
  return url;
}
async function serveStatic(response: ServerResponse, root: string, pathname: string): Promise<void> {
  const rootReal = await realpath(root);
  const requested = pathname === '/' ? 'launcher.html' : pathname.replace(/^\/+/, '');
  let candidate = path.resolve(rootReal, requested);
  if (!candidate.startsWith(`${rootReal}${path.sep}`) && candidate !== rootReal)
    return json(response, 403, { error: 'Forbidden' });
  try {
    const details = await stat(candidate);
    if (details.isDirectory()) candidate = path.join(candidate, 'launcher.html');
    await access(candidate);
  } catch {
    candidate = path.join(rootReal, 'launcher.html');
  }
  response.writeHead(200, {
    'content-type': MIME[path.extname(candidate)] ?? 'application/octet-stream',
    'cache-control': candidate.endsWith('.html') ? 'no-store' : 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
    'content-security-policy':
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  });
  createReadStream(candidate).pipe(response);
}
