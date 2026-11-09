import { deviceResourceWindows, historyResourceMetrics } from './deviceSyncResourceDisplay';
import type { WebpageBlock } from '../Builder/webpageBlocks';
const text = (id: string, tag: string, value: string, props: Record<string, unknown> = {}): WebpageBlock => ({ id, type: 'element', tag, text: value, props });
const meter = (name: string, label: string): WebpageBlock => ({ id: `device-sync-${name}`, type: 'element', tag: 'div', css: { display: 'grid', 'grid-template-rows': 'auto 1fr 8px', gap: '6px', 'min-width': '0' }, children: [
 text(`${name}-label`, 'span', label), text(`${name}-reading`, 'strong', `{deviceResources.${name}Text}`),
 { id: `${name}-bar`, type: 'element', tag: 'div', props: { role: 'meter', 'data-resource-bar': name, 'aria-valuenow': `{deviceResources.${name}Value}`, 'aria-valuemin': 0, 'aria-valuemax': '{deviceResources.' + name + 'Max}', 'aria-label': label, 'aria-hidden': `{deviceResources.${name}Unknown}` }, css: { width: '100%', height: '8px', background: 'var(--tt-border, #dedee5)', 'border-radius': '5px', overflow: 'hidden' }, children: [
 { id: `${name}-bar-fill`, type: 'element', tag: 'div', props: { 'aria-hidden': true, style: { width: `{deviceResources.${name}Width}%` } }, css: { height: '100%', background: 'var(--tt-accent, #7864d9)' } }
 ] }
] });
const row = (id: string, children: WebpageBlock[]): WebpageBlock => ({ id, type: 'element', tag: 'div', css: { display: 'flex', 'flex-wrap': 'wrap', 'align-items': 'center', gap: '6px' }, children });
const when = (id: string, arg: string, children: WebpageBlock[]): WebpageBlock => ({ id, type: 'condition', condition: { arg, equals: true }, children });
const action = (operation: string, inputs: Record<string, unknown> = {}) => ({ 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation, ...inputs } });
const control = { 'min-height': '44px', padding: '8px 10px', border: '1px solid var(--tt-border, #dedee5)', 'border-radius': '9px', 'max-width': '100%', color: 'inherit', 'font-size': '14px', 'box-sizing': 'border-box' };
const quiet = { 'font-size': '13px', color: 'var(--tt-muted, #62626e)', margin: '0' };
const button = (id: string, label: string, operation: string, props: Record<string, unknown> = {}, inputs: Record<string, unknown> = {}): WebpageBlock =>
 ({ ...text(id, 'button', label, { type: 'button', ...action(operation, inputs), ...props }), css: control });
