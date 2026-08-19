import { execFile as execFileCallback } from 'node:child_process';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fuzzyTextScore, type StoreExtension } from '@commander/protocol';
import { inspectRaycastExtensionSource, type RaycastExtensionSourceReport } from './manifest.js';

const RAYCAST_STORE = 'https://www.raycast.com/store';
const RAYCAST_FEED = `${RAYCAST_STORE}/feed.json`;
const CACHE_TTL_MS = 15 * 60_000;

interface RaycastFeedItem {
  id?: unknown;
  url?: unknown;
  title?: unknown;
  summary?: unknown;
  image?: unknown;
  author?: { name?: unknown; url?: unknown };
}

let cache: { at: number; items: StoreExtension[] } | undefined;
const execFile = promisify(execFileCallback);

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type CheckoutLike = (extensionName: string, checkoutRoot: string) => Promise<string>;

interface GitHubContentItem {
  type?: unknown;
  name?: unknown;
  path?: unknown;
  size?: unknown;
  download_url?: unknown;
}

export interface MaterializePublicRaycastExtensionOptions {
  maxFiles?: number;
  maxBytes?: number;
  /** Injectable sparse checkout used by tests; production uses the official raycast/extensions repository. */
  checkout?: CheckoutLike;
  /** Injectable legacy Contents API transport used by deterministic request-boundary tests. */
  fetch?: FetchLike;
}

export interface MaterializedPublicRaycastExtension {
  path: string;
  files: number;
  bytes: number;
  sourceUrl: string;
  report: RaycastExtensionSourceReport;
}

const DEFAULT_MAX_SOURCE_FILES = 500;
const HARD_MAX_SOURCE_FILES = 1_000;
const DEFAULT_MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const HARD_MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const MAX_GITHUB_DIRECTORY_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_GIT_OUTPUT_BYTES = 512 * 1024;
const GIT_TIMEOUT_MS = 120_000;
const EXTENSION_SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/;

export async function browseRaycastStore(query: string): Promise<StoreExtension[]> {
  const value = query.trim().toLocaleLowerCase();
  const items = await latestStoreItems().catch(() => []);
  const matches = value
    ? items
        .map((item) => ({
          item,
          score: fuzzyTextScore(value, `${item.title} ${item.description} ${item.author} ${item.name}`),
        }))
        .filter(({ score }) => score >= 0)
        .sort((left, right) => right.score - left.score || left.item.title.localeCompare(right.item.title))
        .map(({ item }) => item)
    : items;
  const result = matches.slice(0, 40);
  if (value) result.push(searchAllEntry(query.trim()));
  return result.length ? result : [searchAllEntry(query.trim())];
}

