import {
  AppWindow,
  Box,
  Cloud,
  Command,
  ExternalLink,
  FileCode2,
  FolderOpen,
  History,
  Link,
  Settings,
  Smile,
  Sparkles,
  TerminalSquare,
} from 'lucide-react';
import type { SearchItemKind } from '@commander/protocol';

export function CommanderIcon({
  name,
  kind,
}: {
  name?: string | undefined;
  kind?: SearchItemKind | undefined;
}) {
  const key = name ?? kind;
  const Icon =
    key === 'settings'
      ? Settings
      : key === 'emoji'
        ? Smile
        : key === 'extensions'
          ? Box
          : key === 'store'
            ? Cloud
            : key === 'sideload'
              ? FolderOpen
              : key === 'history'
                ? History
                : key === 'application'
                  ? AppWindow
                  : key === 'quicklink'
                    ? Link
                    : key === 'command'
                      ? TerminalSquare
                      : key === 'external'
                        ? ExternalLink
                        : key === 'file'
                          ? FileCode2
                          : key === 'sparkles'
                            ? Sparkles
                            : Command;
  return <Icon aria-hidden="true" strokeWidth={1.8} />;
}
