import { CONNECTION_ICON_FALLBACK } from '~/connections/providerIcons';
import type { WebpageBlock } from '../Builder/webpageBlocks';
import { cardStyle } from './shared';

const element = (id: string, tag: string, text: string, props: Record<string, unknown> = {}, css: Record<string, string> = {}): WebpageBlock =>
  ({ id, type: 'element', tag, text, props, css });

const logo = (id: string) => element(id, 'img', '', {
  src: '{item.iconUrl}', alt: '', 'aria-hidden': true, 'data-tt-image-fallback': CONNECTION_ICON_FALLBACK,
  width: 24, height: 24,
}, { width: '24px', height: '24px', flex: '0 0 24px', 'object-fit': 'contain' });
const card = { background: cardStyle.background, border: cardStyle.border, 'border-radius': cardStyle.borderRadius };
const secondary = { 'font-size': '14px', color: 'var(--tt-muted, #6b7280)', 'overflow-wrap': 'anywhere' };
const action = {
  'border-radius': '999px', padding: '8px 12px', 'min-height': '32px', 'font-size': '14px',
  'font-weight': '600', 'white-space': 'normal', 'overflow-wrap': 'anywhere',
};
const outline = { ...action, border: '1px solid var(--tt-border, #e2e8f0)' };

export const providerCatalogBlocks: WebpageBlock[] = [{
  ...element('connections-provider-grid', 'div', '', {}, {
    display: 'grid', 'grid-template-columns': 'repeat(auto-fill, minmax(min(100%, 240px), 1fr))', gap: '12px',
  }),
  children: [{
    id: 'connections-provider-template', type: 'collection', props: { itemsPath: 'catalog.providers', label: 'Providers', transparent: true },
    children: [{
      ...element('connections-provider-card', 'article', '', {}, {
        display: 'flex', 'flex-direction': 'column', gap: '8px', 'min-width': '0', padding: '16px',
        ...card,
      }),
      children: [{
        ...element('connections-provider-heading', 'div', '', {}, { display: 'flex', 'align-items': 'center', gap: '8px', 'min-width': '0' }),
        children: [logo('connections-provider-logo'),
        element('connections-provider-title', 'h3', '{item.name}', {}, { 'font-weight': '600', 'overflow-wrap': 'anywhere' })],
      },
      element('connections-provider-description', 'p', '{item.about}', {}, {
        ...secondary, flex: '1',
      }),
      element('connections-provider-connect', 'button', '{item.buttonLabel}', {
        type: 'button', disabled: '{item.disabled}', style: { background: '{item.buttonBackground}', opacity: '{item.buttonOpacity}' },
        'data-tt-action': '$transient', 'data-tt-action-inputs': { operation: 'connect', provider: '{item.id}' },
      }, outline)],
    }],
  }],
}];

export const linkedConnectionBlocks: WebpageBlock[] = [{
  ...element('connections-linked-list', 'div', '', {}, { display: 'grid', gap: '12px' }),
  children: [{
    id: 'connections-linked-template', type: 'collection', props: { itemsPath: 'linked.rows', label: 'Linked accounts', transparent: true },
    children: [{
      ...element('connections-linked-card', 'article', '', {}, {
        ...card, display: 'flex', 'align-items': 'center', 'flex-wrap': 'wrap', gap: '8px 12px', 'min-width': '0', padding: '16px',
      }),
      children: [logo('connections-linked-logo'), {
        ...element('connections-linked-details', 'div', '', {}, { flex: '1 1 200px', 'min-width': '0' }),
        children: [{
          ...element('connections-linked-title-line', 'div', '', {}, { display: 'flex', 'flex-wrap': 'wrap', 'align-items': 'baseline', gap: '0 8px' }),
          children: [
            element('connections-linked-title', 'h3', '{item.displayName}', {}, { 'font-weight': '600', 'overflow-wrap': 'anywhere' }),
            element('connections-linked-provider', 'span', '{item.providerLabel}', {}, secondary),
          ],
        }, element('connections-linked-description', 'p', '{item.subtitle}', {}, secondary)],
      },
      element('connections-linked-feed', 'a', 'Feed', { href: '{item.feedHref}' }, outline),
      element('connections-linked-unlink', 'button', 'Unlink', {
        type: 'button', 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation: 'unlink', connectionId: '{item.id}' },
      }, action)],
    }],
  }],
}];
