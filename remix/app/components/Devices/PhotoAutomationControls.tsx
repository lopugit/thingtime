import React from 'react';
import { DEFAULT_PHOTO_AUTOMATION, type FileSyncConfiguration } from '~/fileSync/configuration';
import type { ConfigurationDraft } from '~/fileSync/configurationEditor';
import { TransientBlockHost } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { findBlock, type WebpageBlock } from '../Builder/webpageBlocks';
import { SettingsDocumentHost, type SettingsDocumentHostProps } from '../Settings/SettingsDocumentHost';
import { syncResourceAction, syncResourceControlStyle, syncResourceField, syncResourceOperation } from './syncResourceControlsBlocks';

type Policy = NonNullable<FileSyncConfiguration['photoAutomation']>;
type Draft = NonNullable<ConfigurationDraft['photoAutomationDraft']>;
const speeds = { Mbps: 125_000, 'MB/s': 1_000_000 } as const;
const volumes = { MB: 1_000_000, GB: 1_000_000_000 } as const;

function displayBytes(value: number | undefined, multiplier: number): string {
	if (value === undefined) return '';
	const bytes = BigInt(value), unit = BigInt(multiplier);
	const whole = bytes / unit;
	let remainder = bytes % unit, fraction = '';
	while (remainder) {
		remainder *= BigInt(10);
		fraction += String(remainder / unit);
		remainder %= unit;
	}
	return fraction ? `${whole}.${fraction}` : String(whole);
}

function draftFrom(policy?: Policy): Draft {
	const dataUnit = (policy?.uploadBytesPerHour ?? 0) >= volumes.GB ? 'GB' : 'MB';
	return {
		speed: displayBytes(policy?.uploadBytesPerSecond, speeds.Mbps),
		speedUnit: 'Mbps',
		data: displayBytes(policy?.uploadBytesPerHour, volumes[dataUnit]),
		dataUnit,
		notificationIntervalMs: String((policy?.notificationIntervalMs ?? DEFAULT_PHOTO_AUTOMATION.notificationIntervalMs) / 60_000)
	};
}

function decimalBytes(text: string, multiplier: number, label: string): number | undefined {
	const normalized = text.trim();
	if (!normalized) return undefined;
	if (normalized.length > 40 || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized))
		throw Error(`Enter a positive ${label} or leave it blank for the default.`);
	const [whole, fraction = ''] = normalized.split('.');
	const numerator = BigInt((whole || '0') + fraction) * BigInt(multiplier);
	const denominator = BigInt(10) ** BigInt(fraction.length);
	const value = Number(numerator / denominator);
	if (numerator % denominator !== BigInt(0) || !Number.isSafeInteger(value) || value <= 0)
		throw Error(`Enter a ${label} that converts to a positive whole number of bytes.`);
	return value;
}

function parseDraft(draft: Draft): Policy {
	const uploadBytesPerSecond = decimalBytes(draft.speed, speeds[draft.speedUnit], 'upload speed');
	const uploadBytesPerHour = decimalBytes(draft.data, volumes[draft.dataUnit], 'data budget');
	const notification = draft.notificationIntervalMs.trim();
	const notificationIntervalMs = Number(notification) * 60_000;
	if (!/^\d+$/.test(notification) || !Number.isSafeInteger(notificationIntervalMs))
		throw Error('Enter whole minutes for progress notifications, or 0 to turn them off.');
	return { notificationIntervalMs, uploadBytesPerSecond, uploadBytesPerHour };
}

const text = (id: string, tag: string, value: string, props: Record<string, unknown> = {}): WebpageBlock =>
	({ id, type: 'element', tag, text: value, props });