async function latestStoreItems(): Promise<StoreExtension[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.items;
  const response = await fetch(RAYCAST_FEED, {
    headers: { accept: 'application/feed+json, application/json', 'user-agent': 'Thingtime-Commander/0.1' },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Raycast Store feed returned ${response.status}`);
  const feed = (await response.json()) as { items?: RaycastFeedItem[] };
  const items = (feed.items ?? []).map(storeItem).filter((item): item is StoreExtension => item !== null);
  cache = { at: Date.now(), items };
  return items;
}

function storeItem(value: RaycastFeedItem): StoreExtension | null {
  const url = typeof value.url === 'string' ? value.url : typeof value.id === 'string' ? value.id : '';
  const title = typeof value.title === 'string' ? value.title.trim() : '';
  if (!url.startsWith('https://www.raycast.com/') || !title) return null;
  const parts = new URL(url).pathname.split('/').filter(Boolean);
  const authorHandle = parts.length >= 2 ? parts.at(-2)! : 'raycast';
  const name = parts.at(-1) ?? title.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-');
  return {
    id: `raycast-store:${authorHandle}/${name}`,
    name,
    title,
    description: typeof value.summary === 'string' ? value.summary : 'Raycast Store extension',
    author: typeof value.author?.name === 'string' ? value.author.name : authorHandle,
    ...(typeof value.image === 'string' ? { iconUrl: value.image } : {}),
    repositoryUrl: `https://github.com/raycast/extensions/tree/main/extensions/${encodeURIComponent(name)}`,
    installUrl: url,
    categories: ['Latest'],
    installed: false,
  };
}

function searchAllEntry(query: string): StoreExtension {
  const url = query ? `${RAYCAST_STORE}?search=${encodeURIComponent(query)}` : RAYCAST_STORE;
  return {
    id: `raycast-store-search:${query || 'all'}`,
    name: 'raycast-store-search',
    title: query ? `Search the complete Store for “${query}”` : 'Browse the complete Raycast Store',
    description:
      'Open Raycast’s live web catalog. Commander’s embedded feed shows the 100 latest extensions.',
    author: 'Raycast',
    installUrl: url,
    categories: ['Store'],
    installed: false,
  };
}

/**
 * Download one public raycast/extensions source folder into a new cache directory.
 * The operation is bounded, rejects links/submodules and traversal, never overwrites,
 * and deliberately does not install dependencies or execute package scripts.
 */
export async function materializePublicRaycastExtensionSource(
  extensionName: string,
  destinationRoot: string,
  options: MaterializePublicRaycastExtensionOptions = {},
): Promise<MaterializedPublicRaycastExtension> {
  if (!EXTENSION_SLUG.test(extensionName))
    throw new Error('Raycast extension name must be a lowercase store slug');
  const maxFiles = boundedInteger(options.maxFiles, DEFAULT_MAX_SOURCE_FILES, 1, HARD_MAX_SOURCE_FILES);
  const maxBytes = boundedInteger(options.maxBytes, DEFAULT_MAX_SOURCE_BYTES, 1, HARD_MAX_SOURCE_BYTES);
  const requestedRoot = path.resolve(destinationRoot);
  await mkdir(requestedRoot, { recursive: true });
  const root = await realpath(requestedRoot);
  const destination = path.join(root, extensionName);
  try {
    await stat(destination);
    throw new Error(`Destination already exists: ${destination}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const temporary = await mkdtemp(path.join(root, `.${extensionName}-download-`));
  let checkoutRoot: string | undefined;
  try {
    let materialized: { fileCount: number; totalBytes: number };
    if (options.fetch) {
      materialized = await downloadFromGitHubContents(
        extensionName,
        temporary,
        options.fetch,
        maxFiles,
        maxBytes,
      );
    } else {
      checkoutRoot = await mkdtemp(path.join(root, `.${extensionName}-checkout-`));
      const source = await (options.checkout ?? sparseCheckoutPublicRaycastExtensionSource)(
        extensionName,
        checkoutRoot,
      );
      materialized = await copyBoundedSource(source, temporary, maxFiles, maxBytes);
    }

    const report = await inspectRaycastExtensionSource(temporary);
    await rename(temporary, destination);
    return {
      path: destination,
      files: materialized.fileCount,
      bytes: materialized.totalBytes,
      sourceUrl: `https://github.com/raycast/extensions/tree/main/extensions/${extensionName}`,
      report: relocateReport(report, temporary, destination),
    };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  } finally {
    if (checkoutRoot) await rm(checkoutRoot, { recursive: true, force: true });
  }
}

async function sparseCheckoutPublicRaycastExtensionSource(
  extensionName: string,
  checkoutRoot: string,
): Promise<string> {
  const repository = path.join(checkoutRoot, 'repository');
  const git = process.platform === 'darwin' ? '/usr/bin/git' : 'git';
  const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
  const environment = {
    ...process.env,
    GIT_CONFIG_GLOBAL: nullDevice,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_LFS_SKIP_SMUDGE: '1',
    GIT_TERMINAL_PROMPT: '0',
  };
  const sharedArguments = ['-c', 'credential.helper=', '-c', `core.hooksPath=${nullDevice}`];
  try {
    await execFile(
      git,
      [
        ...sharedArguments,
        'clone',
        '--depth=1',
        '--filter=blob:none',
        '--sparse',
        '--single-branch',
        '--branch',
        'main',
        '--no-tags',
        'https://github.com/raycast/extensions.git',
        repository,
      ],
      {
        env: environment,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: MAX_GIT_OUTPUT_BYTES,
      },
    );
    await execFile(
      git,
      ['-C', repository, ...sharedArguments, 'sparse-checkout', 'set', `extensions/${extensionName}`],
      {
        env: environment,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: MAX_GIT_OUTPUT_BYTES,
      },
    );
    const index = await execFile(
      git,
      ['-C', repository, ...sharedArguments, 'ls-files', '--stage', '--', `extensions/${extensionName}`],
      {
        encoding: 'utf8',
        env: environment,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: MAX_GIT_OUTPUT_BYTES,
      },
    );
    if (index.stdout.split('\n').some((line) => line.startsWith('160000 ')))
      throw new Error('Raycast public source submodules are not allowed');
  } catch {
    throw new Error('Could not download the public Raycast extension source with a bounded sparse checkout');
  }
  const source = path.join(repository, 'extensions', extensionName);
  const details = await lstat(source).catch(() => undefined);
  if (!details?.isDirectory()) throw new Error('Raycast public source did not contain that extension');
  return source;
}

async function copyBoundedSource(
  source: string,
  destination: string,
  maxFiles: number,
  maxBytes: number,
): Promise<{ fileCount: number; totalBytes: number }> {
  const sourceDetails = await lstat(source);
  if (!sourceDetails.isDirectory() || sourceDetails.isSymbolicLink())
    throw new Error('Raycast public source must be a real directory');
  const queue: Array<{ directory: string; relative: string }> = [{ directory: source, relative: '' }];
  const portablePaths = new Set<string>();
  let directoryCount = 0;
  let fileCount = 0;
  let totalBytes = 0;
  while (queue.length) {
    const current = queue.shift()!;
    directoryCount += 1;
    if (directoryCount > maxFiles)
      throw new Error(`Raycast source contains more than ${maxFiles} directories`);
    const entries = await readdir(current.directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!safeSourceComponent(entry.name)) throw new Error(`Unsafe Raycast source path: ${entry.name}`);
      const relative = current.relative ? path.join(current.relative, entry.name) : entry.name;
      const portable = relative.normalize('NFKC').replaceAll('\\', '/').toLocaleLowerCase('en-US');
      if (portablePaths.has(portable))
        throw new Error(`Raycast source contains a duplicate portable path: ${relative}`);
      portablePaths.add(portable);
      const input = path.join(current.directory, entry.name);
      const details = await lstat(input);
      if (details.isSymbolicLink()) throw new Error(`Raycast source links are not allowed: ${relative}`);
      if (details.isDirectory()) {
        queue.push({ directory: input, relative });
        continue;
      }
      if (!details.isFile()) throw new Error(`Unsupported Raycast source entry: ${relative}`);
      fileCount += 1;
      if (fileCount > maxFiles) throw new Error(`Raycast source contains more than ${maxFiles} files`);
      if (details.size < 0 || totalBytes + details.size > maxBytes)
        throw new Error(`Raycast source exceeds the ${maxBytes} byte limit`);
      const body = await readFile(input);
      if (totalBytes + body.byteLength > maxBytes)
        throw new Error(`Raycast source exceeds the ${maxBytes} byte limit`);
      totalBytes += body.byteLength;
      const target = path.join(destination, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, body, { flag: 'wx' });
    }
  }
  return { fileCount, totalBytes };
}

