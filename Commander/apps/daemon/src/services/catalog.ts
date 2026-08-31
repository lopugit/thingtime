import {
  extensionCommandItemId,
  type CommanderExtension,
  type Platform,
  type SearchItem,
} from '@commander/protocol';
import { macosSystemExtension, macosSystemExtensionId } from './macosSystem.js';

export const closeCommanderCommandName = 'close-commander';
export const closeCommanderWindowCommandName = 'close-commander-window';
export const openCommanderCommandName = 'open-commander';
export const indexNowCommandName = 'index-now';
export const indexApplicationsCommandName = 'index-applications';
export const indexCommandsCommandName = 'index-commands';
export const indexFilesCommandName = 'index-files';
export const indexDirectoriesCommandName = 'index-directories';
export const searchEmojiSymbolsCommandName = 'search-emoji-symbols';

export const commanderExtension: CommanderExtension = {
  id: 'builtin:commander',
  name: 'commander',
  title: 'Commander',
  description: 'Commands for controlling Commander itself.',
  version: '0.3.0',
  author: 'Thingtime',
  source: 'builtin',
  enabled: true,
  compatibility: 'native',
  commands: [
    {
      name: closeCommanderCommandName,
      title: 'Close Commander',
      description: 'Quit the Commander app and stop its background service.',
      mode: 'no-view',
      keywords: ['close', 'exit', 'quit', 'terminate', 'shutdown', 'stop'],
      disabled: false,
    },
    {
      name: closeCommanderWindowCommandName,
      title: 'Close Commander Window',
      description: 'Hide the floating Commander window without quitting the app.',
      mode: 'no-view',
      keywords: ['close window', 'hide window', 'dismiss', 'hide', 'launcher', 'search window'],
      disabled: false,
    },
    {
      name: openCommanderCommandName,
      title: 'Open Commander',
      description: 'Open and focus the floating Commander window.',
      mode: 'no-view',
      keywords: ['open', 'launch', 'show', 'focus', 'commander window', 'search'],
      disabled: false,
    },
    {
      name: indexNowCommandName,
      title: 'Index Now',
      description: 'Refresh applications, commands, files, and directories in Commander.',
      mode: 'no-view',
      keywords: ['reindex', 'refresh index', 'scan now', 'index everything', 'update search'],
      disabled: false,
    },
    {
      name: indexApplicationsCommandName,
      title: 'Index Apps Now',
      description: 'Refresh the installed application index immediately.',
      mode: 'no-view',
      keywords: ['reindex apps', 'applications', 'refresh apps', 'scan applications', 'new app'],
      disabled: false,
    },
    {
      name: indexCommandsCommandName,
      title: 'Index Commands Now',
      description: 'Rebuild Commander’s built-in and extension command catalog.',
      mode: 'no-view',
      keywords: ['reindex commands', 'extensions', 'refresh commands', 'command catalog'],
      disabled: false,
    },
    {
      name: indexFilesCommandName,
      title: 'Index Files Now',
      description: 'Refresh file metadata in the local Rust search index.',
      mode: 'no-view',
      keywords: ['reindex files', 'filesystem', 'refresh files', 'scan files', 'file search'],
      disabled: false,
    },
    {
      name: indexDirectoriesCommandName,
      title: 'Index Directories Now',
      description: 'Refresh folder metadata in the local Rust search index.',
      mode: 'no-view',
      keywords: ['reindex folders', 'directories', 'refresh folders', 'scan folders', 'folder search'],
      disabled: false,
    },
  ],
};

export const emojiSymbolsExtension: CommanderExtension = {
  id: 'builtin:emoji-symbols',
  name: 'emoji-symbols',
  title: 'Emoji & Symbols',
  description: 'Search, copy, and paste emoji and Unicode symbols.',
  version: '0.1.0',
  author: 'Thingtime',
  icon: 'emoji',
  source: 'builtin',
  enabled: true,
  compatibility: 'native',
  commands: [
    {
      name: searchEmojiSymbolsCommandName,
      title: 'Search Emoji & Symbols',
      description:
        'Find emoji and symbols by name, meaning, or category, then paste them into the active app.',
      mode: 'view',
      keywords: [
        'emoji',
        'emojis',
        'symbol',
        'symbols',
        'unicode',
        'emoticon',
        'smiley',
        'character',
        'heart',
      ],
      disabled: false,
    },
  ],
};

export const calculatorExtension: CommanderExtension = {
  id: 'builtin:calculator',
  name: 'calculator',
  title: 'Calculator',
  description: 'Evaluate arithmetic expressions automatically as you type in Commander.',
  version: '0.1.0',
  author: 'Thingtime',
  icon: 'calculator',
  source: 'builtin',
  enabled: true,
  compatibility: 'native',
  commands: [],
};

