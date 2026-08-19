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
  SearchItem,
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
import { PersistentStore } from './services/persistence.js';
import { macosSystemExtension, macosSystemShortcutURL } from './services/macosSystem.js';
import { preferenceValuesForCommand, RaycastLocalService } from './services/raycastLocal.js';
import { SearchService } from './services/search.js';
import { ThingtimeService } from './services/thingtime.js';

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
  const platform = options.platform ?? currentPlatform();
  const search = new SearchService(options.rustBinary);
  const extensions = new RaycastExtensionRuntime();
  const thingtime = new ThingtimeService();
  const localRaycast = new RaycastLocalService();
  const credentials = new Map<string, string>();
  let pendingCredential: { accountId: string; token: string; createdAt: number } | null = null;
  let applications: SearchItem[] = [];

  const refreshCatalog = () => {
    const state = store.snapshot();
    search.setItems([
      ...builtins,
      ...extensionItems(availableExtensions(state.extensions, platform)),
      ...applications,
    ]);
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
    if (request.method === 'GET' && url.pathname === '/api/search') {
      const query = url.searchParams.get('q') ?? '';
      const indexedItems = await indexing.queryItems(query);
      let hits = await search.search(query, 30, indexedItems);
      if (
        !query.trim() &&
        state.settings.windowMode === 'compact' &&
        state.settings.showFavouritesInCompactMode
      ) {
        hits = hits.filter((hit) => hit.favourite);
      }
      return json(response, 200, { hits });
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
      const { itemId, actionId } = await readBody<{ itemId: string; actionId: string }>(request);
      const item =
        search.items().find((candidate) => candidate.id === itemId) ?? (await indexing.resolveItem(itemId));
      if (!item) return json(response, 404, { error: 'Search item not found' });
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
                      ? 'advanced'
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
      const start = thingtime.beginLogin(state.settings, `${baseUrl}/oauth/callback`);
      return json(response, 200, { authorizeUrl: start.authorizeUrl, state: start.state });
    }
    if (request.method === 'PUT' && url.pathname === '/api/accounts/active') {
      const { id } = await readBody<{ id: string }>(request);
      return json(response, 200, { account: await store.setActiveAccount(id) });
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
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');
    if (error) {
      if (!state || !thingtime.cancel(state))
        return html(
          response,
          400,
          callbackPage(
            'Thingtime sign-in failed',
            'The authorization response was not requested by Commander.',
            false,
          ),
        );
      return html(response, 400, callbackPage('Thingtime sign-in cancelled', error, false));
    }
    if (!code || !state)
      return html(
        response,
        400,
        callbackPage('Thingtime sign-in failed', 'Missing authorization response', false),
      );
    const snapshot = store.snapshot();
    const result = await thingtime.exchange(snapshot.settings, state, code, `${baseUrl}/oauth/callback`);
    credentials.set(result.account.id, result.token);
    pendingCredential = { accountId: result.account.id, token: result.token, createdAt: Date.now() };
    await store.upsertAccount(result.account);
    return html(
      response,
      200,
      callbackPage(
        'You’re signed in',
        `Commander connected @${result.account.username}. You can close this tab.`,
        true,
      ),
    );
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
