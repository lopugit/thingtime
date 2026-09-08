import React from 'react';
import { Button, Switch, Text } from '@chakra-ui/react';
import { SettingRow, SettingsSection } from './SettingsSection';
import { mediaCacheMessage, mediaPreferences, setMediaPreferences, type MediaCacheStatus } from '~/utils/mediaCache.client';

export function MediaCacheSettings() {
	const [preferences, setPreferences] = React.useState(mediaPreferences);
	const [status, setStatus] = React.useState<MediaCacheStatus | null>(null);
	const [clearing, setClearing] = React.useState(false);
	React.useEffect(() => {
		const refresh = () => void mediaCacheMessage('tt-media-status').then(setStatus);
		refresh();
		const timer = setInterval(refresh, 3000);
		return () => clearInterval(timer);
	}, []);
	const update = (key: 'cache' | 'previews', value: boolean) => {
		const next = { ...preferences, [key]: value };
		setPreferences(next);
		setMediaPreferences(next);
	};
	return (
		<SettingsSection
			eyebrow="Media & downloads"
			description="Preferences for this browser. Reuse media when revisiting pages and load smaller image previews first."
		>
			<SettingRow
				label="Remember loaded media"
				hint="Up to 128 MiB per storage backend for 7 days. Images, audio, videos and files up to 16 MiB each; larger files keep native streaming. Protected files always recheck access."
			>
				<Switch aria-label="Remember loaded media" isChecked={preferences.cache} onChange={(event) => update('cache', event.target.checked)} />
			</SettingRow>
			<SettingRow
				label="Progressive image previews"
				hint="Show small previews while sharper images load. Applies when you next open media; original files stay available to download."
			>
				<Switch
					aria-label="Progressive image previews"
					isChecked={preferences.previews}
					onChange={(event) => update('previews', event.target.checked)}
				/>
			</SettingRow>
			<Text fontSize="xs" color="var(--tt-muted)">
				{status
					? `${(status.bytes / 1024 / 1024).toFixed(1)} MiB · ${status.entries} files · ${status.backend}`
					: 'Using browser caching until persistent media caching is available.'}
			</Text>
			<Button
				size="sm"
				variant="outline"
				isLoading={clearing}
				onClick={async () => {
					setClearing(true);
					try {
						setStatus(await mediaCacheMessage('tt-media-clear'));
					} finally {
						setClearing(false);
					}
				}}
			>
				Clear media cache
			</Button>
		</SettingsSection>
	);
}
