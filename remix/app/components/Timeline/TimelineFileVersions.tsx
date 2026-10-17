import React from 'react';
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { useApi } from '../../hooks/useApi';
import { useDataPlane } from '../../hooks/useDataPlane';
import { apiErrorMessage } from '../../hooks/apiFailure';
import { useTimelineSession } from '../../timeline/TimelineProvider';
import { TIMELINE_CHANGED_EVENT } from '../../timeline/clientEvents';
import { type TimelineEvent, type TimelineScope } from '../../timeline/contract';
import { rootIdentity } from '../../utils/rootIdentity';
import { attachmentContentUrl } from '../Attachments/attachmentUiCore';
import type { CloudFile, CloudFileCommit } from '../../fileSync/cloudFile';
import {
	checkFileRestoreReceipt,
	fileContentId,
	fileRestoreCommand,
	fileRestoreKey,
	parseFileRestoreCommand,
	timelineFileVersion
} from '../../fileSync/fileVersions';

export function TimelineFileVersions({ event, onApplied }: { event: TimelineEvent; onApplied(): void }) {
	const session = useTimelineSession();
	const plane = useDataPlane();
	const scope = session.connection?.scope;
	const before = timelineFileVersion(event, 'before'),
		after = timelineFileVersion(event, 'after');
	if (!scope || scope.ownerId !== event.ownerId || scope.dataPlane !== 'home' || (!before && !after)) return null;
	const versions = after ? [{ label: 'Saved file version', file: after }] : [];
	if (before && before.content.attachmentId !== after?.content.attachmentId) versions.unshift({ label: 'Before this change', file: before });
	return (
		<Box mb={4}>
			{plane !== 'home' && (
				<Text fontSize="sm" color="var(--tt-muted)">
					Switch to home storage to download or restore file versions.
				</Text>
			)}
			{versions.map(({ label, file }) => (
				<TimelineFileVersion
					key={`${session.identity}:${event.id}:${file.revision}`}
					label={label}
					version={file}
					scope={scope}
					enabled={!!session.connection?.verified && plane === 'home'}
					onApplied={onApplied}
				/>
			))}
		</Box>
	);
}

