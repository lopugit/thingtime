import React from 'react';
import { Button, Flex, Input, Modal, ModalBody, ModalCloseButton, ModalContent, ModalHeader, ModalOverlay, Switch, Text } from '@chakra-ui/react';
import { useLopu } from '~/components/Lopu/useLopu';
import { DRAWER_MODAL_OVERLAY_Z, DRAWER_MODAL_Z } from '~/components/Nav/Drawer/useDrawer';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { draftRequest, listAccountDrafts } from './draftClient';
import type { AccountDraft, DraftSummary, DraftSurface } from './draftCore';

export function DraftSaveStatus({ status, error, retry }: { status: string; error: string; retry: () => Promise<void> }) {
	return (
		<Flex alignItems="center" gap={2} flexWrap="wrap" minW={0}>
			<Text fontSize="xs" color="var(--tt-muted, #777)" role="status">
				{status === 'saved'
					? 'Saved to your drafts ✓'
					: status === 'saving'
					? 'Saving draft…'
					: status === 'offline'
					? 'Draft waiting to sync'
					: status === 'conflict'
					? 'Draft changed or was removed elsewhere'
					: 'Changes save privately as drafts'}
			</Text>
			{error && (
				<Button
					size="xs"
					variant="ghost"
					title={error}
					onClick={() => {
						void retry().catch(() => {});
					}}
				>
					{status === 'conflict' ? 'Save as a new draft' : 'Retry save'}
				</Button>
			)}
		</Flex>
	);
}
export function DraftPicker({
	actor,
	surface,
	targetId,
	disabled,
	beforeOpen,
	onDeleted,
	onLoad
}: {
	actor: string;
	surface?: DraftSurface;
	targetId?: string;
	disabled?: boolean;
	beforeOpen?: () => Promise<void>;
	onDeleted?: (id: string) => Promise<void>;
	onLoad: (draft: AccountDraft) => Promise<void>;
}) {
	const [open, setOpen] = React.useState(false),
		[filter, setFilter] = React.useState<'all' | 'draft' | 'template'>('all');
	const [search, setSearch] = React.useState(''),
		[error, setError] = React.useState(''),
		[busy, setBusy] = React.useState(false);
	const cacheKey = `tt-draft-list:${location.origin}:${actor}:${surface || 'all'}`;
	const [rows, setRows] = React.useState<DraftSummary[]>(() => readLocalCache<DraftSummary[]>(cacheKey) || []);
	const [cursor, setCursor] = React.useState<string | null>(null);
	const lopu = useLopu();
	const resumeKey = `tt-draft-resume:${location.origin}:${actor}`;
	const [resume, setResume] = React.useState(() => localStorage.getItem(resumeKey) !== 'false');
	const copies = React.useRef(new Map<string, string>());
	const mounted = React.useRef(true);
	React.useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const refresh = async (next?: string) => {
		setError('');
		try {
			const response = await listAccountDrafts(actor, { ...(surface ? { surface } : {}), ...(next ? { cursor: next } : {}) });
			if (!mounted.current) return;
			setRows((previous) => {
				const combined = next ? [...previous, ...response.drafts] : response.drafts;
				writeLocalCache(cacheKey, combined);
				return combined;
			});
			setCursor(response.nextCursor);
		} catch (failure) {
			if (mounted.current) setError((failure as Error).message);
		}
	};
	const choose = async (row: DraftSummary) => {
		if (busy) return;
		setBusy(true);
		setError('');
		try {
			if (!copies.current.has(row.id)) copies.current.set(row.id, crypto.randomUUID());
			const response =
				row.mode === 'template'
					? await draftRequest(actor, { operation: 'instantiate', sourceId: row.id, id: copies.current.get(row.id) })
					: await draftRequest(actor, undefined, { id: row.id });
			await onLoad(response.draft);
			copies.current.delete(row.id);
			if (mounted.current) setOpen(false);
		} catch (failure) {
			if (mounted.current) setError((failure as Error).message);
		} finally {
			if (mounted.current) setBusy(false);
		}
	};
	const discard = async (row: DraftSummary) => {
		if (busy) return;
		setBusy(true);
		try {
			await draftRequest(actor, { operation: 'delete', id: row.id, revision: row.revision });
			await onDeleted?.(row.id);
			setRows((previous) => {
				const next = previous.filter((entry) => entry.id !== row.id);
				writeLocalCache(cacheKey, next);
				return next;
			});
			lopu({ title: row.mode === 'template' ? 'Template removed' : 'Draft discarded', status: 'success' });
		} catch (failure) {
			setError((failure as Error).message);
		} finally {
			setBusy(false);
		}
	};
	const visibleRows = rows.filter(
		(row) =>
			!row.context.startsWith('post:edit:') &&
			(!targetId || row.context.endsWith(`:${targetId}`)) &&
			!localStorage.getItem(`tt-account-draft:${location.origin}:${actor}:${row.context}:retired:${row.id}`) &&
			(filter === 'all' || row.mode === filter) &&
			row.name.toLowerCase().includes(search.toLowerCase())
	);

	return (
		<>
			<Button
				size="xs"
				variant="outline"
				borderRadius="999px"
				isDisabled={disabled}
				onClick={() => {
					setOpen(true);
					setBusy(true);
					void (async () => {
						try {
							await beforeOpen?.();
							await refresh();
						} catch (failure) {
							setError((failure as Error).message);
						} finally {
							if (mounted.current) setBusy(false);
						}
					})();
				}}
			>
				Load drafts & templates
			</Button>
			<Modal
				isOpen={open}
				onClose={() => {
					if (!busy) setOpen(false);
				}}
				size="lg"
				scrollBehavior="inside"
				isCentered
			>
				<ModalOverlay zIndex={DRAWER_MODAL_OVERLAY_Z} />
				<ModalContent maxW="min(560px, calc(100vw - 24px))" maxH="calc(100dvh - 24px)" containerProps={{ zIndex: DRAWER_MODAL_Z }}>
					<ModalHeader paddingRight={12}>Your drafts & templates</ModalHeader>
					<ModalCloseButton isDisabled={busy} />
					<ModalBody paddingBottom={6}>
						<Text fontSize="sm" mb={3}>
							Private to your account. Templates stay here when you use them.
						</Text>
						<Flex gap={2} align="center" mb={2}>
							<Switch
								id="draft-auto-resume"
								isChecked={resume}
								onChange={(event) => {
									setResume(event.target.checked);
									localStorage.setItem(resumeKey, String(event.target.checked));
								}}
							/>
							<Text as="label" htmlFor="draft-auto-resume" fontSize="sm">
								Automatically resume my latest account draft
							</Text>
						</Flex>
						<Text fontSize="xs" mb={3}>
							Drafts on this device always recover. Turn this off to choose account drafts yourself.
						</Text>
						<Flex gap={2} mb={3} flexWrap="wrap">
							{(['all', 'draft', 'template'] as const).map((kind) => (
								<Button key={kind} size="sm" variant={filter === kind ? 'solid' : 'ghost'} onClick={() => setFilter(kind)}>
									{kind === 'all' ? 'All' : kind === 'draft' ? 'Drafts' : 'Templates'}
								</Button>
							))}
						</Flex>
						<Input
							aria-label="Search drafts"
							placeholder="Search drafts…"
							value={search}
							onChange={(event) => setSearch(event.target.value)}
							mb={3}
						/>
						<Flex direction="column" gap={2}>
							{visibleRows.map((row) => (
								<Flex key={row.id} gap={2} align="center" minW={0}>
									<Button
										flex={1}
										minW={0}
										height="auto"
										py={3}
										whiteSpace="normal"
										textAlign="left"
										justifyContent="flex-start"
										variant="outline"
										isDisabled={busy}
										onClick={() => {
											void choose(row);
										}}
									>
										<Flex direction="column" align="flex-start" minW={0}>
											<Text overflowWrap="anywhere">
												{row.mode === 'template' ? '📋' : '✍️'} {row.name || 'Untitled draft'}
											</Text>
											<Text fontSize="xs" fontWeight="normal" mt={1}>
												{row.surface} · {new Date(row.updatedAt).toLocaleDateString()}
											</Text>
										</Flex>
									</Button>
									<Button
										size="xs"
										variant="ghost"
										isDisabled={busy}
										onClick={() => {
											void discard(row);
										}}
									>
										Delete
									</Button>
								</Flex>
							))}
							{!visibleRows.length && (
								<Text fontSize="sm" color="var(--tt-muted, #777)">
									No matching drafts yet. Your changes appear here as you write.
								</Text>
							)}
							{cursor && (
								<Button
									size="sm"
									variant="ghost"
									onClick={() => {
										void refresh(cursor);
									}}
								>
									Load more
								</Button>
							)}
							{error && (
								<Text role="alert" fontSize="sm" color="red.600">
									{error}
								</Text>
							)}
						</Flex>
					</ModalBody>
				</ModalContent>
			</Modal>
		</>
	);
}
