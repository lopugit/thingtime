import type { WebpageBlock } from '../Builder/webpageBlocks';
const text = (id: string, tag: string, value: string, props: Record<string, unknown> = {}): WebpageBlock => ({ id, type: 'element', tag, text: value, props });
const meter = (name: string, label: string): WebpageBlock => ({ id: `device-sync-${name}`, type: 'element', tag: 'div', css: { display: 'grid', 'grid-template-rows': 'auto 1fr 8px', gap: '6px', 'min-width': '0' }, children: [
 text(`${name}-label`, 'span', label), text(`${name}-reading`, 'strong', `{deviceResources.${name}Text}`),
 { id: `${name}-bar`, type: 'element', tag: 'div', props: { role: 'meter', 'data-resource-bar': name, 'aria-valuenow': `{deviceResources.${name}Value}`, 'aria-valuemin': 0, 'aria-valuemax': '{deviceResources.' + name + 'Max}', 'aria-label': label, 'aria-hidden': `{deviceResources.${name}Unknown}` }, css: { width: '100%', height: '8px', background: 'var(--tt-border, #dedee5)', 'border-radius': '5px', overflow: 'hidden' }, children: [
 { id: `${name}-bar-fill`, type: 'element', tag: 'div', props: { 'aria-hidden': true, style: { width: `{deviceResources.${name}Width}%` } }, css: { height: '100%', background: 'var(--tt-accent, #7864d9)' } }
 ] }
] });
export const deviceSyncResourceBlocks: WebpageBlock[] = [{ id: 'device-sync-resource-dashboard', type: 'element', tag: 'section', props: { 'aria-label': 'Total device sync resource usage' }, css: { padding: '16px', border: '1px solid var(--tt-border, #dedee5)', 'border-radius': '16px', background: 'var(--tt-panel, #fff)', display: 'grid', gap: '12px', 'min-width': '0', 'overflow-wrap': 'anywhere', 'margin-bottom': '16px' }, children: [
 text('device-resource-title', 'h2', 'Total Sync & Backup usage'),
 text('device-resource-status', 'p', '{deviceResources.status}'),
 { id: 'device-resource-bars', type: 'element', tag: 'div', css: { display: 'grid', 'grid-template-columns': 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: '16px' }, children: [meter('transfer', 'Upload + download'), meter('scan', 'File-content scan'), meter('cpu', 'Sync CPU'), meter('memory', 'Indexer memory')] },
 text('device-resource-directions', 'p', '{deviceResources.directions}'),
 text('device-resource-scope', 'p', 'Device-wide budgets are shared by all connections, including background runs. CPU is an adaptive target for Sync work, as a share of total device CPU capacity. Directory discovery is paced by CPU and worker backpressure; Mbps measures file-content reads.'),
 { id: 'device-resource-settings', type: 'element', tag: 'details', children: [text('device-resource-settings-summary', 'summary', 'Device resource targets'),
 ...(['transfer', 'scan', 'cpu'] as const).flatMap(name => [text(`${name}-target-label`, 'label', name === 'cpu' ? 'CPU target (%)' : name === 'scan' ? 'Scan budget (Mbps)' : 'Shared transfer budget (Mbps)', { for: `{deviceResources.${name}Id}` }),
 { id: `${name}-target-input`, type: 'element', tag: 'input', props: { id: `{deviceResources.${name}Id}`, name, type: 'number', min: name === 'cpu' ? 1 : '0.000001', ...(name === 'cpu' ? { max: 100 } : {}), step: name === 'cpu' ? 1 : 'any', value: `{deviceResources.${name}Target}`, disabled: '{deviceResources.disabled}', 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation: `target-${name}` }, 'aria-label': name === 'cpu' ? 'CPU target (%)' : `${name} budget (Mbps)` }, css: { display: 'block', width: '100%', 'box-sizing': 'border-box', 'min-width': '0', 'min-height': '40px', padding: '8px', 'margin-bottom': '8px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '8px' } } as WebpageBlock]),
 text('device-resource-save', 'button', 'Save device targets', { type: 'button', disabled: '{deviceResources.disabled}', 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation: 'save-targets' } }),
 text('device-resource-persistence', 'p', 'Saved for this device, account and server. Lower connection limits still apply. Transfer changes apply to subsequent chunks; scan changes apply when the next capture starts. No paused connection is resumed.'),
 text('device-resource-error', 'p', '{deviceResources.error}', { role: 'status' }) ] }
]}];
