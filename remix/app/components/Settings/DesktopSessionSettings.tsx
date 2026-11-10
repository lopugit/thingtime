import React from 'react';
import type { ThingtimeDesktopInfo } from '~/utils/electronBridge';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { TransientBlockHost } from '../Builder/TransientBlockHost';
import { SettingsDocumentHost } from './SettingsDocumentHost';
import { DESKTOP_SESSION_BLOCKS, DESKTOP_NOTICE_BLOCKS } from './desktopSettingsDocuments';
import { useDesktopSettingsAdapter } from './useDesktopSettingsAdapter';
const blocks = [...DESKTOP_SESSION_BLOCKS, ...DESKTOP_NOTICE_BLOCKS];
export function DesktopSessionSettings({ desktopInfo, onInfo }: {
  desktopInfo: ThingtimeDesktopInfo; onInfo: (info: ThingtimeDesktopInfo) => void;
}) {
  const adapter = useDesktopSettingsAdapter(desktopInfo, onInfo);
  return <SettingsDocumentHost documentKey="desktop-session" title="Desktop session workspace"
    defaultDocument={blocks} scopeKey={adapter.documentScopeKey} persistence="device">
    {({ blocks, chrome, editing }) => <TransientBlockHost {...adapter} enabled={!editing}>
      <WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} bare />
    </TransientBlockHost>}
  </SettingsDocumentHost>;
}
