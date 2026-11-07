import type { WebpageBlock } from '../Builder/webpageBlocks';
import { findBlock } from '../Builder/webpageBlocks';
import { toWindowMs, type TransferUnit } from '~/fileSync/transferSpeed';

export const MAX_SPEED_TRACKERS = 16;
export const TRANSFER_UNITS: TransferUnit[] = ['Kbps', 'Mbps', 'Gbps', 'Folders/ps', 'Files/ps', 'INodes/ps'];
export const WINDOW_UNITS = ['seconds', 'minutes', 'hours'] as const;
export type SpeedTracker = { id: string; windowValue: number; windowUnit: typeof WINDOW_UNITS[number]; unit: TransferUnit };
const style = { 'min-height': '40px', padding: '6px 10px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '8px', 'max-width': '100%' };
const element = (id: string, tag: string, text: string, props: Record<string, unknown> = {}, css: Record<string, string> = {}): WebpageBlock => ({ id, type: 'element', tag, text, props, css });
const action = (operation: string, id?: string) => ({ 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation, ...(id ? { id } : {}) } });
const button = (id: string, label: string, operation: string, tracker?: string, disabled = '{speed.controlsDisabled}') => element(id, 'button', label, { type: 'button', disabled, ...action(operation, tracker) }, style);

/** A tracker is an ordinary block subtree, including each label, option and value.
 * Only preference literals are stored here; live counters never enter the document. */
export function speedTrackerBlocks(tracker: SpeedTracker): WebpageBlock {
 const id = tracker.id;
 return { id: `${id}-tracker`, type: 'element', tag: 'fieldset', props: { 'aria-label': 'Transfer speed tracker', 'data-speed-tracker': id },
  css: { 'min-width': '0', margin: '12px 0', padding: '12px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '10px' }, children: [
   element(`${id}-title`, 'legend', 'Speed tracker', {}, { 'font-weight': '600' }),
   { id: `${id}-controls`, type: 'element', tag: 'div', css: { display: 'flex', 'flex-wrap': 'wrap', 'align-items': 'end', gap: '8px' }, children: [
    { id: `${id}-window-group`, type: 'element', tag: 'div', css: { display: 'flex', 'flex-direction': 'column', gap: '4px', 'min-width': '100px' }, children: [element(`${id}-window-label`, 'label', 'Average over', { htmlFor: `${id}-window` }),
    element(`${id}-window`, 'input', '', { id: `${id}-window`, name: 'window', type: 'number', min: 1 / ({ seconds: 1, minutes: 60, hours: 3600 }[tracker.windowUnit]), max: 86400 / ({ seconds: 1, minutes: 60, hours: 3600 }[tracker.windowUnit]), step: 'any', value: tracker.windowValue, 'aria-label': 'Averaging timeframe', disabled: '{speed.controlsDisabled}' }, { ...style, width: '100px' })] },
    { id: `${id}-time-group`, type: 'element', tag: 'div', css: { display: 'flex', 'flex-direction': 'column', gap: '4px', 'min-width': '100px' }, children: [element(`${id}-time-label`, 'label', 'Time unit', { htmlFor: `${id}-time` }),
    { ...element(`${id}-time`, 'select', '', { id: `${id}-time`, name: 'time', value: tracker.windowUnit, 'aria-label': 'Averaging time unit', disabled: '{speed.controlsDisabled}' }, style), children: WINDOW_UNITS.map(unit => element(`${id}-time-${unit}`, 'option', unit, { value: unit })) }] },
    { id: `${id}-unit-group`, type: 'element', tag: 'div', css: { display: 'flex', 'flex-direction': 'column', gap: '4px', 'min-width': '100px' }, children: [element(`${id}-unit-label`, 'label', 'Rate unit', { htmlFor: `${id}-unit` }),
    { ...element(`${id}-unit`, 'select', '', { id: `${id}-unit`, name: 'unit', value: tracker.unit, 'aria-label': 'Transfer rate unit', disabled: '{speed.controlsDisabled}' }, style), children: TRANSFER_UNITS.map((unit, i) => element(`${id}-unit-${i}`, 'option', unit, { value: unit })) }] },
    button(`${id}-apply`, 'Apply tracker', 'apply', id), button(`${id}-remove`, 'Remove tracker', 'remove', id)
   ] },
   element(`${id}-upload`, 'p', `Upload: {speed.readings.${id}.upload}`, {}, { 'font-variant-numeric': 'tabular-nums' }),
   element(`${id}-download`, 'p', `Download: {speed.readings.${id}.download}`, {}, { 'font-variant-numeric': 'tabular-nums' }),
   element(`${id}-window-status`, 'p', `{speed.readings.${id}.window}`, {}, { 'font-size': '12px', color: 'var(--tt-muted, #71717a)' })
  ] };
}
export const transferSpeedBlocks: WebpageBlock[] = [{ id: 'transfer-speeds', type: 'element', tag: 'section', props: { 'aria-label': 'Transfer speed trackers' },
 css: { 'min-width': '0', 'overflow-wrap': 'anywhere', 'margin-top': '12px' }, children: [
  element('speed-title', 'h3', 'Transfer speeds', {}, { 'font-weight': '600' }),
  element('speed-help', 'p', 'Choose an averaging timeframe from 1 second to 24 hours. Up to 16 independent trackers. Kbps, Mbps and Gbps measure acknowledged payload in decimal bits. Byte rates are unavailable when the transport omits byte progress. File, folder and inode rates count logical entries, not physical disk inodes.', {}, { 'font-size': '12px' }),
  element('speed-state', 'p', '{speed.status}', { role: 'status' }, { 'font-size': '12px' }),
  { id: 'speed-actions', type: 'container', direction: 'row', gap: 8, css: { 'flex-wrap': 'wrap' }, children: [
   button('speed-add', 'Add tracker', 'add', undefined, '{speed.addDisabled}'),
   button('speed-save', '{speed.saveLabel}', 'save', undefined, '{speed.saveDisabled}')
  ] },
  element('speed-error', 'p', '{speed.error}', { role: 'alert' }),
  { id: 'speed-trackers', type: 'container', direction: 'column', gap: 4, children: [speedTrackerBlocks({ id: 'tracker-default', windowValue: 10, windowUnit: 'seconds', unit: 'Mbps' })] }
 ] }];

