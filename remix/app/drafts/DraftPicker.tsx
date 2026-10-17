import React from 'react';
import { Button, Flex, Input, Modal, ModalBody, ModalCloseButton, ModalContent, ModalHeader, ModalOverlay, Switch, Text } from '@chakra-ui/react';
import { useLopu } from '~/components/Lopu/useLopu';
import { DRAWER_MODAL_OVERLAY_Z, DRAWER_MODAL_Z } from '~/components/Nav/Drawer/useDrawer';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { workspaceStorageBinding, workspaceStorageIdentity, subscribeWorkspaceStorage } from '../local-workspace/storageStatus.client';
import { workspaceScopeKey } from '../local-workspace/storage';
import { LOCAL_WORKSPACE_CHANGED, LOCAL_WORKSPACE_OWNER } from '../local-workspace/runtime.client';
import { draftRequest } from './draftClient';
import type { AccountDraft, DraftSummary, DraftSurface } from './draftCore';

export function DraftSaveStatus({ status, error, retry, paused = false }: { status: string; error: string; retry: () => Promise<void>; paused?: boolean }) {
	return (
		<Flex alignItems="center" gap={2} flexWrap="wrap" minW={0}>
			<Text fontSize="xs" color="var(--tt-muted, #777)" role="status">
				{paused ? 'Draft recovery needs attention' : status === 'saved'
					? 'Draft saved on this device ✓'
					: status === 'saving'
					? 'Saving draft…'
					: status === 'offline'
					? 'Draft waiting to sync'
					: status === 'conflict'
					? 'Draft changed or was removed elsewhere'
					: 'Changes save privately as drafts'}
			</Text>
			{paused && error && <Text fontSize="xs" role="alert">{error}</Text>}
			{error && !paused && (
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
export function DraftPicker(props: React.ComponentProps<typeof DraftPickerSession>) {
 const identity=React.useSyncExternalStore(subscribeWorkspaceStorage,workspaceStorageIdentity,()=> '');
 return <DraftPickerSession key={JSON.stringify([identity,props.actor,props.surface,props.context,props.targetId])} {...props}/>;
}
function DraftPickerSession({
	actor,
	surface,
	targetId,
	context,
	includeTemplates = false,
	label,
	disabled,
	beforeOpen,
	onDeleted,
	onLoad
}: {
	actor: string;
	surface?: DraftSurface;
	targetId?: string;
	context?: string;
	includeTemplates?: boolean;
	label?: string;
	disabled?: boolean;
	beforeOpen?: () => Promise<void>;
	onDeleted?: (id: string) => Promise<void>;
	onLoad: (draft: AccountDraft) => Promise<void>;
}) {
	const localOnly = actor === LOCAL_WORKSPACE_OWNER;
	const binding=React.useMemo(()=>workspaceStorageBinding(),[]);
	const request:typeof draftRequest=async (...args)=>{if(!binding)throw new Error('Draft workspace is not ready.');binding.lease.assertCurrent();const result=await draftRequest(...args);binding.lease.assertCurrent();return result as any;};
	const refreshSequence=React.useRef(0);
	const [partial,setPartial]=React.useState(false);
	const [open, setOpen] = React.useState(false),
		[filter, setFilter] = React.useState<'all' | 'draft' | 'template'>('all');
	const [search, setSearch] = React.useState(''),
		[error, setError] = React.useState(''),
		[busy, setBusy] = React.useState(false);
	const cacheKey = `tt-draft-list:${binding?workspaceScopeKey(binding.scope):'unconfirmed'}:${actor}:${surface || 'all'}${context ? `:${context}` : ''}`;
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
		const sequence=++refreshSequence.current;
		try {
			const response = await request<{drafts:DraftSummary[];nextCursor:string|null;partial?:boolean}>(actor, undefined, { ...(surface ? { surface } : {}), ...(context && !includeTemplates ? { context } : {}), ...(next ? { cursor: next } : {}) });
			if (!mounted.current || sequence!==refreshSequence.current) return;
			setPartial(!!response.partial);
			setRows((previous) => {
				const combined = next ? [...new Map([...previous,...response.drafts].map(row=>[row.id,row])).values()] : response.drafts;
				writeLocalCache(cacheKey, combined);
				return combined;
			});
			setCursor(response.nextCursor);
		} catch (failure) {
			if (mounted.current) setError((failure as Error).message);
		}
	};
	React.useEffect(()=>{ if(!open)return;const update=()=>{void refresh();};window.addEventListener(LOCAL_WORKSPACE_CHANGED,update);return ()=>window.removeEventListener(LOCAL_WORKSPACE_CHANGED,update);
	// The keyed session owns the identity; refresh uses functional row updates.
	// eslint-disable-next-line react-hooks/exhaustive-deps
	},[open]);
	const choose = async (row: DraftSummary) => {
		if (busy) return;
		setBusy(true);
		setError('');
		try {
			if (!copies.current.has(row.id)) copies.current.set(row.id, crypto.randomUUID());
			const response =
				row.mode === 'template'
					? await request(actor, { operation: 'instantiate', sourceId: row.id, id: copies.current.get(row.id), ...(context ? { context } : {}) })
					: await request(actor, undefined, { id: row.id });
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
			await request(actor, { operation: 'delete', id: row.id, revision: row.revision });
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
			(!context || row.context === context || (includeTemplates && row.mode === 'template')) &&
			(!targetId || row.context.endsWith(`:${targetId}`)) &&
			!localStorage.getItem(`tt-account-draft:${location.origin}:${actor}:${row.context}:retired:${row.id}`) &&
			!localStorage.getItem(`tt-account-draft:${location.origin}:${actor}:${row.context}:workspace-store:${binding?workspaceScopeKey(binding.scope):'unconfirmed'}:retired:${row.id}`) &&
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
				{label || 'Load drafts & templates'}
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
							{localOnly ? 'Stored on this device only.' : 'Saved on this device, with private account sync when connected.'} Templates stay here when you use them.
						</Text>
						{partial && !navigator.onLine ? <Text fontSize="sm" mb={3}>Only drafts already loaded on this device are available offline.</Text> : null}
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
								Automatically resume my latest {localOnly ? 'saved' : 'account'} draft
							</Text>
						</Flex>
						<Text fontSize="xs" mb={3}>
							{localOnly ? 'Your current editor recovers on this device. Turn this off to choose other saved drafts yourself.' : 'Drafts on this device always recover. Turn this off to choose account drafts yourself.'}
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
