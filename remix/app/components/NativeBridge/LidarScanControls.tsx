import React from 'react';
import type { WebpageBlock } from '../Builder/webpageBlocks';
import { TransientBlockHost } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useLidarScanControls } from './LidarScanProvider';

const buttonStyle = {
	display: 'inline-flex', 'min-height': '44px', 'align-items': 'center', 'justify-content': 'center',
	'max-width': '100%', 'white-space': 'normal', padding: '8px 12px', border: '1px solid var(--tt-border, #d4d4d8)',
	'border-radius': '8px', color: 'inherit', background: 'var(--tt-card, white)'
};
const button = (id: string, text: string, operation: string): WebpageBlock => ({
	id, type: 'element', tag: 'button', text,
	props: { type: 'button', disabled: '{scan.busy}', 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation } },
	css: buttonStyle
});
const when = (id: string, key: string, child: WebpageBlock): WebpageBlock => ({
	id, type: 'condition', condition: { arg: `scan.${key}`, equals: true }, children: [child]
});
const blocks: WebpageBlock[] = [{
	id: 'lidar-scan', type: 'element', tag: 'section', props: { 'aria-label': 'LiDAR scan' },
	css: { display: 'grid', gap: '8px', 'min-width': '0', padding: '12px', border: '1px solid var(--tt-border, #d4d4d8)',
		'border-radius': '12px', background: 'var(--tt-card, white)', 'overflow-wrap': 'anywhere' },
	children: [
		{ id: 'lidar-title', type: 'element', tag: 'h2', text: 'LiDAR scan', css: { margin: '0', 'font-weight': '600' } },
		{ id: 'lidar-description', type: 'element', tag: 'p', text: 'Capture a space with Thingtime on an iPhone or iPad with LiDAR. Your scan saves to the device first, then to your private Things.',
			css: { margin: '0', color: 'var(--tt-muted, #64646d)' } },
		{ id: 'lidar-controls', type: 'container', direction: 'row', gap: 8, css: { 'flex-wrap': 'wrap', 'align-items': 'center' }, children: [
			when('lidar-start-visible', 'showStart', button('lidar-start', 'Scan with LiDAR', 'start')),
			when('lidar-handoff-visible', 'showHandoff', button('lidar-handoff', 'Open Thingtime scanner', 'start')),
			when('lidar-retry-visible', 'showRetry', button('lidar-retry', 'Retry save', 'retry')),
			when('lidar-check-visible', 'showCheck', button('lidar-check', 'Check scanner status', 'check')),
			when('lidar-saved-visible', 'hasFile', { id: 'lidar-saved', type: 'element', tag: 'a',
				text: 'Open saved scan', props: { href: '{scan.fileHref}' }, css: buttonStyle }),
			when('lidar-indicator-visible', 'busy', { id: 'lidar-indicator', type: 'element', tag: 'span',
				props: { class: 'ttLidarIndicator', role: 'status', 'aria-label': '{scan.busyLabel}' },
				css: { display: 'inline-block', width: '12px', height: '12px', border: '2px solid var(--tt-border, #d4d4d8)',
					'border-top-color': 'var(--tt-accent, currentColor)', 'border-radius': '50%' } })
		] },
		when('lidar-message-visible', 'hasMessage', { id: 'lidar-message', type: 'element', tag: 'p', text: '{scan.message}',
			props: { role: 'status' }, css: { margin: '0', color: 'var(--tt-muted, #64646d)' } })
	]
}];

export function LidarScanControls({ onSaved }: { onSaved?: () => void }) {
	const controls = useLidarScanControls();
	const user = useCurrentUser();
	const fileId = controls?.snapshot.result?.fileThingId;
	const checkOnMount = controls?.mode === 'native' && controls.ownerId === user?.id ? controls.check : undefined;
	React.useEffect(() => { checkOnMount?.(); }, [checkOnMount]);
	const savedRef = React.useRef(onSaved);
	savedRef.current = onSaved;
	React.useEffect(() => {
		if (fileId && controls?.ownerId === user?.id) savedRef.current?.();
	}, [fileId, controls?.ownerId, user?.id]);
	if (!controls || !user?.id || controls.ownerId !== user.id) return null;
	const { mode, snapshot, handoff, generation, start, retry, check } = controls;
	const { result, waiting, connectionError } = snapshot;
	const busy = mode === 'native' && (!!waiting || result?.state === 'saving' || (!result && !connectionError));
	const busyLabel = result?.state === 'saving' || waiting === 'retry' ? 'Saving LiDAR scan' : 'Connecting to LiDAR scanner';
	const message = mode === 'outdated' ? 'Update the Thingtime iOS app to use LiDAR scanning.' :
		mode === 'browser' && handoff ? 'Use the signed-in account shown in the app. If it did not open, install or update the Thingtime iOS app.' :
		connectionError || (result?.supported === false ? 'LiDAR scanning requires a supported iPhone or iPad.' :
			result?.state === 'capturing' ? 'The scanner is open in Thingtime.' :
			result?.state === 'saved' ? (result.isPartial ? 'Partial scan saved to your private Things.' : 'Saved to your private Things.') :
			result?.state === 'pending' ? (result.isPartial ? 'Partial scan saved on this device. Retry to save it to Things.' :
				result.error || 'Saved on this device. Retry to finish saving to Things.') :
			result?.state === 'cancelled' ? 'Scan cancelled.' :
			result?.state === 'error' ? result.error || 'Could not open the scanner. Try again.' : '');
	const fileHref = fileId ? `/thing/${encodeURIComponent(fileId)}?from=things` : '';
	const scopeKey = `${user.id}:${generation}`;
	const scan = {
		busy, busyLabel, fileHref, message: [message, result?.detail].filter(Boolean).join(' '), hasMessage: !!message, hasFile: !!fileHref,
		showStart: mode === 'native' && result?.supported === true && result.state !== 'pending' && result.state !== 'capturing' && !connectionError,
		showHandoff: mode === 'browser', showRetry: !connectionError && result?.state === 'pending', showCheck: !!connectionError
	};
	return <SettingsDocumentHost documentKey="lidar-scan-controls" defaultDocument={blocks} scopeKey={scopeKey} title="LiDAR scan layout"
		editLayoutLabel="Edit scan layout" layoutEditingDisabled={busy || result?.state === 'capturing'}>
		{({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={scopeKey} enabled={!editing}
			actions={{
				start: () => { start(user.id); }, retry: () => { retry(); }, check: () => { check(); }
			}}
			scope={{ scan }}>
			<style>{`
				.ttLidarIndicator { animation: ttLidarSpin .8s linear infinite; }
				@keyframes ttLidarSpin { to { transform: rotate(360deg); } }
				@media (prefers-reduced-motion: reduce) { .ttLidarIndicator { animation: none; } }
			`}</style>
			<WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} interactive={!editing} bare />
		</TransientBlockHost>}
	</SettingsDocumentHost>;
}
