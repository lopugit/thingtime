import React from 'react';
import { Box } from '@chakra-ui/react';
import type { WebpageBlock } from '../Builder/webpageBlocks';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { TransientBlockHost } from '../Builder/TransientBlockHost';
import { DRAWER_Z } from '../Nav/Drawer/useDrawer';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { useContextViewportDock } from './useContextViewportDock';
export type ContextToolbarAction = { id: string; label: string; glyph: string; run: () => void };
export function contextToolbarBlocks(actions: Pick<ContextToolbarAction, 'id' | 'label' | 'glyph'>[]): WebpageBlock[] {
 const controls: WebpageBlock = { id: 'context-toolbar', type: 'element', tag: 'nav', props: { 'aria-label': 'Share destination' }, css: { display: 'flex', gap: '8px', width: '100%', 'min-width': '0', 'align-items': 'stretch' }, children: actions.map(item => ({
  id: `context-action-${item.id}`, type: 'element', tag: 'button', props: { type: 'button', 'aria-pressed': `{toolbar.${item.id}}`, 'data-tt-action': '$transient', 'data-tt-action-inputs': JSON.stringify({ operation: item.id }) },
  css: { flex: '1 1 0', 'min-width': '0', 'min-height': '52px', padding: '8px', display: 'flex', 'align-items': 'center', 'justify-content': 'center', gap: '8px', border: `1px solid var(--tt-context-${item.id}-border, var(--tt-border, #e9e7ee))`, 'border-radius': '12px', background: `var(--tt-context-${item.id}-background, var(--tt-card, #fff))`, color: 'inherit', cursor: 'pointer', 'flex-wrap': 'wrap' }, children: [
   { id: `context-icon-${item.id}`, type: 'element', tag: 'span', text: item.glyph, props: { 'aria-hidden': true }, css: { 'font-size': '18px', 'line-height': '1' } },
   { id: `context-label-${item.id}`, type: 'element', tag: 'span', text: item.label, css: { 'font-size': '13px', 'font-weight': '600', 'overflow-wrap': 'anywhere' } }
  ]
 })) };
 return [{ id: 'context-toolbar-workspace', type: 'element', tag: 'section', css: { display: 'grid', gap: '8px', width: '100%' }, children: [
  { id: 'context-toolbar-pixels', type: 'element', tag: 'div', props: { 'aria-hidden': true }, css: { display: 'flex', gap: '3px', 'justify-content': 'center' }, children: ['#59ff9c', '#ffa3b1', '#6f3198', '#59bdff', '#ffc20e'].map((color, index) => ({ id: `context-pixel-${index}`, type: 'element', tag: 'span', css: { display: 'block', width: '8px', height: '8px', background: color } })) }, controls
 ] }];
}
/** The adapter supplies selection and callbacks only. Layout, each label,
 * icon and control remain independent ordinary editable Builder blocks. Other
 * contexts can supply additional registered actions without another toolbar. */
export function ContextActionToolbar({ scopeKey, documentKey = 'incoming-share-toolbar', actions, selected, onHeightChange, showLayoutControls = true }: { showLayoutControls?: boolean; onHeightChange?: (height: number, visibleHeight: number) => void; scopeKey: string; documentKey?: string; actions: ContextToolbarAction[]; selected: string }) {
 const host = React.useRef<HTMLDivElement>(null);
 const measure = React.useCallback((height: number, reserved: number) => onHeightChange?.(reserved, height), [onHeightChange]);
 useContextViewportDock(host, true, 0, measure);
 const defaults = React.useMemo(() => contextToolbarBlocks(actions), [actions]);
 return <Box ref={host} data-testid="context-action-toolbar" position="fixed" left={0} right={0} style={Object.fromEntries(actions.flatMap(item => [[`--tt-context-${item.id}-background`, selected === item.id ? 'var(--tt-accent-tint, #fff2f8)' : 'var(--tt-card, #fff)'], [`--tt-context-${item.id}-border`, selected === item.id ? 'var(--tt-accent, #ba256b)' : 'var(--tt-border, #e9e7ee)']])) as React.CSSProperties} zIndex={DRAWER_Z} px={{ base: '12px', md: '24px' }} pt="8px" pb="max(12px, env(safe-area-inset-bottom))" background="var(--tt-card, #fff)" borderTop="1px solid var(--tt-border, #e9e7ee)" boxShadow="0 -8px 32px rgba(30, 20, 45, .035)" sx={{ 'button[aria-pressed="true"]': { background: 'var(--tt-accent-tint, #fff2f8)', borderColor: 'var(--tt-accent, #ba256b)', color: 'var(--tt-ink, #16161a)' }, 'button:focus-visible': { outline: '2px solid var(--tt-accent, #ba256b)', outlineOffset: '2px' } }}>
  <Box maxW="900px" mx="auto"><SettingsDocumentHost showLayoutControls={showLayoutControls} documentKey={documentKey} defaultDocument={defaults} scopeKey={scopeKey} title="Context action toolbar" editLayoutLabel="Customise toolbar" clearMobileLaunchers>
   {({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={scopeKey} enabled={!editing} scope={{ toolbar: Object.fromEntries(actions.map(item => [item.id, selected === item.id])) }} actions={Object.fromEntries(actions.map(item => [item.id, () => item.run()]))}><WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} /></TransientBlockHost>}
  </SettingsDocumentHost></Box>
 </Box>;
}
