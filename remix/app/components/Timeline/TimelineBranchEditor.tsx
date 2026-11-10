import React from 'react';
import { Box, Button, Flex, Heading, Text } from '@chakra-ui/react';
import { DefinitionValueEditor } from '../Builder/DefinitionEditor/DefinitionValueEditor';
import { useTimelineSession } from '../../timeline/TimelineProvider';
import { timelineScopeKey } from '../../timeline/contract';
import type { TimelineBranchEntry } from '../../timeline/branches';
import { branchCrystalSnapshot } from '../../timeline/branchCheckout';
import { useTimelineBranchDraft } from '../../timeline/useTimelineBranchDraft';

type Props = { target: TimelineBranchEntry; onClose: () => void };
export function TimelineBranchEditor(props: Props) {
	const { connection, identity } = useTimelineSession();
	if (!connection) return null;
	return (
		<BranchEditor
			key={JSON.stringify([identity, timelineScopeKey(connection.scope), props.target.head.id, props.target.head.revision])}
			{...props}
			connection={connection}
		/>
	);
}
function BranchEditor({ target, onClose, connection }: Props & { connection: NonNullable<ReturnType<typeof useTimelineSession>['connection']> }) {
	const draft = useTimelineBranchDraft(target, connection);
	const [error, setError] = React.useState('');
	return (
		<Box role="region" aria-label="Edit branch" p={3} my={3} borderWidth="1px" borderColor="var(--tt-border)" borderRadius="lg" minW={0}>
			<Heading size="sm" overflowWrap="anywhere">
				Edit {target.branch.name}
			</Heading>
			<Text fontSize="sm" color="var(--tt-muted)" mt={2} mb={3}>
				Changes go to this branch. The published Thing stays unchanged.
			</Text>
			{draft.recoverable.length && !draft.edited && !draft.locked ? (
				<Box mb={3}>
					<Text fontSize="sm">An unfinished draft is saved on this device.</Text>
					<Button
						size="sm"
						variant="outline"
						isDisabled={draft.saving}
						onClick={() => void draft.recover(draft.recoverable[0]).catch((failure) => setError(failure.message))}
					>
						Resume draft
					</Button>
				</Box>
			) : null}
			{draft.snapshot ? (
				<fieldset disabled={draft.locked} style={{ border: 0, padding: 0, minWidth: 0 }}>
					<DefinitionValueEditor
						value={(draft.snapshot.value as any).crystal}
						label="Branch fields"
						onChange={(crystal) => {
							try {
								setError('');
								draft.change(branchCrystalSnapshot(draft.snapshot!, crystal));
							} catch (failure: any) {
								setError(failure.message);
							}
						}}
					/>
				</fieldset>
			) : null}
			{draft.loading && !draft.snapshot ? <Text fontSize="sm">Opening branch…</Text> : null}
			{draft.writing ? (
				<Text role="status" fontSize="sm">
					Saving draft on this device…
				</Text>
			) : draft.notice ? (
				<Text role="status" fontSize="sm" mt={3}>
					{draft.notice}
				</Text>
			) : null}
			{draft.error || error ? (
				<Text role="alert" fontSize="sm" my={3} overflowWrap="anywhere">
					{draft.error || error}
				</Text>
			) : null}
			<Flex gap={2} mt={3} wrap="wrap">
				{draft.snapshot ? (
					<Button size="sm" isLoading={draft.saving} isDisabled={!draft.edited || draft.loading} onClick={() => void draft.save()}>
						{draft.locked ? 'Retry saving branch' : 'Save to branch'}
					</Button>
				) : null}
				{!draft.snapshot && !draft.loading ? (
					<Button size="sm" onClick={() => void draft.load()}>
						Retry opening branch
					</Button>
				) : null}
				<Button size="sm" variant="ghost" isDisabled={draft.saving || draft.writing || draft.unwritten} onClick={onClose}>
					Close editor
				</Button>
			</Flex>
		</Box>
	);
}
