import React from 'react';
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { accountWorkspaceWorker } from '~/local-workspace/accountApi.client';
import {
	announceAccountHomeThemeChange,
	currentAccountWorkspace,
	LOCAL_WORKSPACE_CHANGED,
	subscribeWorkspaceIdentity,
	workspaceIdentityKey
} from '~/local-workspace/runtime.client';

/** Review uses the same frozen before-images and fresh remote checks as the
 * queue. UI choices cannot authorize another account or silently replace edits. */
export function AlgorithmSyncStatus() {
	const [rows, setRows] = React.useState<any[]>([]),
		[selection, setSelection] = React.useState<any>(null);
	const [message, setMessage] = React.useState(''),
		[error, setError] = React.useState('');
	const [review, setReview] = React.useState<{ identity: string; kind: 'profile' | 'selection'; value: any } | null>(null);
	const [busy, setBusy] = React.useState(false);
	const service = () => {
		const scope = currentAccountWorkspace();
		if (!scope) throw Error('The account workspace changed. Reopen Algorithms.');
		return accountWorkspaceWorker(scope, { localPlane: 'home' }).algorithmWorker!;
	};
	const loadRef = React.useRef<() => void>(() => {});
	React.useEffect(() => {
		let sequence = 0,
			identity = workspaceIdentityKey(),
			alive = true;
		const load = async () => {
			const ticket = ++sequence;
			const nextIdentity = workspaceIdentityKey();
			if (nextIdentity !== identity) {
				identity = nextIdentity;
				setReview(null);
				setError('');
			}
			if (!currentAccountWorkspace()) {
				setRows([]);
				setSelection(null);
				setMessage('');
				return;
			}
			try {
				const current = service(),
					[list, states, choice] = await Promise.all([current.algorithms.list(), current.algorithms.status(), current.algorithms.selection.status()]);
				if (!alive || ticket !== sequence || identity !== workspaceIdentityKey()) return;
				setRows(
					states
						.filter((row) => row.state !== 'synced')
						.map((row) => ({ ...row, name: list.algorithms.find((item) => item.id === row.id)?.name || 'Deleted algorithm' }))
				);
				setSelection(choice?.state === 'synced' ? null : choice);
				setMessage(current.errors.catalog || current.errors.selection);
			} catch (cause) {
				if (alive && ticket === sequence) setError(cause instanceof Error ? cause.message : 'Could not read device sync status.');
			}
		};
		const wake = () => {
			void load();
		};
		loadRef.current = wake;
		wake();
		window.addEventListener(LOCAL_WORKSPACE_CHANGED, wake);
		const off = subscribeWorkspaceIdentity(wake);
		return () => {
			alive = false;
			sequence++;
			window.removeEventListener(LOCAL_WORKSPACE_CHANGED, wake);
			off();
		};
	}, []);
	const act = async (operation: () => Promise<void>) => {
		setBusy(true);
		setError('');
		try {
			await operation();
			loadRef.current();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : 'The change could not be completed.');
		} finally {
			setBusy(false);
		}
	};
	const inspect = (id?: string) =>
		act(async () => {
			const identity = workspaceIdentityKey(),
				current = service();
			const value = id ? await current.algorithms.inspect(id, current.transport) : await current.algorithms.selection.inspect(current.transport);
			if (identity !== workspaceIdentityKey()) throw Error('The account workspace changed. Review again.');
			setReview({ identity, kind: id ? 'profile' : 'selection', value });
		});
	const resolve = (keep: 'local' | 'remote' | 'copy') =>
		act(async () => {
			if (!review || review.identity !== workspaceIdentityKey()) throw Error('The account workspace changed. Review again.');
			const current = service();
			if (review.kind === 'profile') await current.algorithms.resolve(review.value, keep, current.transport);
			else if (keep !== 'copy') await current.algorithms.selection.resolve(review.value, keep, current.transport);
			setReview(null);
			current.wake();
			announceAccountHomeThemeChange();
		});
	const retry = (id?: string) =>
		act(async () => {
			const current = service();
			if (id) await current.algorithms.retry(id);
			else await current.algorithms.selection.retry();
			current.wake();
		});
	const summary = (side: 'local' | 'remote') => {
		if (!review) return null;
		if (review.kind === 'selection') return side === 'local' ? review.value.desired ?? 'Latest' : review.value.remote.algorithmId ?? 'Latest';
		const row = review.value[side];
		if (!row) return 'Deleted';
		const content = side === 'local' ? row.crystal : row.content;
		return JSON.stringify(
			{
				name: content.name,
				description: side === 'local' ? row.crystal.description : row.description,
				moments: content.eventCount,
				lastTrainedAt: content.lastTrainedAt,
				folder: row.folderId ?? 'Root',
				weights: content.weights
			},
			null,
			2
		);
	};
	if (!rows.length && !selection && !message && !error && !review) return null;
	return (
		<Flex data-testid="algorithm-sync-status" direction="column" gap={2} p={3} borderWidth="1px" borderRadius="md" minWidth={0}>
			<Text fontSize="sm">Edits and choices are saved on this device. Account synchronization runs separately.</Text>
			{message && <Text fontSize="sm">{message}</Text>}
			{rows.map((row) => (
				<Flex key={row.id} gap={2} align="center" wrap="wrap">
					<Text fontSize="sm" overflowWrap="anywhere">
						{row.name} · {row.state === 'conflict' ? 'Review needed' : row.state === 'error' ? 'Sync needs attention' : 'Waiting to sync'}
					</Text>
					{row.error && (
						<Text fontSize="xs" overflowWrap="anywhere">
							{row.error}
						</Text>
					)}
					{['conflict', 'error'].includes(row.state) && (
						<Button size="xs" onClick={() => inspect(row.id)} isDisabled={busy}>
							Review {row.name}
						</Button>
					)}
					{row.state === 'error' && (
						<Button size="xs" onClick={() => retry(row.id)} isDisabled={busy}>
							Retry sync
						</Button>
					)}
				</Flex>
			))}
			{selection && (
				<Flex gap={2} align="center" wrap="wrap">
					<Text fontSize="sm">Active choice · {['conflict', 'error'].includes(selection.state) ? 'Review needed' : 'Waiting to sync'}</Text>
					{['conflict', 'error'].includes(selection.state) && (
						<Button size="xs" onClick={() => inspect()} isDisabled={busy}>
							Review active choice
						</Button>
					)}
					{selection.state === 'error' && (
						<Button size="xs" onClick={() => retry()} isDisabled={busy}>
							Retry choice
						</Button>
					)}
				</Flex>
			)}
			{review && (
				<Box>
					<Text fontSize="sm" fontWeight="bold">
						Review before replacing saved work
					</Text>
					{(['local', 'remote'] as const).map((side) => (
						<Box key={side} my={2}>
							<Text fontSize="sm">{side === 'local' ? 'On this device' : 'In your account'}</Text>
							<Box as="pre" fontSize="xs" whiteSpace="pre-wrap" overflowWrap="anywhere" maxHeight="220px" overflowY="auto">
								{summary(side)}
							</Box>
						</Box>
					))}
					<Flex wrap="wrap" gap={2}>
						<Button size="sm" onClick={() => resolve('local')} isDisabled={busy}>
							Keep this device
						</Button>
						<Button size="sm" onClick={() => resolve('remote')} isDisabled={busy}>
							Use account
						</Button>
						{review.kind === 'profile' && review.value.local && (
							<Button size="sm" onClick={() => resolve('copy')} isDisabled={busy}>
								Keep both
							</Button>
						)}
						<Button size="sm" variant="ghost" onClick={() => setReview(null)} isDisabled={busy}>
							Cancel review
						</Button>
					</Flex>
				</Box>
			)}
			{error && (
				<Text role="alert" fontSize="sm" overflowWrap="anywhere">
					{error}
				</Text>
			)}
		</Flex>
	);
}
