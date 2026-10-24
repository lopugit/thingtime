import { readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { SearchItem } from '@commander/protocol';
import { pathActions } from './pathActions.js';

const macApplicationDirectories = [
  '/Applications',
  '/Applications/Utilities',
  '/System/Applications',
  '/System/Applications/Utilities',
  path.join(os.homedir(), 'Applications'),
];

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
  const applications = await Promise.all(
    macApplicationDirectories.map((directory) => readApplications(directory)),
  );
  const seen = new Set<string>();
  return applications.flat().filter((item) => (seen.has(item.title) ? false : (seen.add(item.title), true)));
}

async function readApplications(directory: string): Promise<SearchItem[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.name.endsWith('.app'))
      .map((entry) => {
        const title = entry.name.slice(0, -4);
        return {
          id: `app:${path.join(directory, entry.name)}`,
          title,
          subtitle: path.join(directory, entry.name),
          kind: 'application' as const,
          keywords: ['app', 'application', title.toLowerCase()],
          icon: 'application',
          path: path.join(directory, entry.name),
          favourite: false,
          actions: pathActions('application'),
        } satisfies SearchItem;
      });
  } catch {
    return [];
  }
}