function safeSourceComponent(value: string): boolean {
  return Boolean(value && value !== '.' && value !== '..' && !value.includes('/') && !value.includes('\\'));
}

async function downloadFromGitHubContents(
  extensionName: string,
  temporary: string,
  fetchImpl: FetchLike,
  maxFiles: number,
  maxBytes: number,
): Promise<{ fileCount: number; totalBytes: number }> {
  const sourcePrefix = `extensions/${extensionName}`;
  const queue = [sourcePrefix];
  let fileCount = 0;
  let totalBytes = 0;
  let visitedDirectories = 0;
  while (queue.length) {
    const directory = queue.shift()!;
    visitedDirectories += 1;
    if (visitedDirectories > maxFiles)
      throw new Error(`Raycast source contains more than ${maxFiles} directories`);
    const apiUrl = new URL(`https://api.github.com/repos/raycast/extensions/contents/${directory}`);
    apiUrl.searchParams.set('ref', 'main');
    const response = await fetchImpl(apiUrl, {
      headers: githubHeaders(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`GitHub source listing returned ${response.status} for ${directory}`);
    const encodedListing = await readBoundedResponse(response, MAX_GITHUB_DIRECTORY_RESPONSE_BYTES);
    const listing = JSON.parse(encodedListing.toString('utf8')) as unknown;
    if (!Array.isArray(listing)) throw new Error(`GitHub source listing was not a directory: ${directory}`);
    for (const unknownItem of listing) {
      const item = unknownItem as GitHubContentItem;
      const type = typeof item.type === 'string' ? item.type : '';
      const sourcePath = typeof item.path === 'string' ? item.path : '';
      const relative = safeRelativeSourcePath(sourcePrefix, sourcePath);
      if (type === 'dir') {
        queue.push(sourcePath);
        continue;
      }
      if (type !== 'file')
        throw new Error(
          `Unsupported GitHub source entry type “${type || 'unknown'}” at ${sourcePath || directory}`,
        );
      fileCount += 1;
      if (fileCount > maxFiles) throw new Error(`Raycast source contains more than ${maxFiles} files`);
      const declaredSize = typeof item.size === 'number' && Number.isSafeInteger(item.size) ? item.size : 0;
      if (declaredSize < 0 || totalBytes + declaredSize > maxBytes)
        throw new Error(`Raycast source exceeds the ${maxBytes} byte limit`);
      const downloadUrl = validatedDownloadUrl(item.download_url);
      const download = await fetchImpl(downloadUrl, {
        headers: githubHeaders(),
        signal: AbortSignal.timeout(15_000),
      });
      if (!download.ok)
        throw new Error(`GitHub source download returned ${download.status} for ${sourcePath}`);
      const body = await readBoundedResponse(download, maxBytes - totalBytes);
      totalBytes += body.byteLength;
      const target = path.resolve(temporary, ...relative.split('/'));
      if (!target.startsWith(`${temporary}${path.sep}`)) throw new Error(`Unsafe source path: ${sourcePath}`);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, body, { flag: 'wx' });
    }
  }
  return { fileCount, totalBytes };
}

function relocateReport(
  report: RaycastExtensionSourceReport,
  previousRoot: string,
  nextRoot: string,
): RaycastExtensionSourceReport {
  const relocate = (value: string | undefined): string | undefined =>
    value?.startsWith(`${previousRoot}${path.sep}`)
      ? path.join(nextRoot, path.relative(previousRoot, value))
      : value;
  return {
    ...report,
    extensionPath: nextRoot,
    manifestPath: relocate(report.manifestPath) ?? path.join(nextRoot, 'package.json'),
    extension: { ...report.extension, path: nextRoot },
    commands: report.commands.map((command) => ({
      ...command,
      ...(command.sourceEntry ? { sourceEntry: relocate(command.sourceEntry)! } : {}),
      ...(command.buildEntry ? { buildEntry: relocate(command.buildEntry)! } : {}),
    })),
  };
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value)) throw new Error('Raycast source limit must be a safe integer');
  return Math.max(minimum, Math.min(value, maximum));
}

