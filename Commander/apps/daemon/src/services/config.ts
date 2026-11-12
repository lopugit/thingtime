import os from 'node:os';
import path from 'node:path';
import type { Platform } from '@commander/protocol';

export function currentPlatform(): Platform {
  if (process.platform === 'darwin') return 'macos';
  if (process.platform === 'win32') return 'windows';
  return 'linux';
}

export function commanderDataDirectory(): string {
  if (process.env.COMMANDER_DATA_DIR) return path.resolve(process.env.COMMANDER_DATA_DIR);
  if (process.platform === 'darwin')
    return path.join(os.homedir(), 'Library', 'Application Support', 'Commander');
  if (process.platform === 'win32') return path.join(process.env.APPDATA ?? os.homedir(), 'Commander');
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'commander');
}

export function commanderCacheDirectory(): string {
  if (process.env.COMMANDER_CACHE_DIR) return path.resolve(process.env.COMMANDER_CACHE_DIR);
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Caches', 'Commander');
  if (process.platform === 'win32')
    return path.join(process.env.LOCALAPPDATA ?? os.tmpdir(), 'Commander', 'Cache');
  return path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache'), 'commander');
}

export interface RuntimeOptions {
  port: number;
  host: string;
  uiPath: string;
  rustBinary?: string;
  indexerBinary?: string;
  parentPid?: number;
  platform?: Platform;
}

export function parseRuntimeOptions(argv: string[]): RuntimeOptions {
  const value = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const uiPath = value('--ui') ?? process.env.COMMANDER_UI_PATH;
  if (!uiPath) throw new Error('Commander daemon requires --ui <desktop-ui/dist>');
  const parentPidValue = value('--parent-pid');
  const parentPid = parentPidValue === undefined ? undefined : Number(parentPidValue);
  if (parentPid !== undefined && (!Number.isSafeInteger(parentPid) || parentPid <= 1))
    throw new Error('Commander daemon requires --parent-pid to be a valid process ID');
  return {
    port: Number(value('--port') ?? process.env.COMMANDER_PORT ?? '0'),
    host: '127.0.0.1',
    uiPath: path.resolve(uiPath),
    ...(value('--rust-core') || process.env.COMMANDER_RUST_CORE
      ? { rustBinary: path.resolve(value('--rust-core') ?? process.env.COMMANDER_RUST_CORE!) }
      : {}),
    ...(value('--filesystem-indexer') || process.env.COMMANDER_FILESYSTEM_INDEXER
      ? {
          indexerBinary: path.resolve(
            value('--filesystem-indexer') ?? process.env.COMMANDER_FILESYSTEM_INDEXER!,
          ),
        }
      : {}),
    ...(parentPid === undefined ? {} : { parentPid }),
  };
}
