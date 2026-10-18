import { DesktopSessionSettings } from './DesktopSessionSettings';
import React from 'react';
import type { ThingtimeDesktopInfo } from '~/utils/electronBridge';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { TransientBlockHost } from '../Builder/TransientBlockHost';
import { SettingsDocumentHost } from './SettingsDocumentHost';
import { DESKTOP_CONNECTION_BLOCKS, DESKTOP_RECOVERY_BLOCKS } from './desktopSettingsDocuments';
import { useDesktopSettingsAdapter } from './useDesktopSettingsAdapter';

/** Same editable document in Settings and the offline connection-repair pane. */
export function DesktopConnectionSettings({ desktopInfo, onInfo, recovery = false }: {
  recovery?: boolean; desktopInfo: ThingtimeDesktopInfo; onInfo: (info: ThingtimeDesktopInfo) => void;
}) {
  const adapter = useDesktopSettingsAdapter(desktopInfo, onInfo);
  return <SettingsDocumentHost documentKey={recovery ? "desktop-recovery" : "desktop-connection"} title="Desktop connection settings"
    defaultDocument={recovery ? DESKTOP_RECOVERY_BLOCKS : DESKTOP_CONNECTION_BLOCKS} scopeKey={adapter.documentScopeKey} persistence="device">
    {({ blocks, chrome, editing }) => <TransientBlockHost {...adapter} enabled={!editing}>
      <WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} bare />
    </TransientBlockHost>}
  </SettingsDocumentHost>;
}