function githubHeaders(): Record<string, string> {
  return {
    accept: 'application/vnd.github+json',
    'user-agent': 'Thingtime-Commander/0.1',
    'x-github-api-version': '2022-11-28',
  };
}

function safeRelativeSourcePath(prefix: string, sourcePath: string): string {
  const relative = path.posix.relative(prefix, sourcePath);
  if (
    !sourcePath.startsWith(`${prefix}/`) ||
    !relative ||
    relative.startsWith('../') ||
    path.posix.isAbsolute(relative)
  ) {
    throw new Error(`Unsafe Raycast source path: ${sourcePath || '(missing)'}`);
  }
  return relative;
}

function validatedDownloadUrl(value: unknown): URL {
  if (typeof value !== 'string') throw new Error('GitHub source file is missing a download URL');
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'raw.githubusercontent.com' ||
    !url.pathname.startsWith('/raycast/extensions/')
  ) {
    throw new Error(`Refusing untrusted Raycast source download host: ${url.hostname}`);
  }
  return url;
}

async function readBoundedResponse(response: Response, limit: number): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit)
    throw new Error(`Remote response exceeds the ${limit} byte limit`);
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) throw new Error(`Remote response exceeds the ${limit} byte limit`);
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  return Buffer.concat(chunks, bytes);
}
