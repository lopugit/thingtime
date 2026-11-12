import type { WebpageBlock } from '../Builder/webpageBlocks';
/** Thingtime colour blocks are separate editable elements, including each pixel. */
export const incomingShareBlocks: WebpageBlock[] = [{ id: 'incoming-share-intro', type: 'element', tag: 'header', css: { display: 'grid', gap: '12px', 'margin-bottom': '24px' }, children: [
 { id: 'incoming-share-pixels', type: 'element', tag: 'div', props: { 'aria-hidden': true }, css: { display: 'flex', gap: '4px' }, children: ['#59ff9c', '#ffa3b1', '#6f3198', '#59bdff', '#ffc20e'].map((color, index) => ({ id: `share-pixel-${index}`, type: 'element', tag: 'span', css: { display: 'block', width: '12px', height: '12px', background: color } })) },
 { id: 'incoming-share-title', type: 'element', tag: 'h1', text: '{share.title}', css: { margin: '0', 'font-size': '28px', 'font-weight': '700', 'letter-spacing': '-.035em', 'line-height': '1.2' } },
 { id: 'incoming-share-summary', type: 'element', tag: 'p', text: '{share.summary}', css: { margin: '0', 'font-size': '14px', 'line-height': '1.6', color: 'var(--tt-text, #5a5a66)' } },
 { id: 'incoming-share-status', type: 'element', tag: 'p', text: '{share.status}', props: { role: 'status', 'aria-live': 'polite' }, css: { margin: '0', 'font-size': '14px', 'line-height': '1.5', color: 'var(--tt-text, #5a5a66)' } },
 { id: 'incoming-share-login-when', type: 'condition', condition: { arg: 'share.signedOut', equals: true }, children: [{ id: 'incoming-share-login', type: 'element', tag: 'a', text: 'Sign in to continue', props: { href: '{share.loginHref}', style: { display: '{share.loginDisplay}' } }, css: { 'min-height': '44px', display: 'inline-flex', 'align-items': 'center', color: 'inherit', 'text-decoration': 'underline' } }] }
]}];