const windowControls = { ...row('device-history-window-controls', [
 ...deviceResourceWindows.map(([id, label]) => ({
  ...button('device-history-window-' + id, label, 'select-history-window', {
   'aria-pressed': '{deviceResources.history.pressed.' + id + '}', disabled: '{deviceResources.history.disabled}',
   style: { background: '{deviceResources.history.backgrounds.' + id + '}' }
  }, { id }),
  css: { ...control, 'font-weight': '600' }
 })),
 button('device-history-refresh', '{deviceResources.history.refreshLabel}', 'refresh-resources', { 'aria-disabled': '{deviceResources.history.refreshDisabled}' }),
 { ...text('device-history-working', 'span', '{deviceResources.history.workingLabel}', { role: 'status' }), css: quiet }
]), props: { role: 'group', 'aria-label': 'Usage time range' } } as WebpageBlock;
const customDates = when('device-history-custom', 'deviceResources.history.showCustom', [
 { ...text('device-history-timezone', 'p', 'Enter local dates and times · {deviceResources.history.timezone}'), css: quiet },
 row('device-history-date-controls', [
  ...(['from', 'to'] as const).map(key => ({
   id: 'device-history-date-' + key, type: 'element' as const, tag: 'div', css: { display: 'grid', gap: '4px', 'min-width': '0' },
   children: [
    text('device-history-date-label-' + key, 'label', key === 'from' ? 'From' : 'To', { for: '{deviceResources.history.id}-' + key }),
    { id: 'device-history-date-input-' + key, type: 'element' as const, tag: 'input', props: {
     id: '{deviceResources.history.id}-' + key, name: 'device-history-' + key, 'aria-label': key === 'from' ? 'From' : 'To', type: 'datetime-local', value: '{deviceResources.history.custom.' + key + '}',
     ...action('history-' + key), disabled: '{deviceResources.history.disabled}'
    }, css: control }
   ]
  })),
  button('device-history-apply', 'Apply dates', 'history-apply', { disabled: '{deviceResources.history.disabled}' })
 ])
]);
const trends = { id: 'device-history-trends', type: 'element', tag: 'div', css: {
 display: 'grid', 'grid-template-columns': 'repeat(2, minmax(0, 1fr))', gap: '8px'
}, children: historyResourceMetrics.map(([metric, label]) => {
 const key = 'device-history-' + metric.toLowerCase();
 const path = 'deviceResources.history.series.' + metric;
 return { id: key, type: 'element', tag: 'div', css: {
  display: 'grid', gap: '5px', padding: '10px', border: '1px solid var(--tt-border, #dedee5)', 'border-radius': '10px', 'min-width': '0',
  ...(metric === 'memoryBytes' ? { 'grid-column': '1 / -1' } : {})
 }, children: [
  text(key + '-label', 'strong', label),
  { ...text(key + '-peak', 'p', 'Highest interval average: {' + path + '.peak}'), css: quiet },
  { id: key + '-plot', type: 'element', tag: 'div', props: { 'aria-hidden': true }, css: {
   display: 'grid', 'grid-auto-flow': 'column', 'grid-auto-columns': 'minmax(0, 1fr)', gap: '2px', height: '32px', overflow: 'hidden'
  }, children: [{ id: key + '-intervals', type: 'collection', props: { itemsPath: path + '.bars', transparent: true }, children: [
   { id: key + '-track', type: 'element', tag: 'div', props: { title: '{item.title}', style: { borderBottom: '{item.line}' } }, css: {
    display: 'flex', 'align-items': 'flex-end', height: '100%', 'min-width': '0'
   }, children: [{ id: key + '-bar', type: 'element', tag: 'div', props: { hidden: '{item.missing}', style: { height: '{item.height}' } },
    css: { 'min-height': '2px', width: '100%', 'border-radius': '2px 2px 0 0', background: 'var(--tt-accent, #7864d9)' } }] }
  ] }] },
  { ...text(key + '-coverage', 'p', '{' + path + '.coverage}'), css: quiet }
 ] } as WebpageBlock;
}) } as WebpageBlock;
const intervalReadings = { id: 'device-history-readings', type: 'element', tag: 'details', children: [
 text('device-history-readings-label', 'summary', 'Interval readings'),
 { id: 'device-history-readings-list', type: 'element', tag: 'ol', css: { margin: '8px 0 0', padding: '0 0 0 20px' }, children: [
  { id: 'device-history-reading-intervals', type: 'collection', props: { itemsPath: 'deviceResources.history.rows', transparent: true }, children: [
   { id: 'device-history-reading-row', type: 'element', tag: 'li', css: { 'margin-bottom': '12px' }, children: [
    text('device-history-reading-time', 'strong', '{item.start} – {item.end}'),
    when('device-history-reading-empty', 'item.empty', [{ ...text('device-history-reading-none', 'p', 'No readings'), css: quiet }]),
    when('device-history-reading-measured', 'item.hasReadings', [row('device-history-reading-values', historyResourceMetrics.map(([metric, label]) =>
     ({ ...text('device-history-reading-' + metric.toLowerCase(), 'span', label + ': {item.' + metric + '}'), css: quiet })))])
   ] }
  ] }
 ] }
] } as WebpageBlock;
const historyControls = { id: 'device-resource-history', type: 'element', tag: 'div', css: { display: 'grid', gap: '8px', 'min-width': '0' }, children: [
 windowControls, customDates,
 when('device-history-view', 'deviceResources.history.showHistory', [
  { ...text('device-history-status', 'p', '{deviceResources.history.status}', { role: 'status' }), css: { margin: '0', 'min-height': '1.5em' } },
  when('device-history-recording-warning', 'deviceResources.history.recordingIssue', [text('device-history-recording-warning-text', 'p', 'Some Sync observations could not be saved on the source device.')]),
  when('device-history-data', 'deviceResources.history.hasData', [
   { ...text('device-history-range', 'p', '{deviceResources.history.start} – {deviceResources.history.end}'), css: quiet },
   trends, intervalReadings
  ])
 ]),
 when('device-live-measurement-time', 'deviceResources.history.showLive', [{ ...text('device-resource-measured-at', 'p', '{deviceResources.measurement}'), css: quiet }])
] } as WebpageBlock;

const liveOnlyIds = new Set(['device-resource-status', 'device-resource-bars', 'device-resource-directions']);
const editableLiveOnly = (block: WebpageBlock): WebpageBlock => liveOnlyIds.has(block.id)
 ? when(block.id + '-live', 'deviceResources.history.showLive', [block]) : block;

