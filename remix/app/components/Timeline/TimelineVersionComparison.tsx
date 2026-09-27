import React from 'react';
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import type { TimelineSnapshot } from '../../timeline/contract';
import type { VersionChoices, VersionConflict, VersionValue } from '../../timeline/versions';
import { timelineChanges, timelineChangeLabel, timelineValueLabel } from '../../timeline/changes';

const label = (value: VersionValue) => timelineValueLabel(value.present ? { exists: true, value: value.value } : { exists: false });
const data = (value: VersionValue) => {
	const text = value.present ? JSON.stringify(value.value, null, 2) : 'Not set';
	return text.length > 24_000 ? `${text.slice(0, 24_000)}\n… Display shortened.` : text;
};

/** The same comparison and conflict review for live restoration and branch merges. */
export function TimelineVersionComparison({
	current,
	result,
	conflicts,
	choices,
	busy,
	onChoose,
	componentLabels = false,
	matchingMessage
}: {
	current: TimelineSnapshot;
	result: TimelineSnapshot;
	conflicts: VersionConflict[];
	componentLabels?: boolean;
	matchingMessage?: string;
	choices: VersionChoices;
	busy: boolean;
	onChoose: (key: string, side: 'current' | 'incoming') => void;
}) {
	const pathLabel = (path: string[]) =>
		componentLabels ? `Component “${path[0]}”${path.length > 1 ? ` › ${timelineChangeLabel(path.slice(1))}` : ''}` : timelineChangeLabel(path);
	const valueLabel = (value: VersionValue) =>
		componentLabels && !value.present
			? 'Not recorded'
			: componentLabels && value.present && value.value === null
			? 'Unavailable when recorded'
			: label(value);
	const changes = React.useMemo(() => timelineChanges(current, result), [current, result]);
	return (
		<>
			{conflicts.map((conflict) => {
				const key = JSON.stringify(conflict.path);
				return (
					<Box key={key} p={3} mb={3} borderWidth="1px" borderRadius="lg" borderColor="var(--tt-border)">
						<Text fontWeight="600" overflowWrap="anywhere">
							Both versions changed {pathLabel(conflict.path)}
						</Text>
						<Text fontSize="sm" mt={2} overflowWrap="anywhere" noOfLines={4}>
							Current: {valueLabel(conflict.current)}
						</Text>
						<Text fontSize="sm" mt={1} overflowWrap="anywhere" noOfLines={4}>
							This version: {valueLabel(conflict.incoming)}
						</Text>
						<Box as="details" mt={2}>
							<Box as="summary" fontSize="sm" cursor="pointer">
								Compare data
							</Box>
							{(
								[
									['Current', conflict.current],
									['This version', conflict.incoming]
								] as const
							).map(([title, value]) => (
								<Box key={title} mt={2}>
									<Text fontSize="sm" fontWeight="600">
										{title}
									</Text>
									<Box as="pre" whiteSpace="pre-wrap" overflowWrap="anywhere" fontSize="xs" maxH="240px" overflow="auto">
										{data(value)}
									</Box>
								</Box>
							))}
						</Box>
						<Flex gap={2} wrap="wrap" mt={2}>
							{(['current', 'incoming'] as const).map((side) => (
								<Button
									key={side}
									size="sm"
									variant={choices[key] === side ? 'solid' : 'outline'}
									aria-pressed={choices[key] === side}
									isDisabled={busy}
									onClick={() => onChoose(key, side)}
								>
									{side === 'current' ? 'Keep current' : 'Use this version'}
								</Button>
							))}
						</Flex>
					</Box>
				);
			})}
			{!conflicts.length && !changes.length ? (
				<Text fontSize="sm" mb={3}>
					{matchingMessage ??
						(componentLabels
							? 'The recorded component definitions already match.'
							: 'The content already matches. Applying records the version relationship.')}
				</Text>
			) : null}
			{changes.map((change, index) => (
				<Box key={index} mb={3}>
					<Text fontWeight="600" fontSize="sm" overflowWrap="anywhere">
						{pathLabel(change.path)}
					</Text>
					<Text fontSize="sm" color="var(--tt-muted)" overflowWrap="anywhere" noOfLines={3}>
						Current: {timelineValueLabel(change.before, change.path)}
					</Text>
					<Text fontSize="sm" overflowWrap="anywhere" noOfLines={3}>
						Result: {timelineValueLabel(change.after, change.path)}
					</Text>
				</Box>
			))}
		</>
	);
}
