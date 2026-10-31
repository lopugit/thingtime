import type { WebpageBlock } from '../Builder/webpageBlocks';
import type { FileSyncResourceLimits } from '~/fileSync/configuration';
export const SYNC_SPEED_UNITS = { Kbps: 125, Mbps: 125000, Gbps: 125000000 } as const;
export type SyncSpeedUnit = keyof typeof SYNC_SPEED_UNITS;
export type SyncResourceDraft = { upload: string; uploadUnit: SyncSpeedUnit; download: string; downloadUnit: SyncSpeedUnit; transferConcurrency: string; indexingConcurrency: string; cpuPercent: string };
function speedDraft(value?: number): { text: string; unit: SyncSpeedUnit } {
 const unit = value && value >= SYNC_SPEED_UNITS.Gbps ? 'Gbps' : value && value >= SYNC_SPEED_UNITS.Mbps ? 'Mbps' : 'Kbps';
 return { text: value === undefined ? '' : String(value / SYNC_SPEED_UNITS[unit]), unit };
}
export function syncResourceDraft(limits?: FileSyncResourceLimits): SyncResourceDraft {
 const upload = speedDraft(limits?.uploadBytesPerSecond), download = speedDraft(limits?.downloadBytesPerSecond);
 return { upload: upload.text, uploadUnit: upload.unit, download: download.text, downloadUnit: download.unit,
 transferConcurrency: limits?.transferConcurrency === undefined ? '' : String(limits.transferConcurrency),
 indexingConcurrency: limits?.indexingConcurrency === undefined ? '' : String(limits.indexingConcurrency), cpuPercent: limits?.cpuPercent === undefined ? '' : String(limits.cpuPercent) };
}
/** Convert the user's exact decimal to bytes/sec, rounding downward only when
 * IEEE multiplication would otherwise exceed that decimal ceiling. */
