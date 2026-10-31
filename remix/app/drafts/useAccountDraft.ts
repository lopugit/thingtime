import { workspaceStorageBinding, workspaceStorageIdentity, subscribeWorkspaceStorage } from '../local-workspace/storageStatus.client';
import { workspaceDraftRecoveryKey } from './workspaceDraft';
import { LOCAL_WORKSPACE_CHANGED } from '../local-workspace/runtime.client';
import React from 'react';
import { clearLocalCache, readLocalCache } from '~/hooks/localCache';
import { inspectDraftRecovery } from './draftRecovery';
import { draftRequest } from './draftClient';
import { createDraftSession, type LocalDraft, type DraftSaveState } from './draftSession';
import type { AccountDraft, DraftContent, DraftSurface, DraftSummary } from './draftCore';

export function useAccountDraft({
	actor,
	context,
	surface,
	onRestore,
	resumeRemote = true,
	request: requestInput = draftRequest,
	validateSnapshot
}: {
	actor?: string | null;
	context: string;
	surface: DraftSurface;
	onRestore: (draft: AccountDraft) => void;
	resumeRemote?: boolean;
	request?: typeof draftRequest;
	validateSnapshot?: (snapshot: string) => unknown;
}) {
	const identity = React.useSyncExternalStore(subscribeWorkspaceStorage, workspaceStorageIdentity, () => '');
	// Capture this generation even when actor and editor context stay the same.
	// eslint-disable-next-line react-hooks/exhaustive-deps
	const binding = React.useMemo(() => workspaceStorageBinding(), [identity]);
	const request = React.useMemo<typeof draftRequest>(() => async (...args) => {
		if (!binding) throw new Error('Draft workspace is not ready. Reopen this editor.');
		binding.lease.assertCurrent(); const result = await requestInput(...args); binding.lease.assertCurrent(); return result as any;
	}, [binding, requestInput]);
	const origin = typeof location === 'undefined' ? '' : location.origin;
	const key = binding ? workspaceDraftRecoveryKey(origin, actor || 'guest', context, binding.scope) : `tt-account-draft:${origin}:${actor || 'guest'}:${context}:workspace-store:unconfirmed`;
	const [status, setStatus] = React.useState<DraftSaveState>('idle');
	const [error, setError] = React.useState('');
	const [deviceError, setDeviceError] = React.useState('');
	const validate = React.useRef(validateSnapshot);
	validate.current = validateSnapshot;
	const recovery = React.useMemo(() => inspectDraftRecovery(actor ? readLocalCache<LocalDraft>(key) : null, validate.current), [actor, key]);
	const scope = React.useMemo(() => ({ key, active: true, current: () => { try { binding?.lease.assertCurrent(); return !!binding; } catch { return false; } }, touched: false, restoring: false, baseline: null as string | null }), [key, binding]);
	const restore = React.useRef(onRestore);
	restore.current = onRestore;
	const session = React.useMemo(
		() =>
			createDraftSession({
				seed: recovery.seed,
				uuid: () => crypto.randomUUID(),
				save: async (input) => (await request(actor!, { operation: 'save', ...input })).draft,
				copy: async (input) => (await request(actor!, { operation: 'recover', ...input })).draft,
				recovered: (value) => {
					if (scope.active && scope.current()) {
						scope.baseline = value.content.snapshot;
						restore.current({ ...value.content, id: value.id, revision: value.revision, mode: 'draft', createdAt: '', updatedAt: '' });
					}
				},
				persist: (value) => {
					if (!actor || recovery.error || !scope.current()) return;
					if (!value) {
						clearLocalCache(key);
						// Retirement/clear leaves no draft to recover, so a stale device
						// warning would only offer a retry that can never do anything.
						// A still-failing retirement re-reports once its cleanup settles.
						if (scope.active && scope.current()) setDeviceError('');
						return;
					}
					try {
						window.localStorage.setItem(key, JSON.stringify(value));
						if (scope.active && scope.current()) setDeviceError('');
					} catch {
						if (scope.active && scope.current()) setDeviceError('Device recovery storage is unavailable; keep this page open until posting or account saving finishes.');
					}
				},
				changed: (next, message) => {
					if (scope.active && scope.current()) {
						setStatus(next);
						setError(message || '');
					}
				}
			}),
		[actor, key, scope, request, recovery]
	);
	const accept = React.useCallback(
		async (draft: AccountDraft) => {
			validate.current?.(draft.snapshot);
			await session.load(draft);
			if (!scope.active || !scope.current()) return;
			const saved = session.current();
			const selected = saved ? { ...draft, ...saved.content, id: saved.id, revision: saved.revision } : draft;
			scope.baseline = selected.snapshot;
			scope.touched = true;
			restore.current(selected);
		},
		[session, scope]
	);
	React.useEffect(() => {
		scope.active = true;
		let cancelled = false;
		const retryRetired = async () => {
			const prefix = `${key}:retired:`;
			for (const savedKey of Object.keys(localStorage).filter((entry) => entry.startsWith(prefix))) {
				const retired = readLocalCache<{ id: string; revision: number; completed?: boolean; conflicted?: boolean }>(savedKey);
				// A conflicted completion is already settled: the marker only has to keep
				// suppressing resume, so stop re-sending a delete that can never apply.
				if (!retired || !actor || retired.conflicted) continue;
				try {
					await request(actor, { operation: 'delete', id: retired.id, revision: retired.revision });
					localStorage.removeItem(savedKey);
				} catch (failure) {
					const status = (failure as any)?.status;
					if ([404, 410].includes(status)) localStorage.removeItem(savedKey);
					// 409 means a newer remote revision exists. Never delete that newer
					// work; for a completed post, retain the marker so the published draft
					// still cannot auto-resume, but retire the doomed retry.
					else if (status === 409) {
						if (!retired.completed) localStorage.removeItem(savedKey);
						else
							try {
								localStorage.setItem(savedKey, JSON.stringify({ ...retired, conflicted: true }));
							} catch {
								/* Resume suppression already relies on the marker that is present. */
							}
					}
				}
			}
		};
		void retryRetired();
		const resume = () => {
			if (cancelled || !scope.current() || scope.touched || session.current() || recovery.error || !actor || !resumeRemote || localStorage.getItem(`tt-draft-resume:${location.origin}:${actor}`) === 'false') return;
			void request<{ drafts: DraftSummary[] }>(actor, undefined, { context, surface })
				.then(async (result) => {
					const found = result.drafts.find((entry) => entry.mode === 'draft' && !localStorage.getItem(`${key}:retired:${entry.id}`));
					if (!found || cancelled || scope.touched) return;
					const response = await request(actor, undefined, { id: found.id });
					if (!cancelled && !scope.touched) await accept(response.draft);
				})
				.catch((failure) => {
					if (!cancelled) setError(failure.message || 'Could not check account drafts');
				});
		};
		const local = session.current();
		if (local) {
			scope.restoring = true;
			queueMicrotask(() => {
				scope.restoring = false;
			});
			scope.baseline = local.content.snapshot;
			scope.touched = true;
			restore.current({ ...local.content, id: local.id, revision: local.revision, mode: 'draft', createdAt: '', updatedAt: '' });
			if (local.dirty !== false || local.pending || local.pendingCopy) void session.retry().catch(() => {});
			else setStatus('saved');
		} else resume();
		const flush = () => {
			void session.flush().catch(() => {});
		};
		const retry = () => {
			void retryRetired();
			void session.retry().catch(() => {});
		};
		window.addEventListener(LOCAL_WORKSPACE_CHANGED, resume);
		window.addEventListener('pagehide', flush);
		window.addEventListener('online', retry);
		document.addEventListener('visibilitychange', flush);
		return () => {
			cancelled = true;
			scope.active = false;
			window.removeEventListener(LOCAL_WORKSPACE_CHANGED, resume);
			window.removeEventListener('pagehide', flush);
			window.removeEventListener('online', retry);
			document.removeEventListener('visibilitychange', flush);
			// Do not cancel the last keystroke's network save on navigation.
			queueMicrotask(() => {
				if (!scope.active) session.dispose();
			});
		};
	}, [actor, context, key, surface, session, accept, scope, resumeRemote, request, recovery]);
	const capture = React.useCallback(
		(content: DraftContent, hasContent = true, force = false) => {
			if (!actor || !scope.current() || scope.restoring || recovery.error) return;
			if (scope.baseline === null && !force) {
				scope.baseline = content.snapshot;
				return;
			}
			if (scope.baseline === content.snapshot) return;
			scope.baseline = content.snapshot;
			scope.touched = true;
			if (hasContent || session.current()) session.capture(content);
		},
		[actor, session, scope, recovery]
	);
	const clear = React.useCallback(async () => {
		await session.clear(async (id, revision) => {
			// Retire locally before the request: a lost cleanup response must never
			// reopen an already-published post as unfinished work.
			const retiredKey = `${key}:retired:${id}`;
			clearLocalCache(key);
			try {
				localStorage.setItem(retiredKey, JSON.stringify({ id, revision }));
			} catch {
				/* Account cleanup still proceeds when device storage is unavailable. */
			}
			try {
				await request(actor!, { operation: 'delete', id, revision });
				localStorage.removeItem(retiredKey);
			} catch (failure) {
				if ([404, 409, 410].includes((failure as any)?.status)) localStorage.removeItem(retiredKey);
			}
		});
		scope.baseline = null;
	}, [actor, key, session, scope, request]);
	const retire = React.useCallback(async () => {
		scope.baseline = null;
		return session.retire(async (id, revision) => {
			await request(actor!, { operation: 'delete', id, revision });
			localStorage.removeItem(`${key}:retired:${id}`);
		}, draft => {
			try {
				localStorage.setItem(`${key}:retired:${draft.id}`, JSON.stringify({ id: draft.id, revision: draft.revision, completed: true }));
			} catch {
				if (scope.active && scope.current()) setDeviceError('Posted successfully, but device storage could not record draft cleanup.');
			}
		});
	}, [actor, key, session, scope, request]);
	return {
		retire,
		forget: async (id: string) => {
			if (session.current()?.id === id) {
				await session.clear(async () => {});
				scope.baseline = null;
			}
		},
		status,
		error: recovery.error || deviceError || error,
		recoveryError: recovery.error,
		capture,
		load: accept,
		clear,
		flush: session.flush,
		retry: status === 'conflict' ? session.saveCopy : session.retry,
		current: session.current
	};
}
