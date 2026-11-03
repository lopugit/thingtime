import React from 'react';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { TransientBlockHost } from '../Builder/TransientBlockHost';
import type { WebpageBlock } from '../Builder/webpageBlocks';
import type { SubspaceViewPrefs } from './subspaceViewPrefs';

// Every label, control and container is an ordinary editable Builder block.
// Only the authority-scoped preference mutation lives in the adapter below.
const element = (id: string, tag: string, text: string, props: Record<string, unknown> = {}, children?: WebpageBlock[], css?: Record<string, string>): WebpageBlock =>
  ({ id, type: 'element', tag, text, props, ...(children ? { children } : {}), ...(css ? { css } : {}) } as WebpageBlock);
const action = (operation: string) => ({ 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation } });
const buttonStyle = { padding: '7px 14px', border: '1px solid var(--tt-border, #ececef)', 'border-radius': '999px', color: 'inherit', cursor: 'pointer' };
export const SUBSPACE_VIEW_BLOCKS: WebpageBlock[] = [element('subspace-view-controls', 'div', '', { role: 'group', 'aria-label': 'Subspace view' }, [
  element('subspace-view-posts', 'button', 'Posts', { type: 'button', 'aria-label': 'Posts', 'aria-pressed': '{result.posts}', style: { background: '{result.postsBackground}', fontWeight: '{result.postsWeight}' }, ...action('view.posts') }, undefined, buttonStyle),
  element('subspace-view-messages', 'button', 'Messages', { type: 'button', 'aria-label': 'Messages', 'aria-pressed': '{result.messages}', style: { background: '{result.messagesBackground}', fontWeight: '{result.messagesWeight}' }, ...action('view.messages') }, undefined, buttonStyle),
  element('subspace-comment-toggle', 'label', '', {}, [
    element('subspace-expand-comments', 'input', '', { type: 'checkbox', name: 'expand-comments', checked: '{result.expandComments}', 'aria-label': 'Automatically expand all comments', ...action('view.comments') }),
    element('subspace-expand-label', 'span', 'Expand all comments')
  ], { display: 'flex', gap: '8px', 'align-items': 'center', 'font-size': '13px', 'white-space': 'normal', cursor: 'pointer' })
], { display: 'flex', gap: '8px', 'flex-wrap': 'wrap', 'align-items': 'center' })];

export function SubspaceViewControls({ prefs, onChange, scopeKey }: {
  prefs: SubspaceViewPrefs; onChange: (patch: Partial<SubspaceViewPrefs>) => void; scopeKey: string;
}) {
  return <SettingsDocumentHost documentKey="subspace-view-controls" defaultDocument={SUBSPACE_VIEW_BLOCKS} scopeKey={scopeKey} persistence="device" title="Subspace view controls">
    {({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={scopeKey} scope={{ result: { posts: prefs.mode === 'posts', messages: prefs.mode === 'messages', postsBackground: prefs.mode === 'posts' ? 'var(--tt-surface-hover, #ececee)' : 'var(--tt-card, #fff)', messagesBackground: prefs.mode === 'messages' ? 'var(--tt-surface-hover, #ececee)' : 'var(--tt-card, #fff)', postsWeight: prefs.mode === 'posts' ? 700 : 400, messagesWeight: prefs.mode === 'messages' ? 700 : 400, expandComments: prefs.expandComments } }}
      enabled={!editing} actions={{ 'view.posts': () => onChange({ mode: 'posts' }), 'view.messages': () => onChange({ mode: 'messages' }), 'view.comments': ({ value }) => onChange({ expandComments: value === true }) }}>
      <WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} bare />
    </TransientBlockHost>}
  </SettingsDocumentHost>;
}
