import React from 'react';
import { Box, Button, Flex, Input, Text } from '@chakra-ui/react';

import { useLopu } from '../../Lopu/useLopu';
import {
	getElectronBridge,
	type ThingtimeDesktopCachedBundle,
	type ThingtimeDesktopRelease,
	type ThingtimeDesktopReleaseCatalog
} from '~/utils/electronBridge';

const releaseSearchText = (release: ThingtimeDesktopRelease) =>
	[release.branch, release.commit, release.name, release.tag, release.version, release.pullRequestNumber ? `pr ${release.pullRequestNumber}` : '']
		.filter(Boolean)
		.join(' ')
		.toLocaleLowerCase();

const releaseLabel = (release: ThingtimeDesktopRelease | ThingtimeDesktopCachedBundle) => release.version || release.tag || release.name || 'Unknown Thingtime release';

const cacheLabel = (bundle: ThingtimeDesktopCachedBundle) => [releaseLabel(bundle), bundle.branch ? `· ${bundle.branch}` : null, bundle.commit ? `· ${bundle.commit.slice(0, 12)}` : null].filter(Boolean).join(' ');

export const ElectronUpdateManager = () => {
	const lopu = useLopu();
	const [catalog, setCatalog] = React.useState<ThingtimeDesktopReleaseCatalog | null>(null);
	const [filter, setFilter] = React.useState('');
	const [loading, setLoading] = React.useState(false);
	const [busyKey, setBusyKey] = React.useState<string | null>(null);

	const refresh = React.useCallback(async (quiet = false) => {
		const bridge = getElectronBridge();
		if (!bridge?.listUpdateCatalog) {
			if (!quiet) lopu({ title: 'Release browser unavailable', description: 'This Thingtime build predates the recovery updater.', status: 'info', duration: 6000 });
			return;
		}
		setLoading(true);
		try {
			const next = await bridge.listUpdateCatalog();
			setCatalog(next);
			if (!quiet) {
				lopu(next.catalogError
					? { title: 'Cached recovery is available', description: next.catalogError, status: 'info', duration: 6000 }
					: { title: 'Release catalog refreshed', description: `${next.releases.length} GitHub releases available.`, status: 'success', duration: 4000 });
			}
		} catch (error) {
			lopu({ title: 'Could not fetch GitHub releases', description: error instanceof Error ? error.message : 'Thingtime could not reach the release catalog.', status: 'error', duration: 7000 });
		} finally {
			setLoading(false);
		}
	}, [lopu]);

	React.useEffect(() => {
		void refresh(true);
	}, [refresh]);

	const runAction = React.useCallback(async (key: string, action: () => Promise<void>) => {
		setBusyKey(key);
		try {
			await action();
		} catch (error) {
			lopu({ title: 'Thingtime update action failed', description: error instanceof Error ? error.message : 'The update action could not be completed.', status: 'error', duration: 8000 });
		} finally {
			setBusyKey(null);
		}
	}, [lopu]);

	const cacheRelease = React.useCallback((release: ThingtimeDesktopRelease) => {
		void runAction(`cache:${release.id}`, async () => {
			const result = await getElectronBridge()?.cacheReleaseBundle?.({ releaseId: release.id });
			if (!result) throw new Error('This Thingtime build cannot cache releases.');
			setCatalog(result.catalog);
			lopu({ title: 'Verified recovery bundle cached', description: `${releaseLabel(release)} is ready to launch or install.`, status: 'success', duration: 6000 });
		});
	}, [lopu, runAction]);

	const installBundle = React.useCallback((bundle: ThingtimeDesktopCachedBundle) => {
		void runAction(`install:${bundle.key}`, async () => {
			const result = await getElectronBridge()?.installCachedRelease?.({ key: bundle.key });
			if (!result) throw new Error('This Thingtime build cannot install cached releases.');
			lopu({ title: 'Switching Thingtime version', description: result.message, status: 'info', duration: 7000 });
		});
	}, [lopu, runAction]);

	const launchBundle = React.useCallback((bundle: ThingtimeDesktopCachedBundle) => {
		void runAction(`launch:${bundle.key}`, async () => {
			const result = await getElectronBridge()?.launchCachedRelease?.({ key: bundle.key });
			if (!result) throw new Error('This Thingtime build cannot launch cached releases.');
			lopu({ title: 'Launching recovery bundle', description: result.message, status: 'info', duration: 7000 });
		});
	}, [lopu, runAction]);

	const removeBundle = React.useCallback((bundle: ThingtimeDesktopCachedBundle) => {
		void runAction(`remove:${bundle.key}`, async () => {
			const next = await getElectronBridge()?.removeCachedRelease?.({ key: bundle.key });
			if (!next) throw new Error('This Thingtime build cannot remove cached releases.');
			setCatalog(next);
		});
	}, [runAction]);

	const revealCache = React.useCallback(() => {
		void runAction('reveal-cache', async () => {
			const result = await getElectronBridge()?.revealUpdateCache?.();
			if (!result) throw new Error('This Thingtime build cannot reveal its recovery cache.');
		});
	}, [runAction]);

	const normalizedFilter = filter.trim().toLocaleLowerCase();
	const releases = (catalog?.releases || []).filter((release) => !normalizedFilter || releaseSearchText(release).includes(normalizedFilter));

	return (
		<Flex flexDirection="column" rowGap={2} paddingTop={2} borderTop="1px solid" borderColor="blackAlpha.100">
			<Flex alignItems="center" columnGap={3} rowGap={2} flexWrap="wrap">
				<Box flex="1" minWidth={0}>
					<Text fontSize="sm">Thingtime versions & recovery</Text>
					<Text fontSize="xs" opacity={0.55}>
						Browse GitHub releases, cache verified signed bundles, then install or launch any cached version.
					</Text>
				</Box>
				<Button size="xs" variant="outline" isLoading={loading} onClick={() => void refresh()}>
					Refresh releases
				</Button>
				<Button size="xs" variant="ghost" onClick={revealCache} isLoading={busyKey === 'reveal-cache'}>
					Reveal cache
				</Button>
			</Flex>
			<Input size="sm" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search version, PR, branch, or commit" aria-label="Search Thingtime releases" />
				{catalog?.truncated && (
					<Text fontSize="xs" color="orange.600">
						Release pagination stopped safely because GitHub returned a looping next-page link. Refresh before relying on this catalog.
				</Text>
				)}
				{catalog?.catalogError && (
					<Text fontSize="xs" color="orange.600">
						{catalog.catalogError}
					</Text>
				)}
			{catalog && (
				<Text fontSize="xs" opacity={0.55}>
					Current: {catalog.currentVersion || 'unknown'} · {catalog.releases.length} release{catalog.releases.length === 1 ? '' : 's'} · {catalog.cachedBundles.length} verified recovery bundle{catalog.cachedBundles.length === 1 ? '' : 's'} cached
				</Text>
			)}
			{catalog?.cachedBundles.length ? (
				<Flex flexDirection="column" rowGap={1}>
					<Text fontSize="xs" fontWeight={600} textTransform="uppercase" letterSpacing="0.06em" opacity={0.55}>Cached recovery bundles</Text>
					{catalog.cachedBundles.map((bundle) => (
						<Flex key={bundle.key} alignItems="center" columnGap={2} rowGap={1} flexWrap="wrap" padding={2} borderRadius="md" background="blackAlpha.50">
							<Text fontSize="xs" flex="1" minWidth={160} wordBreak="break-word">{cacheLabel(bundle)}</Text>
							<Button size="xs" variant="ghost" onClick={() => launchBundle(bundle)} isLoading={busyKey === `launch:${bundle.key}`}>Launch</Button>
							<Button size="xs" variant="solid" onClick={() => installBundle(bundle)} isLoading={busyKey === `install:${bundle.key}`}>Install</Button>
							<Button size="xs" variant="ghost" colorScheme="red" onClick={() => removeBundle(bundle)} isLoading={busyKey === `remove:${bundle.key}`}>Remove</Button>
						</Flex>
					))}
				</Flex>
			) : null}
			<Box maxHeight="310px" overflowY="auto" paddingRight={1}>
				<Flex flexDirection="column" rowGap={1}>
					{releases.map((release) => (
						<Flex key={release.id} alignItems="center" columnGap={2} rowGap={1} flexWrap="wrap" padding={2} borderRadius="md" border="1px solid" borderColor={release.isCurrent ? 'green.300' : 'blackAlpha.100'}>
							<Box flex="1" minWidth={180}>
								<Text fontSize="xs" fontWeight={600} wordBreak="break-word">{releaseLabel(release)}{release.isCurrent ? ' · current' : ''}</Text>
								<Text fontSize="xs" opacity={0.55} wordBreak="break-word">
									{[release.pullRequestNumber ? `PR #${release.pullRequestNumber}` : null, release.branch, release.commit?.slice(0, 12), release.publishedAt ? new Date(release.publishedAt).toLocaleDateString() : null].filter(Boolean).join(' · ')}
								</Text>
							</Box>
							{release.asset ? (
								<Button size="xs" variant="outline" onClick={() => cacheRelease(release)} isLoading={busyKey === `cache:${release.id}`}>Cache</Button>
							) : (
								<Text fontSize="xs" opacity={0.45}>No signed macOS ZIP</Text>
							)}
						</Flex>
					))}
					{catalog && releases.length === 0 && <Text fontSize="xs" opacity={0.55}>No releases match that filter.</Text>}
				</Flex>
			</Box>
		</Flex>
	);
};
