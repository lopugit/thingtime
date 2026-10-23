import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { SearchItem } from '@commander/protocol';
import { pathActions } from './pathActions.js';

const macApplicationDirectories = [
  '/Applications',
  '/Applications/Utilities',
  '/System/Applications',
  '/System/Applications/Utilities',
  path.join(os.homedir(), 'Applications'),
];

// macOS app subscriptions commonly use one container directory below
// /Applications (for example /Applications/Setapp/CleanMyMac.app). Keep this
// deliberately bounded: Rust stops descending when it reaches an .app bundle,
// so this finds managed apps without walking their contents.
export const APPLICATION_DISCOVERY_MAX_DEPTH = 2;
const execFileAsync = promisify(execFile);

export function applicationDirectories(platform: 'macos' | 'windows' | 'linux'): string[] {
  if (platform === 'macos') return [...macApplicationDirectories];
  if (platform === 'windows')
    return [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA]
      .filter((value): value is string => Boolean(value))
      .map((value) => path.resolve(value));
  return ['/usr/share/applications', path.join(os.homedir(), '.local', 'share', 'applications')];
}

export async function discoverApplications(): Promise<SearchItem[]> {
  if (process.platform !== 'darwin') return [];
  // Spotlight can enumerate application bundles across every indexed volume
  // without recursively crawling the disk. The Rust indexer remains the
  // authoritative full-volume inventory; this is its fast startup/failure
  // fallback, and the direct scan covers a managed container Spotlight has
  // not indexed yet.
  const [spotlight, direct] = await Promise.all([
    discoverApplicationsWithSpotlight(),
    discoverApplicationsIn(macApplicationDirectories),
  ]);
  return deduplicateApplications([...spotlight, ...direct]);
}

/** A bounded immediate catalog for daemon startup; the Rust index fills in every volume asynchronously. */
export async function discoverApplicationsQuick(): Promise<SearchItem[]> {
  if (process.platform !== 'darwin') return [];
  return discoverApplicationsIn(macApplicationDirectories);
}

export async function discoverApplicationsIn(directories: readonly string[]): Promise<SearchItem[]> {
  const applications = await Promise.all(
    directories.map((directory) => readApplications(directory, APPLICATION_DISCOVERY_MAX_DEPTH)),
  );
  return deduplicateApplications(applications.flat());
}

async function discoverApplicationsWithSpotlight(): Promise<SearchItem[]> {
  try {
    const { stdout } = await execFileAsync(
      '/usr/bin/mdfind',
      ['kMDItemContentType == "com.apple.application-bundle"'],
      { maxBuffer: 8 * 1024 * 1024 },
    );
    return stdout
      .split(/\r?\n/u)
      .map((value) => value.trim())
      .filter((value) => path.isAbsolute(value) && value.toLowerCase().endsWith('.app'))
      .map((applicationPath) => applicationItem(applicationPath, path.basename(applicationPath)));
  } catch {
    return [];
  }
}

async function readApplications(directory: string, remainingDepth: number): Promise<SearchItem[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const applications: SearchItem[] = [];
    const nestedDirectories: string[] = [];
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory() && entry.name.toLowerCase().endsWith('.app')) {
        applications.push(applicationItem(entryPath, entry.name));
      } else if (entry.isDirectory() && remainingDepth > 1) {
        // Do not follow symlinks: an application scan should never escape its
        // known roots or recursively traverse another mounted volume.
        nestedDirectories.push(entryPath);
      }
    }
    const nested = await Promise.all(
      nestedDirectories.map((nestedDirectory) => readApplications(nestedDirectory, remainingDepth - 1)),
    );
    return [...applications, ...nested.flat()];
  } catch {
    return [];
  }
}

function applicationItem(applicationPath: string, fileName: string): SearchItem {
  const title = fileName.slice(0, -4);
  return {
    id: `app:${applicationPath}`,
    title,
    subtitle: applicationPath,
    kind: 'application' as const,
    keywords: ['app', 'application', title.toLowerCase()],
    icon: 'application',
    path: applicationPath,
    favourite: false,
    actions: pathActions('application'),
  } satisfies SearchItem;
}

function deduplicateApplications(items: SearchItem[]): SearchItem[] {
  const paths = new Set<string>();
  return items.filter((item) => {
    const key = item.path ?? item.id;
    if (paths.has(key)) return false;
    paths.add(key);
    return true;
  });
}