export const builtinExtensions = [
  commanderExtension,
  emojiSymbolsExtension,
  calculatorExtension,
  macosSystemExtension,
] satisfies CommanderExtension[];

export function availableExtensions(
  installed: CommanderExtension[],
  platform: Platform,
): CommanderExtension[] {
  const builtinIDs = new Set(builtinExtensions.map((extension) => extension.id));
  const platformBuiltins = builtinExtensions.filter(
    (extension) => extension.id !== macosSystemExtensionId || platform === 'macos',
  );
  return [...platformBuiltins, ...installed.filter((extension) => !builtinIDs.has(extension.id))];
}

export const builtins: SearchItem[] = [
  {
    id: 'builtin:settings',
    title: 'Settings',
    subtitle: 'Commander Settings',
    kind: 'builtin',
    keywords: ['settings', 'preferences', 'configuration', 'general'],
    icon: 'settings',
    favourite: true,
    actions: [{ id: 'open-settings', title: 'Open Settings', shortcut: '⌘,' }],
  },
  {
    id: 'builtin:extensions',
    title: 'Extensions',
    subtitle: 'Manage installed and sideloaded extensions',
    kind: 'builtin',
    keywords: ['extensions', 'plugins', 'raycast', 'sideload'],
    icon: 'extensions',
    favourite: true,
    actions: [{ id: 'open-settings', title: 'Open Extension Settings', shortcut: '↵' }],
  },
  {
    id: 'builtin:store',
    title: 'Browse Raycast Extensions Store',
    subtitle: 'Discover extensions compatible with Commander',
    kind: 'builtin',
    keywords: ['store', 'extensions', 'install', 'raycast'],
    icon: 'store',
    favourite: false,
    actions: [{ id: 'open-store', title: 'Browse Store', shortcut: '↵' }],
  },
  {
    id: 'builtin:sideload',
    title: 'Sideload Extension',
    subtitle: 'Install a Raycast extension from a folder',
    kind: 'builtin',
    keywords: ['extension', 'folder', 'file', 'install', 'developer'],
    icon: 'sideload',
    favourite: false,
    actions: [{ id: 'sideload', title: 'Choose Extension Folder', shortcut: '↵' }],
  },
  {
    id: 'builtin:indexing',
    title: 'Search Settings',
    subtitle: 'Configure file roots, ignore rules, and refresh the search index',
    kind: 'builtin',
    keywords: ['search', 'index', 'indexing', 'files', 'folders', 'ignore', 'gitignore', 'regex', 'wildcard'],
    icon: 'search',
    favourite: false,
    actions: [{ id: 'open-settings', title: 'Open Search Settings', shortcut: '↵' }],
  },
  {
    id: 'builtin:activity',
    title: 'Commander Activity',
    subtitle: 'Monitor Commander and current Mac resource usage',
    kind: 'builtin',
    keywords: ['activity', 'monitor', 'cpu', 'gpu', 'memory', 'ram', 'disk', 'filesystem', 'usage'],
    icon: 'activity',
    favourite: false,
    actions: [{ id: 'open-settings', title: 'Open Activity Settings', shortcut: '↵' }],
  },
  {
    id: 'builtin:accounts',
    title: 'Thingtime Accounts',
    subtitle: 'Sign in, switch account, and sync settings',
    kind: 'builtin',
    keywords: ['account', 'login', 'thingtime', 'sso', 'cloud', 'sync'],
    icon: 'sparkles',
    favourite: false,
    actions: [{ id: 'open-settings', title: 'Open Account Settings', shortcut: '↵' }],
  },
];

export function extensionItems(extensions: CommanderExtension[]): SearchItem[] {
  return extensions.flatMap((extension) =>
    extension.commands
      .filter((command) => !command.disabled)
      .map((command) => ({
        id: extensionCommandItemId(extension.id, command.name),
        title: command.title,
        subtitle: extension.title,
        kind: extension.id === macosSystemExtensionId ? ('system' as const) : ('extension' as const),
        keywords: [extension.name, extension.title, ...command.keywords],
        icon: extension.icon ?? 'extensions',
        favourite: false,
        extensionId: extension.id,
        commandName: command.name,
        // System helper apps can coincidentally contain “emoji” in their
        // bundle name. A direct user-facing built-in command should win that
        // exact intent without preventing a learned preference from later
        // promoting a different result.
        ...(extension.id === emojiSymbolsExtension.id && command.name === searchEmojiSymbolsCommandName
          ? { preferenceScore: 25_000 }
          : {}),
        actions: [{ id: 'run', title: `Run ${command.title}`, shortcut: '↵' }],
      })),
  );
}
