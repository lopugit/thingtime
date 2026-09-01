import type { CommanderAction, SearchItemKind } from '@commander/protocol';

export function pathActions(
  kind: Extract<SearchItemKind, 'application' | 'file' | 'directory'>,
): CommanderAction[] {
  return [
    {
      id: 'open',
      title: kind === 'application' ? 'Open Application' : kind === 'directory' ? 'Open Folder' : 'Open',
      shortcut: '↵',
    },
    { id: 'show-in-finder', title: 'Show in Finder', shortcut: '⇧⌘R' },
    { id: 'copy-file', title: kind === 'directory' ? 'Copy Folder' : 'Copy', shortcut: '⌘C' },
    { id: 'copy-path', title: 'Copy Path', shortcut: '⇧⌘C' },
    { id: 'copy-name', title: 'Copy Name' },
    { id: 'move-to-trash', title: 'Move to Trash', shortcut: '⌘⌫', destructive: true },
    { id: 'delete', title: 'Delete Immediately…', shortcut: '⌥⌘⌫', destructive: true },
  ];
}
