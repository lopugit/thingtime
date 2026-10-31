import React, { useId, useState } from 'react';
import { Box, Button, Checkbox, Flex, FormControl, FormLabel, Input, Select, Stack, Text } from '@chakra-ui/react';
import type { FolderRequest, FolderResult, MobileFolder } from '~/fileSync/mobileFolders.client';
import {
	readNativeVersionRestore,
	type NativeVersion,
	type NativeVersionPage,
	type NativeVersionRestore,
	validNativeRestore,
	type NativeRecoveryItem,
	type NativeRecoveryPage,
	type NativeRestore
} from '~/fileSync/nativeRecovery';

type Request = (request: FolderRequest) => Promise<FolderResult>;
export function NativeFileRecovery({
	roots,
	busy,
	versionsScopeKey,
	perform
}: {
	roots: MobileFolder[];
	busy: boolean;
	versionsScopeKey?: string;
	perform(work: (request: Request) => Promise<void>): Promise<void>;
}) {
	const id = useId();
	const [versions, setVersions] = useState(false);
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
				Find files retained when sync removed them from this device{versionsScopeKey ? ' or replaced their contents' : ''}. Keep the original folder
				selection to retain recovery access. Restore folders before their children, or choose a path inside an existing folder. Existing files are
				never overwritten.
			</Text>
			{versionsScopeKey && (
				<Checkbox
					marginTop={2}
					isChecked={versions}
					isDisabled={busy}
					onChange={(e) => {
						setVersions(e.target.checked);
						setReview(null);
						setPage(null);
						setNotice('');
					}}
				>
					Show replaced versions
				</Checkbox>
			)}
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
				{!versions && (
					<Button size="sm" minHeight="40px" isDisabled={busy || !currentRoot} onClick={() => void load()}>
						Find retained files
					</Button>
				)}
			</Flex>
			{versions && versionsScopeKey && currentRoot && (
				<NativeVersionRecovery key={rootId} rootId={rootId} name={currentRoot.name} scopeKey={versionsScopeKey} busy={busy} perform={perform} />
			)}
			{!versions && currentRoot && page && (
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

function NativeVersionRecovery({
	rootId,
	name,
	scopeKey,
	busy,
	perform
}: {
	rootId: string;
	name: string;
	scopeKey: string;
	busy: boolean;
	perform(work: (request: Request) => Promise<void>): Promise<void>;
}) {
	const id = useId();
	const storageKey = `tt:native-version-restore:${JSON.stringify([scopeKey, rootId])}`;
	const [page, setPage] = useState<NativeVersionPage | null>(null);
	const [review, setReview] = useState<{ restore: NativeVersionRestore; pending: boolean } | null>(null);
	const [notice, setNotice] = useState('');
	const load = (cursor?: string) =>
		perform(async (request) => {
			const result = await request({ action: 'version-list', rootId, ...(cursor ? { cursor } : {}) });
			if (!result.versionPage) throw Error('Native versions are unavailable. Update this app.');
			const pending = readNativeVersionRestore(window.localStorage.getItem(storageKey));
			setPage(result.versionPage);
			setReview(pending ? { restore: pending, pending: true } : null);
			setNotice('');
		});
	const inspect = (item: NativeVersion) =>
		perform(async (request) => {
			const pending = readNativeVersionRestore(window.localStorage.getItem(storageKey));
			if (pending) {
				setReview({ restore: pending, pending: true });
				return;
			}
			const result = await request({ action: 'version-inspect', rootId, versionId: item.versionId, expected: item.entry });
			if (!result.retainedEntry) throw Error('Retained version is unavailable.');
			setReview({
				restore: { versionId: item.versionId, operationId: crypto.randomUUID(), path: item.entry.path, expected: result.retainedEntry },
				pending: false
			});
			setNotice('');
		});
	const changeDestination = () =>
		perform(async (request) => {
			if (!review || !navigator.locks) throw Error('Update this app to coordinate version restoration.');
			await navigator.locks.request(storageKey, { ifAvailable: true }, async (lock) => {
				if (!lock) throw Error('Another window is restoring a version.');
				const raw = window.localStorage.getItem(storageKey),
					pending = readNativeVersionRestore(raw);
				if (!pending || JSON.stringify(pending) !== JSON.stringify(review.restore)) throw Error('The saved restore changed. Refresh the versions.');
				const result = await request({ action: 'version-restore-status', rootId, restore: pending });
				if (!result.versionRestore) throw Error('Restore status is unavailable. The saved request is preserved.');
				if (window.localStorage.getItem(storageKey) !== raw) throw Error('The saved restore changed. Refresh the versions.');
				window.localStorage.removeItem(storageKey);
				if (result.versionRestore.status === 'complete') {
					setReview(null);
					setNotice(`Already restored to ${result.versionRestore.entry.path}.`);
				} else {
					setReview({ restore: { ...pending, operationId: crypto.randomUUID() }, pending: false });
					setNotice('No copy was committed. You can choose another destination.');
				}
			});
		});
	const restore = () =>
		perform(async (request) => {
			if (!review) return;
			if (!navigator.locks) throw Error('Update this app to safely coordinate version restoration.');
			await navigator.locks.request(storageKey, { ifAvailable: true }, async (lock) => {
				if (!lock) throw Error('Another window is restoring a version from this folder.');
				const raw = window.localStorage.getItem(storageKey),
					pending = readNativeVersionRestore(raw);
				if (pending && JSON.stringify(pending) !== JSON.stringify(review.restore)) {
					setReview({ restore: pending, pending: true });
					throw Error('Resume the saved restore before choosing another version.');
				}
				const selected = pending ?? readNativeVersionRestore(JSON.stringify(review.restore))!;
				const saved = JSON.stringify(selected);
				window.localStorage.setItem(storageKey, saved);
				setReview({ restore: selected, pending: true });
				const result = await request({ action: 'version-restore-reviewed', rootId, restore: selected });
				if (!result.restoredEntry) throw Error('Restore is not confirmed. Resume this saved request.');
				if (window.localStorage.getItem(storageKey) !== saved) throw Error('The saved restore changed in another window. Refresh to reconcile it.');
				window.localStorage.removeItem(storageKey);
				setReview(null);
				setNotice(`Restored to ${result.restoredEntry.path}. The current file and retained version are preserved.`);
			});
		});
	return (
		<Stack spacing={2} marginTop={3} minWidth={0}>
			<Button alignSelf="start" size="sm" minHeight="40px" isDisabled={busy} onClick={() => void load()}>
				Find replaced versions
			</Button>
			<Text fontSize="12px" color="var(--tt-muted, #71717a)">
				These versions are saved on this device. Restore a copy to an unused path; the current file stays unchanged.
			</Text>
			{page?.items.map((item) => (
				<Flex key={item.versionId} gap={2} wrap="wrap" align="center">
					<Box flex={1} minWidth={0} overflowWrap="anywhere">
						<Text fontSize="13px">{item.entry.path}</Text>
						<Text fontSize="12px" color="var(--tt-muted, #71717a)">
							{item.entry.size.toLocaleString()} bytes · {item.capturedAt === null ? 'Earlier version' : new Date(item.capturedAt).toLocaleString()}
						</Text>
					</Box>
					<Button size="sm" minHeight="40px" variant="outline" isDisabled={busy} onClick={() => void inspect(item)}>
						Review version
					</Button>
				</Flex>
			))}
			{page?.items.length === 0 && <Text fontSize="12px">No replaced versions on this page.</Text>}
			{page?.nextCursor && (
				<Button size="sm" alignSelf="start" minHeight="40px" isDisabled={busy} onClick={() => void load(page.nextCursor!)}>
					Next page
				</Button>
			)}
			{review && (
				<Stack spacing={2} minWidth={0}>
					<Text fontSize="12px" overflowWrap="anywhere">
						Restore an earlier version of {review.restore.expected.path} into {name}.
					</Text>
					<FormControl>
						<FormLabel htmlFor={`${id}-path`} fontSize="12px">
							New copy path within this folder
						</FormLabel>
						<Input
							id={`${id}-path`}
							minHeight="40px"
							value={review.restore.path}
							isDisabled={busy || review.pending}
							onChange={(e) => setReview({ ...review, restore: { ...review.restore, path: e.target.value } })}
						/>
					</FormControl>
					<Text fontSize="12px" color="var(--tt-muted, #71717a)">
						{review.pending
							? 'Resume the saved destination after an interruption. The original operation is preserved.'
							: 'Choose an unused path. Your device will ask you to confirm.'}
					</Text>
					{review.pending && (
						<Button alignSelf="start" size="sm" minHeight="40px" variant="outline" isDisabled={busy} onClick={() => void changeDestination()}>
							Check restore before changing destination
						</Button>
					)}
					<Button
						alignSelf="start"
						size="sm"
						minHeight="40px"
						isDisabled={busy || !validNativeRestore(review.restore, review.restore.expected.path)}
						onClick={() => void restore()}
					>
						{review.pending ? 'Resume version restore' : 'Restore version copy'}
					</Button>
				</Stack>
			)}
			{notice && (
				<Text role="status" fontSize="12px" overflowWrap="anywhere">
					{notice}
				</Text>
			)}
		</Stack>
	);
}
