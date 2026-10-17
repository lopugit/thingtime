import React from 'react';
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { accountWorkspaceWorker } from './accountApi.client';
import { announceLocalWorkspaceChange, currentAccountWorkspace, LOCAL_WORKSPACE_CHANGED } from './runtime.client';
import type { AccountThemeSync } from './accountThemes';
import type { AccountThemeSelection } from './themeSelection';
type Review =
	| { kind: 'theme'; value: Awaited<ReturnType<AccountThemeSync['inspect']>> }
	| { kind: 'selection'; value: Awaited<ReturnType<AccountThemeSelection['inspect']>> };
/** ThemeStudio keys this surface by workspace identity. Anonymous workspaces
 * never construct an account worker or negotiate remote authority. */
export function AccountThemeSyncStatus({ onAdopt }: { onAdopt: (theme: any | null) => void }) {
	const [worker] = React.useState(() => {
		const scope = currentAccountWorkspace();
		return scope ? accountWorkspaceWorker(scope) : null;
	});
	const [rows, setRows] = React.useState<Awaited<ReturnType<AccountThemeSync['status']>>>([]);
	const [selection, setSelection] = React.useState<Awaited<ReturnType<AccountThemeSelection['status']>>>(null);
	const [error, setError] = React.useState(''),
		[readError, setReadError] = React.useState('');
	const [review, setReview] = React.useState<Review | null>(null),
		[busy, setBusy] = React.useState(false);
	const mounted = React.useRef(true),
		read = React.useRef(0),
		controller = React.useRef<AbortController | null>(null);
	const refresh = React.useCallback(async () => {
		if (!worker) return;
		const request = ++read.current;
		try {
			const [next, selected] = await Promise.all([worker.themes.status(), worker.themes.selection.status()]);
			worker.lease.assertCurrent();
			if (!mounted.current || request !== read.current) return;
			setRows(next);
			setSelection(selected);
			setReadError(worker.themeErrors.catalog || worker.themeErrors.selection);
		} catch {
			if (mounted.current && request === read.current) setReadError('Theme sync status could not be read. Device content has been preserved.');
		}
	}, [worker]);
	React.useEffect(() => {
		mounted.current = true;
		void refresh();
		const changed = () => {
			void refresh();
		};
		window.addEventListener(LOCAL_WORKSPACE_CHANGED, changed);
		const invalidate = () => {
			read.current++;
		};
		return () => {
			mounted.current = false;
			invalidate();
			controller.current?.abort();
			window.removeEventListener(LOCAL_WORKSPACE_CHANGED, changed);
		};
	}, [refresh]);
	const run = async (operation: (signal: AbortSignal) => Promise<void>) => {
		if (!worker || controller.current) return;
		const current = new AbortController();
		controller.current = current;
		setBusy(true);
		setError('');
		try {
			worker.lease.assertCurrent();
			await operation(current.signal);
			worker.lease.assertCurrent();
			if (!mounted.current || current.signal.aborted) return;
			worker.wake();
			announceLocalWorkspaceChange();
			await refresh();
		} catch (cause: any) {
			if (mounted.current && !current.signal.aborted)
				setError(cause?.message || 'Could not complete theme synchronization. Device content has been preserved.');
		} finally {
			if (controller.current === current) controller.current = null;
			if (mounted.current) setBusy(false);
		}
	};
	if (!worker) return null;
	const resolve = (keep: 'local' | 'remote' | 'copy') =>
		run(async (signal) => {
			if (!review) return;
			let copied = false;
			if (review.kind === 'theme') copied = !!(await worker.themes.resolve(review.value, keep, worker.themeTransport, signal)).copyId;
			else {
				if (keep === 'copy') return;
				await worker.themes.selection.resolve(review.value, keep, worker.themeTransport, signal);
			}
			if (!signal.aborted && (keep !== 'local' || copied)) {
				const catalogue = await worker.themes.list();
				worker.lease.assertCurrent();
				const selected = catalogue.themes.find((row) => row.id === catalogue.activeThemeId);
				if (
					!signal.aborted &&
					mounted.current &&
					(review.kind === 'selection' || catalogue.activeThemeId === (review.kind === 'theme' ? review.value.id : null) || copied)
				) {
     if (selected || catalogue.activeThemeId === null) onAdopt(selected ?? null);
     else setError('Account selection saved. Its theme is not retained on this device; the current look has been kept.');
    }
			}
			if (!signal.aborted) setReview(null);
		});
	return (
		<Box
			aria-label="Theme account synchronization"
			marginTop={4}
			padding={3}
			border="1px solid var(--tt-border)"
			borderRadius="var(--tt-radius-md)"
			minWidth={0}
		>
			<Text fontSize="sm">Themes save on this device first. Account content and the selected theme synchronize separately.</Text>
			{readError ? (
				<Text role="alert" fontSize="sm">
					{readError}
				</Text>
			) : null}
			<Button
				size="sm"
				marginTop={2}
				isDisabled={busy}
				onClick={() =>
					void run(async () => {
						await Promise.all([worker.refreshThemes(true), worker.refreshThemeSelection(true)]);
					})
				}
			>
				Refresh account themes
			</Button>
			{rows
				.filter((row) => row.state !== 'synced')
				.map((row) => (
					<Flex key={row.id} marginTop={3} gap={2} flexWrap="wrap" alignItems="center" minWidth={0}>
						<Text fontSize="sm" overflowWrap="anywhere" flex="1 1 180px">
							{row.base?.name || row.id}
							{row.deleted ? ' (deleted on this device)' : ''}: {row.error || row.state}
						</Text>
						{['conflict', 'error'].includes(row.state) ? (
							<Button
								size="sm"
								isDisabled={busy}
								onClick={() =>
									void run(async (signal) => {
										const value = await worker.themes.inspect(row.id, worker.themeTransport, signal);
										if (!signal.aborted) setReview({ kind: 'theme', value });
									})
								}
							>
								Review theme
							</Button>
						) : null}
						{row.state !== 'conflict' ? (
							<Button
								size="sm"
								isDisabled={busy}
								onClick={() =>
									void run(async () => {
										await worker.themes.retry(row.id);
									})
								}
							>
								Retry theme sync
							</Button>
						) : null}
					</Flex>
				))}
			{selection && selection.state !== 'synced' ? (
				<Flex marginTop={3} gap={2} flexWrap="wrap" alignItems="center">
					<Text fontSize="sm" flex="1 1 180px">
						Theme selection: {selection.error || selection.state}
					</Text>
					{['conflict', 'error'].includes(selection.state) ? (
						<Button
							size="sm"
							isDisabled={busy}
							onClick={() =>
								void run(async (signal) => {
									const value = await worker.themes.selection.inspect(worker.themeTransport, signal);
									if (!signal.aborted) setReview({ kind: 'selection', value });
								})
							}
						>
							Review selection
						</Button>
					) : null}
					{selection.state !== 'conflict' ? (
						<Button
							size="sm"
							isDisabled={busy}
							onClick={() =>
								void run(async () => {
									await worker.themes.selection.retry();
								})
							}
						>
							Retry selection sync
						</Button>
					) : null}
				</Flex>
			) : null}
			{review ? (
				<Box marginTop={3} role="region" aria-label="Theme sync comparison">
					<Text fontWeight="bold">Compare device and account</Text>
					<Flex gap={3} flexWrap="wrap">
						<Box flex="1 1 200px" minWidth={0}>
							<Text>Device</Text>
							<Box as="pre" maxHeight="240px" overflow="auto" fontSize="xs" whiteSpace="pre-wrap" overflowWrap="anywhere">
								{JSON.stringify(
									review.kind === 'theme' ? review.value.local?.crystal ?? 'Deleted' : review.value.desired ?? 'Built-in theme',
									null,
									2
								)}
							</Box>
						</Box>
						<Box flex="1 1 200px" minWidth={0}>
							<Text>Account</Text>
							<Box as="pre" maxHeight="240px" overflow="auto" fontSize="xs" whiteSpace="pre-wrap" overflowWrap="anywhere">
								{JSON.stringify(
									review.kind === 'theme' ? review.value.remote ?? 'Deleted' : review.value.remote.themeId ?? 'Built-in theme',
									null,
									2
								)}
							</Box>
						</Box>
					</Flex>
					<Flex gap={2} flexWrap="wrap">
						<Button size="sm" isDisabled={busy} onClick={() => void resolve('local')}>
							Keep device version
						</Button>
						<Button size="sm" isDisabled={busy} onClick={() => void resolve('remote')}>
							Use account version
						</Button>
						{review.kind === 'theme' && review.value.local ? (
							<Button size="sm" isDisabled={busy} onClick={() => void resolve('copy')}>
								Keep device as private copy
							</Button>
						) : null}
						<Button size="sm" isDisabled={busy} onClick={() => setReview(null)}>
							Cancel
						</Button>
					</Flex>
				</Box>
			) : null}
			{error ? (
				<Text role="alert" fontSize="sm" marginTop={2}>
					{error}
				</Text>
			) : null}
		</Box>
	);
}