export function syncSpeedBytes(text: string, unit: SyncSpeedUnit): number | undefined {
 text = text.trim(); if (!text) return undefined;
 if (!Object.prototype.hasOwnProperty.call(SYNC_SPEED_UNITS, unit) || !/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) throw Error('Enter a positive speed or leave it blank for unlimited.');
 const numeric = Number(text), result = numeric * SYNC_SPEED_UNITS[unit];
 if (!Number.isFinite(result) || result <= 0) throw Error('Enter a finite positive speed.');
 const [mantissa, exponentText = '0'] = text.toLowerCase().split('e'), exponent = Number(exponentText), decimals = (mantissa.split('.')[1] ?? '').length;
 if (Math.abs(exponent) > 1000) throw Error('Enter a representable positive speed.');
 let numerator = BigInt(mantissa.replace('.', '')) * BigInt(SYNC_SPEED_UNITS[unit]), denominator = BigInt(1);
 const shift = exponent - decimals; if (shift >= 0) numerator *= BigInt(10) ** BigInt(shift); else denominator = BigInt(10) ** BigInt(-shift);
 const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, result); const bits = view.getBigUint64(0), power = Number((bits >> BigInt(52)) & BigInt(2047)) - 1023 - 52;
 let actualNumerator = (bits & ((BigInt(1) << BigInt(52)) - BigInt(1))) + (((bits >> BigInt(52)) & BigInt(2047)) ? BigInt(1) << BigInt(52) : BigInt(0)), actualDenominator = BigInt(1);
 const actualPower = ((bits >> BigInt(52)) & BigInt(2047)) ? power : -1074;
 if (actualPower >= 0) actualNumerator <<= BigInt(actualPower); else actualDenominator <<= BigInt(-actualPower);
 if (actualNumerator * denominator > numerator * actualDenominator) { view.setBigUint64(0, bits - BigInt(1)); const lower = view.getFloat64(0); if (lower <= 0) throw Error('Enter a representable positive speed.'); return lower; }
 return result;
}
export function parseSyncResourceDraft(draft: SyncResourceDraft): FileSyncResourceLimits | undefined {
 const result: FileSyncResourceLimits = {};
 const upload = syncSpeedBytes(draft.upload, draft.uploadUnit), download = syncSpeedBytes(draft.download, draft.downloadUnit);
 if (upload !== undefined) result.uploadBytesPerSecond = upload; if (download !== undefined) result.downloadBytesPerSecond = download;
 for (const [key, label] of [['transferConcurrency', 'Transfer concurrency'], ['indexingConcurrency', 'Indexing concurrency'], ['cpuPercent', 'CPU target']] as const) {
  const text = draft[key].trim(); if (!text) continue; const number = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(number) || number < 1 || (key === 'cpuPercent' && number > 100)) throw Error(`${label} must be ${key === 'cpuPercent' ? 'an integer from 1 to 100' : 'a positive safe integer'}, or blank for the default.`);
  result[key] = number;
 }
 return Object.keys(result).length ? result : undefined;
}
export const syncResourceOperation = (name: string) => name.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase());
const action = (name: string) => ({ 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation: syncResourceOperation(name) } });
const control = { 'min-height': '40px', padding: '8px 12px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '8px', 'max-width': '100%', 'box-sizing': 'border-box', 'min-width': '0' };
const text = (id: string, tag: string, content: string, props: Record<string, unknown> = {}): WebpageBlock => ({ id, type: 'element', tag, text: content, props });
function field(name: string, label: string, placeholder: string): WebpageBlock[] {
 const id = name.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase());
 return [text(`${id}-label`, 'label', label, { for: `{resources.ids.${name}}` }), { id: `${id}-input`, type: 'element', tag: 'input', props: { id: `{resources.ids.${name}}`, name, type: 'text', inputmode: name === 'upload' || name === 'download' ? 'decimal' : 'numeric', value: `{resources.${name}}`, placeholder, disabled: '{resources.disabled}', 'aria-label': label, ...action(name) }, css: { ...control, width: '100%' } }];
}
function speed(name: 'upload' | 'download', label: string): WebpageBlock {
 return { id: `${name}-group`, type: 'element', tag: 'div', css: { display: 'grid', gap: '6px', 'min-width': '0' }, children: [
 ...field(name, label, 'Unlimited'), text(`${name}-unit-label`, 'label', `${label} unit`, { for: `{resources.ids.${name}Unit}` }),
 { id: `${name}-unit`, type: 'element', tag: 'select', props: { id: `{resources.ids.${name}Unit}`, name: `${name}Unit`, value: `{resources.${name}Unit}`, disabled: '{resources.disabled}', 'aria-label': `${label} unit`, ...action(`${name}Unit`) }, css: control,
 children: Object.keys(SYNC_SPEED_UNITS).map(unit => text(`${name}-${unit.toLowerCase()}`, 'option', unit, { value: unit })) } ] };
}
export const syncResourceControlsBlocks: WebpageBlock[] = [{ id: 'sync-resources', type: 'element', tag: 'fieldset', props: { 'aria-label': 'Sync resource limits' }, css: { 'min-width': '0', padding: '12px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '12px', display: 'grid', gap: '8px' }, children: [
 text('resources-title', 'legend', 'Resource limits'),
 text('resources-help', 'p', 'Optional ceilings apply to this connection across all its files and folders. Leave a field blank for unlimited speed or the existing concurrency and CPU defaults.'),
 speed('upload', 'Upload speed'), speed('download', 'Download speed'),
 text('speed-help', 'p', 'Kbps, Mbps and Gbps use decimal bits per second: 1 Mbps = 1,000,000 bits/s = 125,000 bytes/s. Limits cover aggregate transferred payload.'),
 ...field('transferConcurrency', 'Maximum simultaneous file and folder transfers', 'Default'),
 ...field('indexingConcurrency', 'Maximum indexing workers', 'Default'),
 ...field('cpuPercent', 'CPU target (%)', 'Default'),
 text('cpu-help', 'p', 'The CPU target is 1–100% of total available CPU capacity, measured only for this sync workload. Above the target, sync reduces pace and eligible concurrency and recovers gradually below it. Hardware, safety and CPU backpressure may use less than your ceilings. Unavailable CPU measurements remain unknown.'),
 text('resources-error', 'p', '{resources.error}', { role: 'alert' })
]}];
