import React from 'react';
import { Box } from '@chakra-ui/react';
import { getElectronBridge, type ThingtimeNativeActivitySnapshot } from '~/utils/electronBridge';
import { activityCatalog } from '~/activity/activityCatalog';
import { activityManager } from '~/activity/activityManager';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { TransientBlockHost } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { activityBlocks } from './activityBlocks';

export function ActivityManagerPage() {
	React.useEffect(() => {
		for (const spec of activityCatalog) activityManager.define(spec);
	}, []);
	const rows = React.useSyncExternalStore(activityManager.subscribe, activityManager.read, activityManager.read);
	const [error, setError] = React.useState('');
	const bridge = getElectronBridge();
	const nativeSupported = bridge?.activityVersion === '1.0.0' && !!bridge.activityRequest;
	const [native, setNative] = React.useState<ThingtimeNativeActivitySnapshot>();
	const [nativeBusy, setNativeBusy] = React.useState(false);
	const busy = React.useRef(false),
		alive = React.useRef(true);
	const readNative = React.useCallback(async () => {
		if (!nativeSupported || busy.current) return;
		busy.current = true;
		setNativeBusy(true);
		try {
			const value = await bridge!.activityRequest!({ version: '1.0.0', action: 'list' });
			if (value.version !== '1.0.0') throw Error('Update Thingtime to inspect native activities.');
			if (alive.current) {
				setNative(value);
				setError('');
			}
		} catch (cause) {
			if (alive.current) setError(cause instanceof Error ? cause.message : 'Native activity inventory is unavailable.');
		} finally {
			busy.current = false;
			if (alive.current) setNativeBusy(false);
		}
	}, [bridge, nativeSupported]);
	React.useEffect(() => {
		alive.current = true;
		void readNative();
		return () => {
			alive.current = false;
		};
	}, [readNative]);
	const rendered = rows.map((row) => ({
		...row,
		action: row.essential ? 'Required lifecycle guard' : row.enabled ? 'Disable permanently' : 'Enable activity',
		metrics: `${row.running} active / ${row.instances} mounted · ${row.calls} executions · ${row.failures} failures · ${Math.round(
			row.durationMs
		)} ms observed callback time${row.lastRun ? ` · Last ran ${new Date(row.lastRun).toLocaleTimeString()}` : ''}`
	}));
	const nativeRows = (native?.activities ?? []).map((row) => ({
		id: `native:${row.id}`,
		title: row.label,
		kind: `${row.scope} · ${row.kind}`,
		state: row.running === null ? 'Running state unavailable' : row.running ? 'Running' : 'Stopped',
		detail: row.description,
		essential: !row.controllable || nativeBusy,
		enabled: row.enabled,
		action: !row.controllable
			? 'Required native guard'
			: !row.enabled && row.running
			? 'Retry disable'
			: row.enabled
			? 'Disable permanently'
			: 'Enable activity',
		metrics: `Saved preference: ${row.enabled ? 'enabled' : 'disabled'} · Observed ${new Date(native!.collectedAt).toLocaleTimeString()}`
	}));
	const metric = native?.metrics;
	const nativeStatus = metric
		? `Electron: ${metric.processCount} processes · CPU ${metric.cpuPercent === null ? 'unavailable' : metric.cpuPercent.toFixed(1) + '%'} · Memory ${
				metric.rssBytes === null ? 'unavailable' : (metric.rssBytes / 1024 / 1024).toFixed(1) + ' MiB'
		  } · Measured ${new Date(native!.collectedAt).toLocaleTimeString()}`
		: nativeSupported
		? 'Reading native service inventory…'
		: 'Open this view in an updated Thingtime desktop app to inspect native services.';
	return (
		<Box width="100%" minHeight="100vh" paddingTop="calc(var(--tt-nav-clearance, 54px) + 24px)" paddingX={[4, 6]} paddingBottom={16}>
			<Box maxWidth="1000px" marginX="auto" minWidth={0}>
				<SettingsDocumentHost
					documentKey="activity-manager"
					defaultDocument={activityBlocks}
					scopeKey="device-activity"
					title="Activity manager layout"
				>
					{({ blocks, chrome, editing }) => (
						<TransientBlockHost
							scopeKey="device-activity"
							enabled={!editing}
							scope={{
								activity: {
									rows: [...nativeRows, ...rendered],
									nativeStatus,
									nativeUnavailable: !nativeSupported || nativeBusy,
									error,
									summary: `${rows.filter((row) => row.running > 0).length} active activities · ${
										rows.filter((row) => !row.enabled).length
									} disabled`,
									coverage:
										'Window activities stop their actual timers or subscriptions. Callback time is elapsed time, not CPU usage. Native services have independent lifetimes and group controls. ' +
										(native?.limitations.join(' ') || 'Server jobs and external applications are outside this window inventory.')
								}
							}}
							actions={{
								'refresh-native': readNative,
								toggle: async ({ inputs }) => {
									if (typeof inputs.id === 'string' && inputs.id.startsWith('native:')) {
										const row = native?.activities.find((value) => `native:${value.id}` === inputs.id);
										if (!row?.controllable || !nativeSupported || busy.current) return;
										busy.current = true;
										setNativeBusy(true);
										try {
											const value = await bridge!.activityRequest!({
												version: '1.0.0',
												action: 'set-enabled',
												id: row.id,
												enabled: !row.enabled && row.running !== true
											});
											if (alive.current) {
												setNative(value);
												setError('');
											}
										} catch (cause) {
											if (alive.current) setError(cause instanceof Error ? cause.message : 'Could not change native activity.');
										} finally {
											busy.current = false;
											if (alive.current) {
												setNativeBusy(false);
												void readNative();
											}
										}
										return;
									}
									const row = activityManager.read().find((value) => value.id === inputs.id);
									if (!row) {
										setError('This activity is no longer registered.');
										return;
									}
									try {
										activityManager.setEnabled(row.id, !row.enabled);
										setError('');
									} catch (cause) {
										setError(cause instanceof Error ? cause.message : 'Could not save this activity preference.');
									}
								}
							}}
						>
							<WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} />
						</TransientBlockHost>
					)}
				</SettingsDocumentHost>
			</Box>
		</Box>
	);
}
