import { syncConnectionGlanceBlocks, withStableSyncGlance } from './syncConnectionGlanceBlocks';
import type { SyncConnectionGlance as Glance } from '~/fileSync/connectionGlance';
import React from 'react';
import { Box } from '@chakra-ui/react';
import { SettingsDocumentHost, type SettingsDocumentHostProps } from '../Settings/SettingsDocumentHost';
import { TransientBlockHost } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { findBlock, type WebpageBlock } from '../Builder/webpageBlocks';
import { type photoQueueDisplay, syncFolderCardBlocks, withSyncFolderQuickBlocks, type SyncFolderPreparation } from './syncFolderCardBlocks';
import type { nativePhotoActivityDisplay } from './nativePhotoRunView';

const withGlance = (blocks: WebpageBlock[], uploadOnly = false) => findBlock(blocks, 'connection-glance') ? withStableSyncGlance(blocks, uploadOnly) : [...blocks, ...syncConnectionGlanceBlocks('connectionStats', 'connection-glance', uploadOnly)];
const withGlanceAndQuick = (blocks: WebpageBlock[], uploadOnly = false) => withGlance(withSyncFolderQuickBlocks(blocks), uploadOnly);
const defaultQuickBlocks = withSyncFolderQuickBlocks(syncFolderCardBlocks);

type QuickAction = { label: string; disabled?: boolean; run(): void | Promise<void> };
export function SyncFolderCard({ title, path, description, stats, glance, uploadOnly = false, quickAction, pauseAction, continuationAction, continuationStatus, automation, destination, error, preparation, photoQueue, photoActivity, scopeKey, expanded: controlled, onToggle, disabled = false, accountTransport, editorSlotId, summaryContent, children }: {
 quickAction?: QuickAction; pauseAction?: QuickAction; continuationAction?: QuickAction; continuationStatus?: string;
 automation?: string; destination?: string; error?: string; preparation?: SyncFolderPreparation; photoQueue?: ReturnType<typeof photoQueueDisplay>;
 photoActivity?: ReturnType<typeof nativePhotoActivityDisplay>;
 uploadOnly?: boolean; glance?: Glance; title: string; path: string; description: string; stats: string; scopeKey: string; expanded?: boolean; editorSlotId?: string; onToggle?(open: boolean): void; disabled?: boolean;
 summaryContent?: React.ReactNode; accountTransport?: SettingsDocumentHostProps['accountTransport']; children: React.ReactNode;
}) {
 const [localOpen, setLocalOpen] = React.useState(false);
 const expanded = controlled ?? localOpen;
 if (uploadOnly) {
  automation ||= 'Automatic backup status not reported yet.';
  continuationStatus ||= 'iOS background processing status not reported yet.';
 }
 const hasGlance = !!glance;
 const migrate = React.useCallback((blocks: WebpageBlock[]) => hasGlance ? withGlanceAndQuick(blocks, uploadOnly) : withSyncFolderQuickBlocks(blocks), [hasGlance, uploadOnly]);
 return <Box as="article" border="1px solid var(--tt-border, #ececef)" borderRadius="12px" padding={3} marginTop={3} minWidth={0} overflowWrap="anywhere">
  <SettingsDocumentHost documentKey="device-sync-folder-card" title="Sync folder card" defaultDocument={glance ? withGlanceAndQuick(syncFolderCardBlocks, uploadOnly) : defaultQuickBlocks} migrateBlocks={migrate} scopeKey={scopeKey} accountTransport={accountTransport}>
   {({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={scopeKey} enabled={!editing} scope={{ ...(glance ? { connectionStats: glance } : {}), folder: { title, path, description, stats, expanded, disabled, destination, hasDestination: !!destination, error, hasError: !!error, photoQueue, hasPhotoQueue: !!photoQueue, hasPendingPhotos: !!photoQueue?.pending, hasUnavailablePhotos: !!photoQueue?.unavailable, preparation, hasPreparation: !!preparation, activity: photoActivity, hasActivity: !!photoActivity, activityHasDownload: photoActivity?.downloadPercent !== undefined, activityDownloadHidden: photoActivity?.downloadPercent === undefined, hasAction: !!quickAction, actionLabel: quickAction?.label, actionDisabled: !!quickAction?.disabled, automation, hasAutomation: !!automation, hasPauseAction: !!pauseAction, pauseLabel: pauseAction?.label, pauseDisabled: !!pauseAction?.disabled, hasContinuation: !!continuationAction, continuationLabel: continuationAction?.label, continuationDisabled: !!continuationAction?.disabled, continuationStatus, hasContinuationStatus: !!continuationStatus, toggleGlyph: expanded ? '⌃' : '⌄', expandLabel: expanded ? 'Collapse folder' : 'Expand folder' } }}
    actions={{
     quick: () => { if (quickAction && !quickAction.disabled) return quickAction.run(); },
     'pause-automatic': () => { if (pauseAction && !pauseAction.disabled) return pauseAction.run(); },
     'continue-background': () => { if (continuationAction && !continuationAction.disabled) return continuationAction.run(); },
     expand: () => { if (!disabled) { setLocalOpen(!expanded); onToggle?.(!expanded); } }
    }}>
    <WebpageBlocksRenderer blocks={findBlock(blocks, 'folder-card-expand') ? blocks : [...blocks, findBlock(syncFolderCardBlocks, 'folder-card-expand')!]} componentsByRef={{}} chrome={chrome} />
   </TransientBlockHost>}
  </SettingsDocumentHost>
  {summaryContent}
  <Box hidden={!expanded} paddingTop={expanded ? 3 : 0}>{children}<div id={editorSlotId} /></Box>
 </Box>;
}
