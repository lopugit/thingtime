import React from 'react';
import { Box, Button, Text } from '@chakra-ui/react';
import { useSearchParams } from 'react-router';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useDataPlane } from '../../hooks/useDataPlane';
import { useApi } from '../../hooks/useApi';
import { useTimelineSession } from '../../timeline/TimelineProvider';
import { parseTimelineBranchLookup, type TimelineBranchEntry } from '../../timeline/branches';
import { timelineScopeKey } from '../../timeline/contract';
import { isDataPlane } from '../../utils/dataPlane';
import { LiveWebpageView } from './LiveWebpage';
import { useBranchWebpageDraft } from './useBranchWebpageDraft';
import { PageShell } from '../Layout/PageShell';

type Connection = NonNullable<ReturnType<typeof useTimelineSession>['connection']>;
export function BranchWebpage({ pageId }: { pageId: string }) {
	const [params] = useSearchParams();
	const user = useCurrentUser();
	const dataPlane = useDataPlane();
	const session = useTimelineSession();
	const api = useApi();
	const [switchError, setSwitchError] = React.useState('');
	const ownerId = params.get('historyOwner'),
		plane = params.get('dataPlane'),
		branchId = params.get('branchId');
	let invalid = '';
	try {
		parseTimelineBranchLookup({ branchId, thingId: pageId });
		if (!ownerId || !isDataPlane(plane) || ['historyOwner', 'dataPlane', 'branchId', 'page'].some((key) => params.getAll(key).length !== 1))
			throw new Error('Invalid branch link. Open the branch from History.');
	} catch (error: any) {
		invalid = error.message;
	}
	if (
		invalid ||
		!user?.id ||
		ownerId !== user.id ||
		dataPlane !== plane ||
		session.connection?.scope.ownerId !== user.id ||
		session.connection?.scope.dataPlane !== plane
	)
		return (
			<PageShell width={680}>
				<Box role="status" p={6}>
					<Text>
						{invalid ||
							(!user?.id
								? 'Sign in to open this private branch.'
								: ownerId !== user.id
								? 'This branch link belongs to another account.'
								: dataPlane !== plane
								? 'Open this branch in its original database.'
								: 'Connecting to your branch history…')}
					</Text>
					{!invalid && ownerId === user?.id && plane === 'home' && dataPlane !== plane ? (
						<Button
							mt={3}
							onClick={() =>
								void api.v1.mongodb.endpoint
									.set({ reset: true })
									.catch((error) => setSwitchError(error?.error || error?.message || 'Could not switch databases.'))
							}
						>
							Switch to home account
						</Button>
					) : null}
					{switchError ? <Text role="alert">{switchError}</Text> : null}
				</Box>
			</PageShell>
		);
	return (
		<BranchLoader
			key={JSON.stringify([session.identity, timelineScopeKey(session.connection.scope), branchId, pageId])}
			branchId={branchId!}
			thingId={pageId}
			connection={session.connection}
		/>
	);
}
function BranchLoader({ branchId, thingId, connection }: { branchId: string; thingId: string; connection: Connection }) {
	const canRefresh = React.useRef<() => boolean>(() => true);
	const [target, setTarget] = React.useState<TimelineBranchEntry | null>(null);
	const [error, setError] = React.useState('');
	const [tick, retry] = React.useReducer((value) => value + 1, 0);
	React.useEffect(() => {
		let active = true;
		void (async () => {
			try {
				const cached = (await connection.branches.forThing(thingId)).find((entry) => entry.branch.id === branchId);
				if (active && cached) setTarget((previous) => previous ?? cached);
				const pulled = await connection.sync.branchHead(branchId, thingId);
				// Reconcile an untouched cached page, but never replace edits made while the pull was in flight.
				if (active) {
					setTarget((previous) => (previous && !canRefresh.current() ? previous : pulled));
					setError('');
				}
			} catch (error: any) {
				if (active) setError(error?.error || error?.message || 'Could not open this branch.');
			}
		})();
		return () => {
			active = false;
		};
	}, [branchId, thingId, connection, tick]);
	if (!target)
		return (
			<PageShell width={680}>
				<Box p={6}>
					<Text role={error ? 'alert' : 'status'}>{error || 'Opening branch…'}</Text>
					{error ? (
						<Button mt={3} onClick={retry}>
							Retry opening branch
						</Button>
					) : null}
				</Box>
			</PageShell>
		);
	return <BranchCanvas key={`${target.head.id}:${target.head.revision}`} target={target} connection={connection} refreshGuard={canRefresh} />;
}
function BranchCanvas({
	target,
	connection,
	refreshGuard
}: {
	target: TimelineBranchEntry;
	connection: Connection;
	refreshGuard: React.MutableRefObject<() => boolean>;
}) {
	const draft = useBranchWebpageDraft(target, connection);
	const [recoveryError, setRecoveryError] = React.useState('');
	refreshGuard.current = draft.branch!.canRefresh;
	if (!draft.resolved && draft.history?.recoverable.length)
		return (
			<PageShell width={680}>
				<Box p={6}>
					<Text>Your unfinished branch draft is saved on this device.</Text>
					{draft.history.recoverable.map((event) => (
						<Button key={event.id} mt={3} onClick={() => void draft.history!.recover(event).catch((error) => setRecoveryError(error.message))}>
							Resume draft
						</Button>
					))}
					{recoveryError ? <Text role="alert">{recoveryError}</Text> : null}
				</Box>
			</PageShell>
		);
	if (!draft.resolved && draft.history?.error)
		return (
			<PageShell width={680}>
				<Box p={6}>
					<Text role="alert">{draft.history.error}</Text>
					<Button mt={3} onClick={draft.refresh}>
						Retry opening branch
					</Button>
				</Box>
			</PageShell>
		);
	if (!draft.resolved)
		return (
			<PageShell width={680}>
				<Text role="status" p={6}>
					Opening branch…
				</Text>
			</PageShell>
		);
	return <LiveWebpageView builderPageId={target.head.thingId} draft={draft} />;
}