const units = (key: 'speedUnit' | 'dataUnit', label: string, values: string[]): WebpageBlock[] => {
	const id = 'photo-' + syncResourceOperation(key);
	return [
	text(`${id}-label`, 'label', label, { for: `{resources.ids.${key}}` }),
	{ id, type: 'element', tag: 'select',
		props: { id: `{resources.ids.${key}}`, 'aria-label': label, disabled: '{resources.disabled}', value: `{resources.${key}}`, ...syncResourceAction(key) },
		css: syncResourceControlStyle, children: values.map((value, index) => text(`${id}-${index}`, 'option', value, { value })) }
	];
};
const blocks: WebpageBlock[] = [{
	id: 'photo-backup-limits', type: 'element', tag: 'fieldset',
	props: { 'aria-label': 'Photos upload limits and notifications' },
	css: { display: 'grid', gap: '8px', 'min-width': '0', padding: '12px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '12px', 'overflow-wrap': 'anywhere' },
	children: [
		text('photo-backup-limits-heading', 'legend', 'Photos upload limits and notifications'),
		text('photo-backup-availability', 'p', '{resources.availability}'),
		...syncResourceField('speed', 'Maximum upload speed', 'Default', 'decimal'),
		...units('speedUnit', 'Upload speed unit', Object.keys(speeds)),
		text('photo-backup-speed-help', 'p', `Mbps measures megabits per second. MB/s measures megabytes per second. A blank speed uses the default of ${DEFAULT_PHOTO_AUTOMATION.uploadBytesPerSecond / speeds.Mbps} Mbps.`),
		...syncResourceField('data', 'Upload data per hour', 'No hourly limit', 'decimal'),
		...units('dataUnit', 'Hourly data unit', Object.keys(volumes)),
		text('photo-backup-data-help', 'p', '1 GB = 1,000 MB. These limits apply to uploads managed by Thingtime. Apple manages downloads from iCloud.'),
		...syncResourceField('notificationIntervalMs', 'Progress notification interval (minutes)', '30'),
		text('photo-backup-notification-help', 'p', 'Progress notifications report confirmed photos and videos and upload bytes by network when available. Enter 0 to turn them off. iOS notification permission is required.'),
		{ id: 'photo-backup-policy-error-state', type: 'condition', condition: { arg: 'resources.hasError', equals: true },
			children: [text('photo-backup-policy-error', 'p', '{resources.error}', { role: 'alert' })] }
	]
}];

const legacyLabels = structuredClone(blocks);
// Match exact stock nodes so saved custom wording and layouts remain untouched.
const speedLabel = (nodes: WebpageBlock[]): void => {
 for (const node of nodes) {
  if (node.text === 'Maximum upload speed') node.text = 'Average upload speed';
  if (node.props?.['aria-label'] === 'Maximum upload speed') node.props['aria-label'] = 'Average upload speed';
  if (node.id === 'photo-backup-speed-help') node.text += ' Background transfers are scheduled to this average; individual transfers can be faster.';
  if (node.children) speedLabel(node.children);
 }
};
speedLabel(blocks);
export function migratePhotoAutomationLabels(nodes: WebpageBlock[]): WebpageBlock[] {
 return nodes.map(node => {
  const legacy = findBlock(legacyLabels, node.id), current = findBlock(blocks, node.id);
  if (legacy && current && JSON.stringify(legacy) === JSON.stringify(node)) return current;
  return node.children ? { ...node, children: migratePhotoAutomationLabels(node.children) } : node;
 });
}

export function PhotoAutomationControls({ policy, draft, disabled, availability, scopeKey, accountTransport, onChange, onValidityChange }: {
	policy?: Policy;
	draft?: Draft;
	disabled: boolean;
	availability: string;
	scopeKey: string;
	accountTransport?: SettingsDocumentHostProps['accountTransport'];
	onChange(draft: Draft, policy?: Policy): void;
	onValidityChange?(valid: boolean): void;
}) {
	const prefix = React.useId();
	const current = draft ?? draftFrom(policy);
	let error = '';
	try { parseDraft(current); }
	catch (cause) { error = cause instanceof Error ? cause.message : 'Correct the saved upload settings.'; }
	const validity = React.useRef(onValidityChange);
	validity.current = onValidityChange;
	React.useEffect(() => { validity.current?.(!error); }, [error, scopeKey]);
	const keys = ['speed', 'speedUnit', 'data', 'dataUnit', 'notificationIntervalMs'] as const;
	const ids = Object.fromEntries(keys.map(key => [key, `${prefix}-${key}`]));
	const change = (key: keyof Draft, value: unknown) => {
		if (disabled || typeof value !== 'string') return;
		if ((key === 'speedUnit' && !Object.prototype.hasOwnProperty.call(speeds, value)) ||
			(key === 'dataUnit' && !Object.prototype.hasOwnProperty.call(volumes, value))) return;
		const next = { ...current, [key]: value };
		try {
			if (key === 'speedUnit') next.speed = displayBytes(decimalBytes(current.speed, speeds[current.speedUnit], 'upload speed'), speeds[next.speedUnit]);
			if (key === 'dataUnit') next.data = displayBytes(decimalBytes(current.data, volumes[current.dataUnit], 'data budget'), volumes[next.dataUnit]);
		} catch { /* Keep incomplete input available to correct. */ }
		let parsed: Policy;
		try { parsed = parseDraft(next); }
		catch { onChange(next); return; }
		// Unit and cadence edits should not round an untouched stored ceiling.
		if (policy?.uploadBytesPerSecond !== undefined && next.speed === current.speed && next.speedUnit === current.speedUnit)
			parsed.uploadBytesPerSecond = policy.uploadBytesPerSecond;
		if (policy?.uploadBytesPerHour !== undefined && next.data === current.data && next.dataUnit === current.dataUnit)
			parsed.uploadBytesPerHour = policy.uploadBytesPerHour;
		onChange(next, parsed);
	};
	return <SettingsDocumentHost documentKey="photo-backup-automation-controls" defaultDocument={blocks} migrateBlocks={migratePhotoAutomationLabels} scopeKey={scopeKey} title="Photos backup settings" accountTransport={accountTransport}>
		{({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={scopeKey} enabled={!editing}
			scope={{ resources: { ...current, ids, disabled, availability, error, hasError: !!error } }}
			actions={Object.fromEntries(keys.map(key => [syncResourceOperation(key), ({ value }: { value?: unknown }) => change(key, value)]))}>
			<WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} />
		</TransientBlockHost>}
	</SettingsDocumentHost>;
}