export function TimelineFileVersion({
	label,
	version,
	scope,
	enabled,
	onApplied
}: {
	label: string;
	version: CloudFile;
	scope: TimelineScope;
	enabled: boolean;
	onApplied(): void;
}) {
	const api = useApi();
	const key = fileRestoreKey(scope, version);
	const [initial] = React.useState(() => {
		try {
			const saved = localStorage.getItem(key);
			return { command: saved ? parseFileRestoreCommand(JSON.parse(saved), version) : null, error: '' };
		} catch {
			return { command: null, error: 'Could not read the saved restore. Reopen History after local storage is available.' };
		}
	});
	const [command, setCommand] = React.useState<CloudFileCommit | null>(initial.command);
	const [review, setReview] = React.useState<CloudFile | null>(null);
	const [error, setError] = React.useState(initial.error);
	const [message, setMessage] = React.useState('');
	const [busy, setBusy] = React.useState(false);
	const [refused, setRefused] = React.useState(false);
	const active = React.useRef<AbortController | null>(null);
	const live = React.useRef(enabled);
	live.current = enabled;
	React.useEffect(() => {
		const unsubscribe = rootIdentity.subscribe(() => {
			active.current?.abort();
			live.current = false;
			setBusy(false);
		});
		return () => {
			unsubscribe();
			active.current?.abort();
			live.current = false;
		};
	}, []);
	React.useEffect(() => {
		if (!enabled) {
			active.current?.abort();
			setBusy(false);
		}
	}, [enabled]);
	const run = async (work: (check: () => void, signal: AbortSignal) => Promise<void>) => {
		if (!live.current || active.current || initial.error) return;
		const controller = new AbortController();
		active.current = controller;
		const generation = rootIdentity.read().generation;
		const check = () => {
			controller.signal.throwIfAborted();
			if (!live.current || scope.apiOrigin !== window.location.origin || rootIdentity.read().pending || rootIdentity.read().generation !== generation)
				throw Error('Your account or storage changed. Reopen History.');
		};
		setBusy(true);
		setError('');
		setMessage('');
		try {
			check();
			await work(check, controller.signal);
		} catch (failure) {
			if (!controller.signal.aborted) {
				setError(apiErrorMessage(failure, 'Could not finish. Retry checks the same saved restore.'));
				setRefused((failure as { status?: number })?.status === 409);
			}
		} finally {
			if (active.current === controller) active.current = null;
			if (!controller.signal.aborted) setBusy(false);
		}
	};
	const prepare = () =>
		run(async (check, signal) => {
			const pending = localStorage.getItem(key);
			if (pending) {
				setCommand(parseFileRestoreCommand(JSON.parse(pending), version));
				return;
			}
			const current = await api.v1.files.read(scope, version.id, { signal });
			check();
			setReview(current);
		});
	const apply = () =>
		run(async (check, signal) => {
			if (!command && !review) return;
			const saved = localStorage.getItem(key);
			const input = command ?? fileRestoreCommand(review!, version, crypto.randomUUID());
			if (saved && JSON.stringify(parseFileRestoreCommand(JSON.parse(saved), version)) !== JSON.stringify(input))
				throw Error('Another restore is pending. Reopen History to check its result.');
			// Persist the immutable command BEFORE sending. Reopening this version
			// retries the same operation even after a lost reply or browser restart.
			localStorage.setItem(key, JSON.stringify(input));
			setCommand(input);
			setReview(null);
			setRefused(false);
			check();
			const result = await api.v1.files.commit(scope, input, { signal });
			check();
			await checkFileRestoreReceipt(result?.file, input, version, scope.ownerId);
			check();
			if (localStorage.getItem(key) === JSON.stringify(input)) localStorage.removeItem(key);
			setCommand(null);
			setMessage('File version restored. Earlier versions remain in History.');
			onApplied();
			window.dispatchEvent(new Event(TIMELINE_CHANGED_EVENT));
			window.dispatchEvent(new Event('thingtime:root-data-refresh'));
		});
	const reviewAgain = () => {
		if (!refused || !command) return;
		try {
			if (localStorage.getItem(key) === JSON.stringify(command)) localStorage.removeItem(key);
			setCommand(null);
			setRefused(false);
			setError('');
			setReview(null);
		} catch {
			setError('Could not clear the refused restore.');
		}
	};
	const contentId = fileContentId(version);
	return (
		<Box borderWidth="1px" borderColor="var(--tt-border)" borderRadius="lg" p={3} mt={3} minW={0}>
			<Text fontWeight="600" fontSize="sm">
				{label}
			</Text>
			<Text fontSize="sm" overflowWrap="anywhere">
				{version.name} · {version.content.size.toLocaleString()} bytes
			</Text>
			<Text fontSize="xs" color="var(--tt-muted)" mt={2}>
				Content ID
			</Text>
			<Text as="code" display="block" fontSize="xs" overflowWrap="anywhere" userSelect="text">
				{contentId}
			</Text>
			<Flex gap={2} wrap="wrap" mt={3}>
				{enabled && (
					<Button
						as="a"
						size="sm"
						variant="outline"
						href={attachmentContentUrl(version.content.attachmentId, true)}
						target="_blank"
						rel="noopener noreferrer"
					>
						Download this version
					</Button>
				)}
				{!review && !command && (
					<Button size="sm" variant="outline" isDisabled={!enabled || busy || !!initial.error} onClick={() => void prepare()}>
						Review restore
					</Button>
				)}
			</Flex>
			{review && (
				<Box mt={3}>
					<Text fontSize="sm" overflowWrap="anywhere">
						Restore these bytes to “{review.name}” in its current folder{review.trashed ? ' and take it out of Trash' : ''}? The current version stays
						in History.
					</Text>
					<Flex gap={2} wrap="wrap" mt={2}>
						<Button size="sm" isDisabled={!enabled || busy} onClick={() => void apply()}>
							Restore this version
						</Button>
						<Button size="sm" variant="ghost" isDisabled={busy} onClick={() => setReview(null)}>
							Cancel restore
						</Button>
					</Flex>
				</Box>
			)}
			{command && (
				<Box mt={3}>
					<Text fontSize="sm">A restore was started. Retry to check and finish that same operation.</Text>
					<Button mt={2} size="sm" isDisabled={!enabled || busy} onClick={() => void apply()}>
						Retry restore
					</Button>
					{refused && (
						<Button mt={2} ml={2} size="sm" variant="ghost" onClick={reviewAgain}>
							Review latest file
						</Button>
					)}
				</Box>
			)}
			{busy && (
				<Text role="status" fontSize="sm" mt={2}>
					Checking file version…
				</Text>
			)}
			{error && (
				<Text role="alert" fontSize="sm" mt={2} overflowWrap="anywhere">
					{error}
				</Text>
			)}
			{message && (
				<Text role="status" fontSize="sm" mt={2}>
					{message}
				</Text>
			)}
		</Box>
	);
}
