import React from 'react';
import { Box } from '@chakra-ui/react';
import { SettingsDocumentHost, type SettingsDocumentHostProps } from '../Settings/SettingsDocumentHost';
import { TransientBlockHost } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { findBlock } from '../Builder/webpageBlocks';
import { syncFolderCardBlocks } from './syncFolderCardBlocks';

export function SyncFolderCard({ title, path, description, stats, scopeKey, expanded: controlled, onToggle, disabled = false, accountTransport, editorSlotId, children }: {
 title: string; path: string; description: string; stats: string; scopeKey: string; expanded?: boolean; editorSlotId?: string; onToggle?(open: boolean): void; disabled?: boolean;
 accountTransport?: SettingsDocumentHostProps['accountTransport']; children: React.ReactNode;
}) {
 const [localOpen, setLocalOpen] = React.useState(false);
 const expanded = controlled ?? localOpen;
 return <Box as="article" border="1px solid var(--tt-border, #ececef)" borderRadius="12px" padding={3} marginTop={3} minWidth={0} overflowWrap="anywhere">
  <SettingsDocumentHost documentKey="device-sync-folder-card" title="Sync folder card" defaultDocument={syncFolderCardBlocks} scopeKey={scopeKey} accountTransport={accountTransport}>
   {({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={scopeKey} enabled={!editing} scope={{ folder: { title, path, description, stats, expanded, disabled, toggleGlyph: expanded ? '⌃' : '⌄', expandLabel: expanded ? 'Collapse folder' : 'Expand folder' } }}
    actions={{ expand: () => { if (!disabled) { setLocalOpen(!expanded); onToggle?.(!expanded); } } }}>
    <WebpageBlocksRenderer blocks={findBlock(blocks, 'folder-card-expand') ? blocks : [...blocks, findBlock(syncFolderCardBlocks, 'folder-card-expand')!]} componentsByRef={{}} chrome={chrome} />
   </TransientBlockHost>}
  </SettingsDocumentHost>
  <Box hidden={!expanded} paddingTop={expanded ? 3 : 0}>{children}<div id={editorSlotId} /></Box>
 </Box>;
}
