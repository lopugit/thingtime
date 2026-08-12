import type { CommanderExtension, SearchItem } from '@commander/protocol';

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
        id: `extension:${extension.id}:${command.name}`,
        title: command.title,
        subtitle: extension.title,
        kind: 'extension' as const,
        keywords: [extension.name, extension.title, ...command.keywords],
        icon: 'extensions',
        favourite: false,
        extensionId: extension.id,
        commandName: command.name,
        actions: [{ id: 'run', title: `Run ${command.title}`, shortcut: '↵' }],
      })),
  );
}
