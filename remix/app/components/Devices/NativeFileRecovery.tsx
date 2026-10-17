import React, { useId, useState } from 'react';
import { Box, Button, Flex, FormControl, FormLabel, Input, Select, Stack, Text } from '@chakra-ui/react';
import type { FolderRequest, FolderResult, MobileFolder } from '~/fileSync/mobileFolders.client';
import { validNativeRestore, type NativeRecoveryItem, type NativeRecoveryPage, type NativeRestore } from '~/fileSync/nativeRecovery';

type Request = (request: FolderRequest) => Promise<FolderResult>;
export function NativeFileRecovery({
	roots,
	busy,
	perform
}: {
	roots: MobileFolder[];
	busy: boolean;
	perform(work: (request: Request) => Promise<void>): Promise<void>;
}) {
	const id = useId();
	const [rootId, setRootId] = useState('');
	const [page, setPage] = useState<NativeRecoveryPage | null>(null);
	const [review, setReview] = useState<{ item: NativeRecoveryItem; restore: NativeRestore; pending: boolean } | null>(null);
	const [notice, setNotice] = useState('');
	const currentRoot = roots.find((root) => root.id === rootId);
	const load = (cursor?: string) =>
		perform(async (request) => {
			const result = await request({ action: 'trash-list', rootId, ...(cursor ? { cursor } : {}) });
			if (!result.trashPage) throw Error('Native recovery is unavailable. Update this app.');
			setPage(result.trashPage);
			setReview(null);
			setNotice('');
		});
	return (
		<Box marginTop={4} borderTop="1px solid var(--tt-border, #ececef)" paddingTop={3} minWidth={0}>
			<Text fontSize="13px" fontWeight={700}>
				Recover device files
			</Text>
			<Text fontSize="12px" color="var(--tt-muted, #71717a)">
				Find files retained when sync removed them from this device. Keep the original folder selection to retain recovery access. Restore folders
				before their children, or choose a path inside an existing folder. Existing files are never overwritten.
			</Text>
			<Flex gap={2} wrap="wrap" marginTop={2} align="end">
				<FormControl flex={1} minWidth="min(100%, 200px)">
					<FormLabel htmlFor={`${id}-root`} fontSize="12px">
						Device folder
					</FormLabel>
					<Select
						id={`${id}-root`}
						minHeight="40px"
						value={rootId}
						isDisabled={busy}
						onChange={(event) => {
							setRootId(event.target.value);
							setPage(null);
							setReview(null);
							setNotice('');
						}}
					>
						<option value="">Choose a folder</option>
						{roots.map((root) => (
							<option key={root.id} value={root.id}>
								{root.name}
							</option>
						))}
					</Select>
				</FormControl>
				<Button size="sm" minHeight="40px" isDisabled={busy || !currentRoot} onClick={() => void load()}>
					Find retained files
				</Button>
			</Flex>
			{currentRoot && page && (
				<Stack spacing={2} marginTop={3}>
					{page.items.map((item) => (
						<Flex key={JSON.stringify([item.request.scope, item.request.operation.id])} gap={2} align="center" wrap="wrap">
							<Box flex={1} minWidth={0} overflowWrap="anywhere">
								<Text fontSize="13px">{item.request.operation.mutation.path}</Text>
								<Text fontSize="12px" color="var(--tt-muted, #71717a)">
									{item.kind === 'file' ? `${item.size.toLocaleString()} bytes` : item.kind === 'folder' ? 'Folder' : 'Unsupported item'}
									{item.state === 'restoring'
										? ' · Restore awaiting confirmation'
										: item.state === 'needs-review'
										? ' · Needs review'
										: ' · Retained on this device'}
								</Text>
							</Box>
							<Button
								size="sm"
								minHeight="40px"
								variant="outline"
								isDisabled={busy || item.kind === 'other'}
								onClick={() =>
									void perform(async (request) => {
										const result = await request({ action: 'trash-inspect', rootId, trash: item.request });
										if (result.restoreIntent === undefined) throw Error('Update this app to review recovery safely.');
										if (result.restoreIntent?.receipt) {
											setReview(null);
											setNotice('This file has already been restored. Refresh the list.');
											return;
										}
										const restore =
											result.restoreIntent?.request ??
											(result.retainedEntry ? { path: item.request.operation.mutation.path, expected: result.retainedEntry } : null);
										if (!restore) throw Error('This retained file is no longer available. Refresh the list.');
										setReview({ item, restore, pending: !!result.restoreIntent });
										setNotice('');
									})
								}
							>
								Review restore
							</Button>
						</Flex>
					))}
					{page.items.length === 0 && (
						<Text fontSize="12px">No retained files on this page.{page.nextCursor ? ' Check the next page for more records.' : ''}</Text>
					)}
					{page.nextCursor && (
						<Button size="sm" minHeight="40px" alignSelf="start" isDisabled={busy} onClick={() => void load(page.nextCursor!)}>
							Next page
						</Button>
					)}
				</Stack>
			)}
			{currentRoot && review && (
				<Stack marginTop={3} spacing={2} minWidth={0}>
					<Text fontSize="12px" overflowWrap="anywhere">
						Restore {review.item.request.operation.mutation.path} into {currentRoot.name}.
					</Text>
					<FormControl>
						<FormLabel htmlFor={`${id}-path`} fontSize="12px">
							Destination path within this folder
						</FormLabel>
						<Input
							id={`${id}-path`}
							minHeight="40px"
							value={review.restore.path}
							isDisabled={busy || review.pending}
							onChange={(event) => setReview({ ...review, restore: { ...review.restore, path: event.target.value } })}
						/>
					</FormControl>
					<Text fontSize="12px" color="var(--tt-muted, #71717a)">
						{review.pending
							? 'Resume the previously approved destination. Its restore record survives closing the app.'
							: 'Your device will ask you to confirm before restoring.'}
					</Text>
					<Button
						size="sm"
						minHeight="40px"
						alignSelf="start"
						isDisabled={busy || !validNativeRestore(review.restore, review.item.request.operation.mutation.path)}
						onClick={() =>
							void perform(async (request) => {
								const result = await request({ action: 'trash-restore-reviewed', rootId, trash: review.item.request, restore: review.restore });
								if (!result.restoredEntry) throw Error('Restore is not yet confirmed. Review this item again to resume.');
								setReview(null);
								setNotice(`Restored to ${result.restoredEntry.path}. Refresh the list to continue.`);
							})
						}
					>
						{review.pending ? 'Resume restore' : 'Restore file or folder'}
					</Button>
				</Stack>
			)}
			{notice && (
				<Text role="status" fontSize="12px" marginTop={2} overflowWrap="anywhere">
					{notice}
				</Text>
			)}
		</Box>
	);
}
