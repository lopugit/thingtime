import { mkdir, mkdtemp, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { StoreExtension } from '@commander/protocol';
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

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

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
const EXTENSION_SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/;

export async function browseRaycastStore(query: string): Promise<StoreExtension[]> {
  const value = query.trim().toLocaleLowerCase();
  const items = await latestStoreItems().catch(() => []);
  const matches = value
    ? items.filter((item) =>
        `${item.title} ${item.description} ${item.author} ${item.name}`.toLocaleLowerCase().includes(value),
      )
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
  const fetchImpl = options.fetch ?? fetch;
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
  const sourcePrefix = `extensions/${extensionName}`;
  const queue = [sourcePrefix];
  let fileCount = 0;
  let totalBytes = 0;
  let visitedDirectories = 0;
  try {
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
        const remainingBytes = maxBytes - totalBytes;
        const body = await readBoundedResponse(download, remainingBytes);
        totalBytes += body.byteLength;
        const target = path.resolve(temporary, ...relative.split('/'));
        if (!target.startsWith(`${temporary}${path.sep}`))
          throw new Error(`Unsafe source path: ${sourcePath}`);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, body, { flag: 'wx' });
      }
    }

    const report = await inspectRaycastExtensionSource(temporary);
    await rename(temporary, destination);
    return {
      path: destination,
      files: fileCount,
      bytes: totalBytes,
      sourceUrl: `https://github.com/raycast/extensions/tree/main/extensions/${extensionName}`,
      report: relocateReport(report, temporary, destination),
    };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
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
