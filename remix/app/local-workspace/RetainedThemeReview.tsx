import React from 'react';
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { ThingExportDialog } from '../components/Things/ThingExportDialog';
import { accountWorkspaceWorker } from './accountApi.client';
import { announceAccountHomeThemeChange, currentAccountWorkspace, LOCAL_WORKSPACE_CHANGED } from './runtime.client';
import { RetainedAccountThemes, type RetainedThemeEntry, type RetainedThemeReview as Review } from './retainedThemes';
import { normalizeSavedTheme } from '../theme/savedTheme';
import type { TtTheme } from '../theme/tokens';

/** Mounted under ThemeStudio's identity key. Review never starts migration or
 * reads account HTTP; a recovered copy uses the normal private home writer. */
export function RetainedThemeReview({ renderPreview }: { renderPreview: (theme: TtTheme) => React.ReactNode }) {
	const [services] = React.useState(() => {
		const scope = currentAccountWorkspace();
		if (!scope) return null;
		const worker = accountWorkspaceWorker(scope, { localPlane: 'home' });
		return { worker, retained: new RetainedAccountThemes(worker.db, scope, worker.lease, worker.themes) };
	});
	const [entries, setEntries] = React.useState<RetainedThemeEntry[]>([]),
		[review, setReview] = React.useState<Review | null>(null);
	const [copied, setCopied] = React.useState<string | null>(null),
		[download, setDownload] = React.useState(false);
	const [error, setError] = React.useState(''),
		[busy, setBusy] = React.useState(false);
	const mounted = React.useRef(true),
		request = React.useRef(0),
		operation = React.useRef(false);
	const refresh = React.useCallback(async () => {
		if (!services) return;
		const ticket = ++request.current;
		try {
			const rows = await services.retained.list();
			services.worker.lease.assertCurrent();
			if (mounted.current && ticket === request.current) {
				setEntries(rows);
				setError('');
			}
		} catch (cause: any) {
			if (mounted.current && ticket === request.current) setError(cause?.message || 'Retained themes could not be read. Saved content is preserved.');
		}
	}, [services]);
	React.useEffect(() => {
		mounted.current = true;
		void refresh();
		const changed = () => void refresh();
		const invalidate = () => {
			request.current++;
		};
		window.addEventListener(LOCAL_WORKSPACE_CHANGED, changed);
		return () => {
			mounted.current = false;
			invalidate();
			window.removeEventListener(LOCAL_WORKSPACE_CHANGED, changed);
		};
	}, [refresh]);
	const run = async (action: () => Promise<void>) => {
		if (!services || operation.current) return;
		operation.current = true;
		setBusy(true);
		setError('');
		try {
			services.worker.lease.assertCurrent();
			await action();
		} catch (cause: any) {
			if (mounted.current) setError(cause?.message || 'Could not review this entry. The original is preserved.');
		} finally {
			operation.current = false;
			if (mounted.current) setBusy(false);
		}
	};
	if (!services || (!entries.length && !error)) return null;
	const inspect = (entry: RetainedThemeEntry) =>
		run(async () => {
			const next = await services.retained.inspect(entry);
			services.worker.lease.assertCurrent();
			if (!mounted.current) return;
			setReview(next);
			setCopied(null);
			setDownload(false);
		});
	const copy = () =>
		run(async () => {
			if (!review) return;
			const row = await services.retained.copy(review);
			services.worker.lease.assertCurrent();
			if (!mounted.current) return;
			setCopied(row.id);
			announceAccountHomeThemeChange();
			services.worker.wake();
		});
	const source = review && 'thing' in review.snapshot ? review.snapshot.thing : null;
	const preview = source ? normalizeSavedTheme({ name: source.crystal?.name, theme: source.crystal?.theme }) : null;
	const deleted = review && 'state' in review.snapshot && review.snapshot.state?.deleted;
	return (
		<Box aria-label="Retained theme edits" mt={4} p={3} border="1px solid var(--tt-border)" borderRadius="var(--tt-radius-md)" minWidth={0}>
			<Text fontWeight={600}>Retained theme edits</Text>
			<Text fontSize="sm">
				Older database workspaces may contain different device edits. Review them offline; recovery creates a private copy in home storage and
				preserves the original request, folder and selection.
			</Text>
			<Button size="sm" mt={2} onClick={() => void refresh()} isDisabled={busy}>
				Refresh retained edits
			</Button>
			{error ? (
				<Text role="alert" fontSize="sm" mt={2}>
					{error}
				</Text>
			) : null}
			<Flex direction="column" gap={2} mt={3}>
				{entries.map((entry) => (
					<Box key={`${entry.dataPlane}:${entry.kind}:${entry.id}`} minWidth={0}>
						<Text fontSize="sm" overflowWrap="anywhere">
							{entry.name} · {entry.state}
						</Text>
						<Text fontSize="xs" overflowWrap="anywhere">
							Database workspace · {entry.dataPlane.replace('custom-', '').slice(0, 12)}
						</Text>
						<Button size="sm" onClick={() => void inspect(entry)} isDisabled={busy} aria-label={`Review ${entry.name}`}>
							Review
						</Button>
					</Box>
				))}
			</Flex>
			{review ? (
				<Box mt={3} aria-label="Retained theme comparison" minWidth={0}>
					<Text fontWeight={600}>{review.name}</Text>
					<Text fontSize="sm">
						{source ? 'Saved theme content' : review.kind === 'selection' ? 'Saved theme choice' : 'Deletion request; no content will be recreated'}
					</Text>
					{preview?.ok ? <Box my={2}>{renderPreview(preview.theme)}</Box> : null}
					<Box as="details" my={2}>
						<Box as="summary" cursor="pointer" fontSize="sm">
							Theme data
						</Box>
						<Text fontSize="xs" overflowWrap="anywhere">
							Source workspace: {review.dataPlane}
						</Text>
						<Box
							as="pre"
							whiteSpace="pre-wrap"
							overflowWrap="anywhere"
							maxHeight="240px"
							overflow="auto"
							fontSize="xs"
							p={2}
							background="var(--tt-surface-alt)"
						>
							{JSON.stringify(
								source
									? source.crystal
									: 'selection' in review.snapshot
										? { activeThemeId: review.snapshot.active, desiredThemeId: review.snapshot.selection?.desired }
										: null,
								null,
								2
							)}
						</Box>
					</Box>
					{source && preview?.ok && !deleted ? (
						<Button size="sm" mt={2} onClick={() => void copy()} isDisabled={busy || !!copied}>
							Keep a private home copy
						</Button>
					) : null}
					{copied ? (
						<>
							<Text role="status" fontSize="sm" mt={2}>
								Private home copy saved on this device. The original is unchanged.
							</Text>
							<Button size="sm" mt={2} onClick={() => setDownload(true)}>
								Download recovered theme
							</Button>
						</>
					) : null}
				</Box>
			) : null}
			{download && copied ? <ThingExportDialog ids={[copied]} localView={{ localPlane: 'home' }} onClose={() => setDownload(false)} /> : null}
		</Box>
	);
}
