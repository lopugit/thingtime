import React, { useId, useState } from 'react';
import { Box, Button, Flex, FormControl, FormLabel, Select, Stack, Text } from '@chakra-ui/react';
import { conflictCopySides, type SyncConflict, type SyncConflictChoice } from '~/fileSync/conflictResolution';
import type { SyncMode, SyncSide } from '~/fileSync/reconcile';

export function SyncConflictReview({
	conflicts,
	mode,
	onApply,
	onCancel
}: {
	conflicts: SyncConflict[];
	mode: SyncMode;
	onApply(choices: SyncConflictChoice[]): void;
	onCancel(): void;
}) {
	const id = useId();
	const [page, setPage] = useState(0),
		[choices, setChoices] = useState<Map<string, SyncSide>>(() => new Map());
	const pageSize = 20,
		pages = Math.ceil(conflicts.length / pageSize);
	const blocked = conflicts.some((conflict) => !conflictCopySides(conflict, mode).length);
	return (
		<Box role="region" aria-label="Review sync conflicts" width="100%" border="1px solid var(--tt-border, #ececef)" borderRadius="12px" padding={3}>
			<Stack spacing={3}>
				<Text fontWeight={600}>
					Review {conflicts.length} sync conflict{conflicts.length === 1 ? '' : 's'}
				</Text>
				<Text fontSize="13px">
					Choose the file to use in both folders. The other version is retained by the destination’s version storage. No files change until you apply
					all choices.
				</Text>
				<Text fontSize="12px">
					Files and settings are checked again before copying. Unfinished transfers retain their original choices after they start.
				</Text>
				<Text fontSize="13px" color="var(--tt-muted, #71717a)">
					{conflicts.every((conflict) => conflict.local && conflict.remote) ? 'Both versions of your data' : 'Your existing data'} will remain saved
					and accessible in their current folders if you choose to ignore this conflict for now.
				</Text>
				{conflicts.slice(page * pageSize, (page + 1) * pageSize).map((conflict, index) => {
					const options = conflictCopySides(conflict, mode),
						label = `${id}-${index}`;
					const describe = (side: SyncSide) => {
						const entry = conflict[side];
						return !entry ? 'Missing' : entry.kind === 'folder' ? 'Folder' : `${entry.size.toLocaleString()} bytes`;
					};
					return (
						<FormControl key={conflict.path}>
							<FormLabel htmlFor={label} fontSize="13px" overflowWrap="anywhere">
								{conflict.path}
							</FormLabel>
							<Text fontSize="12px" marginBottom={1}>
								Device: {describe('local')} · Cloud: {describe('remote')}
							</Text>
							{options.length ? (
								<Select
									id={label}
									aria-label={`Version to keep for ${conflict.path}`}
									value={choices.get(conflict.path) ?? ''}
									onChange={(event) => {
										const value = event.target.value;
										setChoices((previous) => {
											const next = new Map(previous);
											if (value) next.set(conflict.path, value as SyncSide);
											else next.delete(conflict.path);
											return next;
										});
									}}
								>
									<option value="">Choose a version</option>
									{options.map((side) => (
										<option key={side} value={side}>
											{side === 'local' ? 'Keep device version' : 'Keep cloud version'}
										</option>
									))}
								</Select>
							) : (
								<Text fontSize="13px">
									Resolve this folder, file-type or direction conflict in the source folders, then retry. Neither copy will be deleted here.
								</Text>
							)}
						</FormControl>
					);
				})}
				{pages > 1 && (
					<Flex gap={2} align="center" wrap="wrap">
						<Button size="sm" isDisabled={!page} onClick={() => setPage(page - 1)}>
							Previous conflicts
						</Button>
						<Text fontSize="12px">
							Page {page + 1} of {pages}
						</Text>
						<Button size="sm" isDisabled={page + 1 === pages} onClick={() => setPage(page + 1)}>
							Next conflicts
						</Button>
					</Flex>
				)}
				<Text fontSize="12px">
					{choices.size} of {conflicts.length} choices ready{blocked ? ' · Some conflicts need changes in the source folders.' : ''}
				</Text>
				<Flex gap={2} wrap="wrap">
					<Button
						minHeight="40px"
						isDisabled={blocked || choices.size !== conflicts.length}
						onClick={() => onApply([...choices].map(([path, from]) => ({ path, from })))}
					>
						Apply choices and sync
					</Button>
					<Button minHeight="40px" variant="outline" onClick={onCancel}>
						Cancel review
					</Button>
				</Flex>
			</Stack>
		</Box>
	);
}
