import { extensionCommandItemId, type CommanderExtension, type SearchItem } from '@commander/protocol';

export const closeCommanderCommandName = 'close-commander';
export const closeCommanderWindowCommandName = 'close-commander-window';
export const openCommanderCommandName = 'open-commander';
export const searchEmojiSymbolsCommandName = 'search-emoji-symbols';

export const commanderExtension: CommanderExtension = {
  id: 'builtin:commander',
  name: 'commander',
  title: 'Commander',
  description: 'Commands for controlling Commander itself.',
  version: '0.2.0',
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

export const builtinExtensions = [commanderExtension, emojiSymbolsExtension] satisfies CommanderExtension[];

export function availableExtensions(installed: CommanderExtension[]): CommanderExtension[] {
  const builtinIDs = new Set(builtinExtensions.map((extension) => extension.id));
  return [...builtinExtensions, ...installed.filter((extension) => !builtinIDs.has(extension.id))];
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
        kind: 'extension' as const,
        keywords: [extension.name, extension.title, ...command.keywords],
        icon: extension.icon ?? 'extensions',
        favourite: false,
        extensionId: extension.id,
        commandName: command.name,
        actions: [{ id: 'run', title: `Run ${command.title}`, shortcut: '↵' }],
      })),
  );
}