export function readSpeedTrackers(blocks: WebpageBlock[]): SpeedTracker[] {
 const nodes = findBlock(blocks, 'speed-trackers')?.children || [];
 const trackers: SpeedTracker[] = [];
 for (const node of nodes) {
  const id = node.props?.['data-speed-tracker'];
  if (typeof id !== 'string' || !/^tracker-[a-z0-9-]{1,64}$/.test(id) || trackers.some(t => t.id === id)) continue;
  const windowValue = Number(findBlock([node], `${id}-window`)?.props?.value);
  const windowUnit = findBlock([node], `${id}-time`)?.props?.value as SpeedTracker['windowUnit'];
  const unit = findBlock([node], `${id}-unit`)?.props?.value as TransferUnit;
  try { if (!WINDOW_UNITS.includes(windowUnit) || !TRANSFER_UNITS.includes(unit)) continue; toWindowMs(windowValue, windowUnit); }
  catch { continue; }
  trackers.push({ id, windowValue, windowUnit, unit });
  if (trackers.length === MAX_SPEED_TRACKERS) break;
 }
 return trackers;
}
export function updateSpeedTracker(blocks: WebpageBlock[], tracker: SpeedTracker): WebpageBlock[] {
 const copy = structuredClone(blocks);
 for (const [suffix, value] of [['window', tracker.windowValue], ['time', tracker.windowUnit], ['unit', tracker.unit]] as const) {
  const block = findBlock(copy, `${tracker.id}-${suffix}`); if (block) block.props = { ...block.props, value };
 }
 const input = findBlock(copy, `${tracker.id}-window`);
 const seconds = { seconds: 1, minutes: 60, hours: 3600 }[tracker.windowUnit];
 if (input) input.props = { ...input.props, min: 1 / seconds, max: 86400 / seconds };
 return copy;
}
