import React from 'react';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { TransientBlockHost, type TransientBlockActions } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import type { WebpageBlock } from '../Builder/webpageBlocks';

export function ConnectionsDocument({ documentKey, blocks: defaults, scopeKey, scope, actions = {} }: {
  documentKey: string; blocks: WebpageBlock[]; scopeKey: string; scope: Record<string, unknown>; actions?: TransientBlockActions;
}) {
  return <SettingsDocumentHost documentKey={documentKey} defaultDocument={defaults} scopeKey={scopeKey} title="Connections layout">
    {({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={scopeKey} scope={scope} actions={actions} enabled={!editing}>
      <WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} interactive={!editing} bare />
    </TransientBlockHost>}
  </SettingsDocumentHost>;
}
