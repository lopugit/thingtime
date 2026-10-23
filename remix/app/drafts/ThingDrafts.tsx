import React from 'react';
import { LegacyEditorTreeRecovery } from '../local-workspace/WorkspaceThingtimeProvider';
import { smarts } from '../smarts';
import { Flex } from '@chakra-ui/react';
import { useWorkspaceUser } from '~/hooks/useWorkspaceUser';
import { useThingtime } from '~/components/Thingtime/useThingtime';
import { clearLocalCache } from '~/hooks/localCache';
import { useLopu } from '~/components/Lopu/useLopu';
import { workspaceStorageBinding, workspaceStorageIdentity, subscribeWorkspaceStorage } from '../local-workspace/storageStatus.client';
import { DraftPicker, DraftSaveStatus } from './DraftPicker';
import type { DraftSaveState } from './draftSession';
import type { AccountDraft } from './draftCore';
import { createThingDraftWorkspace, ThingDraftRecoveryError } from './thingDraftWorkspace';

const DraftContext = React.createContext<{
	resume: (path: string) => void;
	load: (draft: AccountDraft) => Promise<void>;
	flush: () => Promise<void>;
	forget: (id: string) => Promise<void>;
	retry: () => Promise<void>;
	status: DraftSaveState;
	error: string;
	paused: boolean;
} | null>(null);
export function ThingDraftsProvider({ children }: { children: React.ReactNode }) {
	const identity = React.useSyncExternalStore(subscribeWorkspaceStorage, workspaceStorageIdentity, () => '');
	// A generation change retires all sessions, even for the same account/plane.
	// eslint-disable-next-line react-hooks/exhaustive-deps
	const binding = React.useMemo(() => workspaceStorageBinding(), [identity]);
	return <WorkspaceThingDrafts key={identity} binding={binding}>{children}</WorkspaceThingDrafts>;
}
function WorkspaceThingDrafts({ children, binding }: {
	children: React.ReactNode;
	binding: ReturnType<typeof workspaceStorageBinding>;
}) {
	const user = useWorkspaceUser(), { events, setThingtime } = useThingtime(), lopu = useLopu();
	const [status, setStatus] = React.useState<DraftSaveState>('idle'), [error, setError] = React.useState('');
	const [paused, setPaused] = React.useState(false);
	const recoveryFailure = React.useRef('');
	const warned = React.useRef(false);
	const callbacks = React.useRef({ setThingtime, lopu });
	callbacks.current = { setThingtime, lopu };
	const workspace = React.useMemo(() => binding && user?.id ? createThingDraftWorkspace({
		actor: user.id, origin: location.origin, scope: binding.scope, lease: binding.lease,
		read: key => { const raw = localStorage.getItem(key); return raw === null ? null : JSON.parse(raw); }, uuid: () => crypto.randomUUID(),
		restore: (path, value, recovery) => callbacks.current.setThingtime(path, value, { namespace: 'user', ...(recovery ? { fromRemote: true, ignoreUndoRedo: true } : {}) }),
		persist: (key, value) => {
			if (!value) { clearLocalCache(key); return; }
			try { localStorage.setItem(key, JSON.stringify(value)); }
			catch {
				if (!warned.current) {
					warned.current = true;
					callbacks.current.lopu({ title: 'Device draft storage is full', description: 'Keep this page open until the draft is saved on this device.', status: 'error' });
				}
			}
		},
		changed: (next, message) => { setStatus(next); setError(recoveryFailure.current || message || ''); }
	}) : null, [binding, user?.id]);
	const report = React.useCallback((failure: unknown) => {
		setStatus('offline');
		if (failure instanceof ThingDraftRecoveryError) recoveryFailure.current = failure.message;
		setPaused(!!recoveryFailure.current);
		setError(recoveryFailure.current || (failure instanceof Error ? failure.message : 'This Thing could not be saved as a draft'));
	}, []);
	const resume = React.useCallback((path: string) => {
		try {
			const parts = smarts.parsePropertyPath(path);
			while (parts[0] === 'tt' || parts[0] === 'thingtime') parts.shift();
			if (parts.length) workspace?.resume([parts[0]]);
		} catch (failure) { report(failure); }
	}, [workspace, report]);
	React.useEffect(() => {
		const subscription = events?.subscribe((event: any) => {
			if (event?.type !== 'draft-edit' || !workspace) return;
			try { workspace.capture(event.path, event.value); }
			catch (failure) { report(failure); }
		});
		const flush = () => { void workspace?.flush().catch(() => {}); };
		const retry = () => { void workspace?.retry().catch(() => {}); };
		window.addEventListener('pagehide', flush);
		window.addEventListener('online', retry);
		return () => {
			subscription?.unsubscribe();
			window.removeEventListener('pagehide', flush);
			window.removeEventListener('online', retry);
			// React StrictMode replays effects on the same workspace. Disposal is
			// handled by the workspace lifetime effect below.
		};
	}, [events, workspace, report]);
	const mounted = React.useRef<ReturnType<typeof createThingDraftWorkspace> | null>(null);
	React.useEffect(() => {
		mounted.current = workspace;
		return () => {
			mounted.current = null;
			queueMicrotask(() => { if (mounted.current !== workspace) workspace?.dispose(); });
		};
	}, [workspace]);
	const unavailable = async () => { throw new Error('Draft workspace is not ready. Reopen this editor.'); };
	return <DraftContext.Provider value={{ resume, load: workspace?.load || unavailable, flush: workspace?.flush || unavailable,
		forget: workspace?.forget || unavailable, retry: workspace?.retry || unavailable, status, error, paused }}>{children}</DraftContext.Provider>;
}
export function ThingDraftPicker() {
	const user = useWorkspaceUser(),
		drafts = React.useContext(DraftContext);
	return user && drafts ? (
		<Flex px={3} py={2} gap={3} justify="flex-end" flexWrap="wrap">
			<DraftSaveStatus status={drafts.status} error={drafts.error} paused={drafts.paused} retry={drafts.retry} />
			<LegacyEditorTreeRecovery />
			<DraftPicker actor={user.id} surface="thing" onLoad={drafts.load} beforeOpen={drafts.flush} onDeleted={drafts.forget} />
		</Flex>
	) : null;
}

/** Embedded/read-only foreign Things must not recover into the user tree. */
export function useThingDraftRecovery(path: string, enabled = true) {
 const drafts = React.useContext(DraftContext), { loading } = useThingtime();
 const resume = drafts?.resume;
 React.useEffect(() => { if (enabled && !loading) resume?.(path); }, [enabled, loading, path, resume]);
}
