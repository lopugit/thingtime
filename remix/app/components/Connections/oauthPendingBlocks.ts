import type { WebpageBlock } from '../Builder/webpageBlocks';

export const oauthPendingBlocks: WebpageBlock[] = [{
  id: 'connections-oauth-pending',
  type: 'condition',
  condition: { arg: 'oauth.pending', equals: true },
  children: [{
    id: 'connections-oauth-controls', type: 'element', tag: 'div',
    css: { display: 'flex', 'align-items': 'center', 'flex-wrap': 'wrap', gap: '8px' },
    children: [
      { id: 'connections-oauth-message', type: 'element', tag: 'p',
        text: 'Finish signing in to {oauth.provider} in the new tab.', props: { role: 'status' },
        css: { 'font-size': '14px', 'overflow-wrap': 'anywhere' } },
      { id: 'connections-oauth-stop', type: 'element', tag: 'button', text: 'Stop waiting',
        props: { type: 'button', 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation: 'stop' } },
        css: { 'min-height': '44px', padding: '4px 12px', 'border-radius': '8px', 'font-size': '14px', 'font-weight': '600' } }
    ]
  }]
}];