/** Older saved layouts gain the time controls without replacing edited blocks. */
export function migrateDeviceSyncResourceBlocks(blocks: WebpageBlock[]): WebpageBlock[] {
 const contains = (blocks: WebpageBlock[]): boolean => blocks.some(block => block.id === historyControls.id || contains(block.children ?? []));
 if (contains(blocks)) return blocks;
 const visit = (block: WebpageBlock): WebpageBlock => {
  const children = block.children?.map(visit);
  if (block.id === 'device-sync-resource-dashboard') {
   const next = children ?? [];
   const title = next.findIndex(child => child.id === 'device-resource-title');
   return { ...block, children: [...next.slice(0, title + 1), historyControls, ...next.slice(title + 1)] };
  }
  return editableLiveOnly(children ? { ...block, children } : block);
 };
 const migrated = blocks.map(visit);
 return contains(migrated) ? migrated : [...migrated, historyControls];
}
export const deviceSyncResourceBlocks: WebpageBlock[] = migrateDeviceSyncResourceBlocks([{ id: 'device-sync-resource-dashboard', type: 'element', tag: 'section', props: { 'aria-label': 'Total device sync resource usage' }, css: { padding: '16px', border: '1px solid var(--tt-border, #dedee5)', 'border-radius': '16px', background: 'var(--tt-panel, #fff)', display: 'grid', gap: '12px', 'min-width': '0', 'overflow-wrap': 'anywhere', 'margin-bottom': '16px' }, children: [
 text('device-resource-title', 'h2', 'Total Sync & Backup usage'),
 { ...text('device-resource-status', 'p', '{deviceResources.status}'), css: { 'min-height': '1.5em' } },
 { id: 'device-resource-bars', type: 'element', tag: 'div', css: { display: 'grid', 'grid-template-columns': 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: '16px' }, children: [meter('transfer', 'Upload + download'), meter('scan', 'File-content scan'), meter('cpu', 'Sync CPU'), meter('memory', 'Indexer memory')] },
 text('device-resource-directions', 'p', '{deviceResources.directions}'),
 text('device-resource-scope', 'p', '{deviceResources.policyDescription}'),
 { id: 'device-resource-settings', type: 'element', tag: 'details', props: { hidden: '{deviceResources.targetsUnavailable}' }, children: [text('device-resource-settings-summary', 'summary', 'Device resource targets'),
 ...(['transfer', 'scan', 'cpu'] as const).flatMap(name => [text(`${name}-target-label`, 'label', name === 'cpu' ? 'CPU target (%)' : name === 'scan' ? 'Scan budget (Mbps)' : 'Shared transfer budget (Mbps)', { for: `{deviceResources.${name}Id}` }),
 { id: `${name}-target-input`, type: 'element', tag: 'input', props: { id: `{deviceResources.${name}Id}`, name, type: 'number', min: name === 'cpu' ? 1 : '0.000001', ...(name === 'cpu' ? { max: 100 } : {}), step: name === 'cpu' ? 1 : 'any', value: `{deviceResources.${name}Target}`, disabled: '{deviceResources.disabled}', 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation: `target-${name}` }, 'aria-label': name === 'cpu' ? 'CPU target (%)' : `${name} budget (Mbps)` }, css: { display: 'block', width: '100%', 'box-sizing': 'border-box', 'min-width': '0', 'min-height': '40px', padding: '8px', 'margin-bottom': '8px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '8px' } } as WebpageBlock]),
 { ...text('device-resource-save', 'button', 'Save device targets', { type: 'button', disabled: '{deviceResources.disabled}', 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation: 'save-targets' } }), css: { 'min-height': '44px', padding: '10px 16px', background: 'var(--tt-accent, #7864d9)', color: '#fff', 'border-radius': '8px', 'font-weight': '600', cursor: 'pointer', 'justify-self': 'start' } },
 text('device-resource-persistence', 'p', 'Saved for this device, account and server. Lower connection limits still apply. Transfer changes apply to subsequent chunks; active scan and CPU capture budgets update when the next capture starts. No paused connection is resumed.'),
 text('device-resource-error', 'p', '{deviceResources.error}', { role: 'status' }) ] }
]}]);

export function withDeviceResourceAvailability(blocks: WebpageBlock[]): WebpageBlock[] {
 const visit = (block: WebpageBlock): WebpageBlock => ({ ...block,
  ...(block.id === 'device-resource-scope' && block.text === 'Device-wide budgets are shared by all connections, including background runs. CPU is an adaptive target for Sync work, as a share of total device CPU capacity. Directory discovery is paced by CPU and worker backpressure; Mbps measures file-content reads.' ? { text: '{deviceResources.policyDescription}' } : {}),
  ...(block.id === 'device-resource-settings' ? { props: { ...block.props, hidden: '{deviceResources.targetsUnavailable}' } } : {}),
  ...(block.children ? { children: block.children.map(visit) } : {})
 });
 return blocks.map(visit);
}
