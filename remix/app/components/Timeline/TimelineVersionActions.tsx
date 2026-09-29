import React from 'react';
import { Box, Button, Flex, Heading, Select, Text } from '@chakra-ui/react';
import { useApi } from '../../hooks/useApi';
import { useTimelineSession } from '../../timeline/TimelineProvider';
import { parseTimelineEntry, type TimelineEvent } from '../../timeline/contract';
import type { VersionChoices } from '../../timeline/versions';
import { parsePublishedVersionPreview, type PublishedVersionPreview, type VersionRequest } from '../../timeline/publishedVersion';
import { componentValues, definitionSnapshot } from '../../timeline/componentDefinitions';
import { TimelineVersionComparison } from './TimelineVersionComparison';
import { TimelinePublishedPagePreview } from './TimelinePublishedPagePreview';
import { TIMELINE_CHANGED_EVENT } from '../../timeline/clientEvents';

/** Mounted by scope/event identity. A retry retains the exact reviewed
 * command; component choices are reviewed after page-content conflicts. */
export function TimelineVersionActions({ event, onApplied }: { event: TimelineEvent; onApplied: () => void }) {
	const { connection } = useTimelineSession();
	const api = useApi();
	const [preview, setPreview] = React.useState<PublishedVersionPreview | null>(null);
	const [choices, setChoices] = React.useState<VersionChoices>({});
	const [componentChoices, setComponentChoices] = React.useState<VersionChoices>({});
	const [componentMode, setComponentMode] = React.useState<'recorded' | 'current'>('recorded');
	const [busy, setBusy] = React.useState(false);
	const [error, setError] = React.useState('');
	const [saved, setSaved] = React.useState(false);
	const alive = React.useRef(true);
	const request = React.useRef<VersionRequest | null>(null);
	const pending = React.useRef(false);
	React.useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
		};
	}, []);
	const compare = async (
		mode: PublishedVersionPreview['mode'],
		selected: VersionChoices = {},
		selectedComponents: VersionChoices = {},
		selectedMode = componentMode
	) => {
		if (!connection || pending.current) return;
		pending.current = true;
		setBusy(true);
		setError('');
		request.current = null;
		try {
			await connection.sync.pushPending();
			const query: VersionRequest = {
				command: 'preview-version',
				mode,
				eventId: event.id,
				choices: selected,
				componentMode: selectedMode,
				componentChoices: selectedComponents
			};
			const result = await api.v1.timeline.version(connection.scope, query);
			if (result?.ok === false || !result?.preview) throw new Error(result?.error || 'Could not compare this version.');
			const checked = parsePublishedVersionPreview(result.preview, event.id, event.thingId, query);
			if (alive.current) {
				setPreview(checked);
				setChoices(selected);
				setComponentChoices(selectedComponents);
				setComponentMode(selectedMode);
			}
		} catch (failure: any) {
			if (alive.current) setError(failure?.error || failure?.message || 'Could not compare this version.');
		} finally {
			pending.current = false;
			if (alive.current) setBusy(false);
		}
	};
	const apply = async () => {
		if (!connection || !preview || pending.current || preview.conflicts.length || preview.components?.conflicts.length) return;
		pending.current = true;
		setBusy(true);
		setError('');
		request.current ??= {
			command: 'apply-version',
			mode: preview.mode,
			eventId: event.id,
			expectedHeadId: preview.expectedHeadId,
			operationId: crypto.randomUUID(),
			choices,
			componentMode,
			componentChoices,
			expectedComponents: preview.components!.fingerprint
		};
		try {
			const result = await api.v1.timeline.version(connection.scope, request.current);
			if (result?.ok === false || !result?.entry) throw new Error(result?.error || 'Could not apply this version.');
			const entry = parseTimelineEntry(result.entry);
			if (
				entry.event.ownerId !== connection.scope.ownerId ||
				entry.event.thingId !== event.thingId ||
				entry.event.id !== `version-${request.current.operationId}` ||
				entry.event.source !== 'api' ||
				entry.event.mode !== 'revision'
			)
				throw new Error('This save receipt belongs to another operation.');
			await connection.store.accept([entry]);
			if (alive.current) {
				setSaved(true);
				setPreview(null);
				onApplied();
				window.dispatchEvent(new Event(TIMELINE_CHANGED_EVENT));
				window.dispatchEvent(new Event('thingtime:root-data-refresh'));
				window.dispatchEvent(new CustomEvent('thingtime:timeline-applied', { detail: { thingId: event.thingId } }));
			}
		} catch (failure: any) {
			if (alive.current) setError(failure?.error || failure?.message || 'The result is uncertain. Retry to check this same operation.');
		} finally {
			pending.current = false;
			if (alive.current) setBusy(false);
		}
	};
	if (
		!event.after ||
		event.mode === 'effect' ||
		!['thing-content', 'webpage-draft', 'definition-source', 'folder-placement'].includes(event.after.adapter)
	)
		return null;
	const components = preview?.components;
	const hasComponents = !!components && Object.values({ ...components.current, ...components.incoming, ...components.result }).length > 0;
	const unresolved = !!(preview?.conflicts.length || components?.conflicts.length);
	const needsComponents = componentMode === 'recorded' && !!components?.missing.length;
	const missingChoices = preview?.conflicts.length
		? preview.conflicts.some((conflict) => !choices[JSON.stringify(conflict.path)])
		: components?.conflicts.some((conflict) => !componentChoices[JSON.stringify(conflict.path)]);
	return (
		<Box mt={4} borderTopWidth="1px" borderColor="var(--tt-border)" pt={4}>
			{saved ? (
				<Text role="status" fontSize="sm">
					Version saved. The previous versions are still in your Timeline.
				</Text>
			) : preview ? (
				<>
					<Heading size="sm" mb={2}>
						{preview.mode === 'merge' ? 'Review and combine' : 'Review restore'}
					</Heading>
					<Text fontSize="sm" color="var(--tt-muted)" mb={3}>
						This creates a new saved version. Your later history stays available.
					</Text>
					<TimelineVersionComparison
						{...preview}
						choices={choices}
						busy={busy}
						onChoose={(key, side) => setChoices((previous) => ({ ...previous, [key]: side }))}
					/>
					{hasComponents && components ? (
						<Box mb={3}>
							<Heading size="xs" mb={2}>
								Page components
							</Heading>
							<Select
								aria-label="Components to restore"
								mb={2}
								value={componentMode}
								isDisabled={busy}
								onChange={(change) => void compare(preview.mode, choices, {}, change.target.value as 'recorded' | 'current')}
							>
								<option value="recorded">Recorded components</option>
								<option value="current">Current shared components</option>
							</Select>
							<Text fontSize="sm" mb={2}>
								{componentMode === 'recorded'
									? `Creates ${components.copyCount} private component ${
											components.copyCount === 1 ? 'copy' : 'copies'
									  } for this page. Other pages keep their current components.`
									: 'This page will use the current shared components, including their future edits.'}
							</Text>
							{!preview.conflicts.length ? (
								<TimelineVersionComparison
									current={definitionSnapshot(componentValues(components.current))}
									result={definitionSnapshot(componentValues(components.result))}
									conflicts={components.conflicts}
									componentLabels
									hideCopiedIdentity={componentMode === 'recorded'}
									choices={componentChoices}
									busy={busy}
									onChoose={(key, side) => setComponentChoices((previous) => ({ ...previous, [key]: side }))}
								/>
							) : (
								<Text fontSize="sm" mb={2}>
									Review the page changes first, then choose component definitions.
								</Text>
							)}
							{needsComponents ? (
								<Text role="status" fontSize="sm" mb={2} overflowWrap="anywhere">
									Some definitions were not recorded: {components.missing.join(', ')}. Choose current components or another version before applying.
								</Text>
							) : null}
							{componentMode === 'recorded' && components.unavailable.length ? (
								<Text fontSize="sm" mb={2}>
									Components that were unavailable in this version will be restored as inactive placeholders.
								</Text>
							) : null}
							<TimelinePublishedPagePreview preview={preview} componentMode={componentMode} />
						</Box>
					) : null}
					<Flex gap={2} wrap="wrap">
						<Button
							size="sm"
							isLoading={busy}
							isDisabled={!!missingChoices || (!unresolved && needsComponents)}
							onClick={() => void (unresolved ? compare(preview.mode, choices, preview.conflicts.length ? {} : componentChoices) : apply())}
						>
							{unresolved ? 'Review choices' : preview.mode === 'merge' ? 'Apply merge' : 'Restore this version'}
						</Button>
						<Button
							size="sm"
							variant="ghost"
							isDisabled={busy}
							onClick={() => {
								setPreview(null);
								setChoices({});
								setComponentChoices({});
								setError('');
								request.current = null;
							}}
						>
							Cancel
						</Button>
					</Flex>
				</>
			) : (
				<Flex gap={2} wrap="wrap">
					<Button size="sm" variant="outline" isLoading={busy} onClick={() => void compare('restore')}>
						Restore this version…
					</Button>
					<Button size="sm" variant="ghost" isDisabled={busy} onClick={() => void compare('merge')}>
						Review and combine…
					</Button>
				</Flex>
			)}
			{error ? (
				<Text role="alert" fontSize="sm" mt={3} overflowWrap="anywhere">
					{error}
				</Text>
			) : null}
		</Box>
	);
}
