import React from 'react';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { TransientBlockHost, type TransientBlockActions } from '../Builder/TransientBlockHost';
import { TransientPrivateControls } from '../Builder/TransientPrivateControls';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import type { WebpageBlock } from '../Builder/webpageBlocks';

/** Layouts hold only templates. Private values are hydrated directly into
 * explicitly named controls while this vault panel is active. */
export function PasswordPanelDocument({ documentKey, title, scopeKey, blocks, scope, actions, readValue }: {
  documentKey: string; title: string; scopeKey: string; blocks: WebpageBlock[];
  scope: Record<string, unknown>; actions: TransientBlockActions;
  readValue?: (name: string) => string | boolean | undefined;
}) {
  return <SettingsDocumentHost documentKey={documentKey} title={title} defaultDocument={blocks} scopeKey={scopeKey}>
    {({ blocks: authored, chrome, editing }) => <TransientBlockHost scopeKey={scopeKey} scope={scope} actions={actions} enabled={!editing}>
      <TransientPrivateControls scopeKey={scopeKey} enabled={!editing} readValue={readValue || (() => undefined)}>
        <WebpageBlocksRenderer blocks={authored} componentsByRef={{}} chrome={chrome} interactive={!editing} bare />
      </TransientPrivateControls>
    </TransientBlockHost>}
  </SettingsDocumentHost>;
}
