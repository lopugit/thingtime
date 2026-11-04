import { CONNECTION_ICON_FALLBACK } from '~/connections/providerIcons';
import type { WebpageBlock } from '../Builder/webpageBlocks';
import { cardStyle } from './shared';

const element = (id: string, tag: string, text: string, props: Record<string, unknown> = {}, css: Record<string, string> = {}): WebpageBlock =>
  ({ id, type: 'element', tag, text, props, css });

export const providerCatalogBlocks: WebpageBlock[] = [{
  ...element('connections-provider-grid', 'div', '', {}, {
    display: 'grid', 'grid-template-columns': 'repeat(auto-fill, minmax(min(100%, 240px), 1fr))', gap: '12px',
  }),
  children: [{
    id: 'connections-provider-template', type: 'collection', props: { itemsPath: 'catalog.providers', label: 'Providers', transparent: true },
    children: [{
      ...element('connections-provider-card', 'article', '', {}, {
        display: 'flex', 'flex-direction': 'column', gap: '8px', 'min-width': '0', padding: '16px',
        background: cardStyle.background, border: cardStyle.border, 'border-radius': cardStyle.borderRadius,
      }),
      children: [{
        ...element('connections-provider-heading', 'div', '', {}, { display: 'flex', 'align-items': 'center', gap: '8px', 'min-width': '0' }),
        children: [element('connections-provider-logo', 'img', '', {
          src: '{item.iconUrl}', alt: '', 'aria-hidden': true, 'data-tt-image-fallback': CONNECTION_ICON_FALLBACK,
          width: 24, height: 24,
        }, { width: '24px', height: '24px', flex: '0 0 24px', 'object-fit': 'contain' }),
        element('connections-provider-title', 'h3', '{item.name}', {}, { 'font-weight': '600', 'overflow-wrap': 'anywhere' })],
      },
      element('connections-provider-description', 'p', '{item.about}', {}, {
        'font-size': '14px', color: 'var(--tt-muted, #6b7280)', flex: '1', 'overflow-wrap': 'anywhere',
      }),
      element('connections-provider-connect', 'button', '{item.buttonLabel}', {
        type: 'button', disabled: '{item.disabled}', style: { background: '{item.buttonBackground}', opacity: '{item.buttonOpacity}' },
        'data-tt-action': '$transient', 'data-tt-action-inputs': { operation: 'connect', provider: '{item.id}' },
      }, {
        border: '1px solid var(--tt-border, #e2e8f0)', 'border-radius': '999px', padding: '8px 12px',
        'min-height': '32px', 'font-size': '14px', 'font-weight': '600', 'white-space': 'normal', 'overflow-wrap': 'anywhere',
      })],
    }],
  }],
}];
