import React from 'react';
import { clearLocalCache, readLocalCache } from '~/hooks/localCache';
import { draftRequest, listAccountDrafts } from './draftClient';
import { createDraftSession, type LocalDraft, type DraftSaveState } from './draftSession';
import type { AccountDraft, DraftContent, DraftSurface } from './draftCore';

export function useAccountDraft({
	actor,
	context,
	surface,
	onRestore,
	resumeRemote = true
}: {
	actor?: string | null;
	context: string;
	surface: DraftSurface;
	onRestore: (draft: AccountDraft) => void;
	resumeRemote?: boolean;
}) {
	const key = `tt-account-draft:${typeof location === 'undefined' ? '' : location.origin}:${actor || 'guest'}:${context}`;
	const [status, setStatus] = React.useState<DraftSaveState>('idle');
	const [error, setError] = React.useState('');
	const scope = React.useMemo(() => ({ active: true, touched: false, restoring: false, baseline: null as string | null }), [key]);
	const restore = React.useRef(onRestore);
	restore.current = onRestore;
	const session = React.useMemo(
		() =>
			createDraftSession({
				seed: actor ? readLocalCache<LocalDraft>(key) : null,
				uuid: () => crypto.randomUUID(),
				save: async (input) => (await draftRequest(actor!, { operation: 'save', ...input })).draft,
				copy: async (input) => (await draftRequest(actor!, { operation: 'recover', ...input })).draft,
				recovered: (value) => {
					if (scope.active) {
						scope.baseline = value.content.snapshot;
						restore.current({ ...value.content, id: value.id, revision: value.revision, mode: 'draft', createdAt: '', updatedAt: '' });
					}
				},
				persist: (value) => {
					if (!actor) return;
					if (!value) {
						clearLocalCache(key);
						return;
					}
					try {
						window.localStorage.setItem(key, JSON.stringify(value));
					} catch {
						if (scope.active) setError('Device recovery storage is full; keep this page open until the account save finishes.');
					}
				},
				changed: (next, message) => {
					if (scope.active) {
						setStatus(next);
						setError(message || '');
					}
				}
			}),
		[actor, key, scope]
	);
	const accept = React.useCallback(
		async (draft: AccountDraft) => {
			await session.load(draft);
			if (!scope.active) return;
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
				const retired = readLocalCache<{ id: string; revision: number }>(savedKey);
				if (!retired || !actor) continue;
				try {
					await draftRequest(actor, { operation: 'delete', ...retired });
					localStorage.removeItem(savedKey);
				} catch (failure) {
					if ([404, 409, 410].includes((failure as any)?.status)) localStorage.removeItem(savedKey);
				}
			}
		};
		void retryRetired();
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
		} else if (actor && resumeRemote && localStorage.getItem(`tt-draft-resume:${location.origin}:${actor}`) !== 'false') {
			void listAccountDrafts(actor, { context, surface })
				.then(async (result) => {
					const found = result.drafts.find((entry) => entry.mode === 'draft' && !localStorage.getItem(`${key}:retired:${entry.id}`));
					if (!found || cancelled || scope.touched) return;
					const response = await draftRequest(actor, undefined, { id: found.id });
					if (!cancelled && !scope.touched) await accept(response.draft);
				})
				.catch((failure) => {
					if (!cancelled) setError(failure.message || 'Could not check account drafts');
				});
		}
		const flush = () => {
			void session.flush().catch(() => {});
		};
		const retry = () => {
			void retryRetired();
			void session.retry().catch(() => {});
		};
		window.addEventListener('pagehide', flush);
		window.addEventListener('online', retry);
		document.addEventListener('visibilitychange', flush);
		return () => {
			cancelled = true;
			scope.active = false;
			window.removeEventListener('pagehide', flush);
			window.removeEventListener('online', retry);
			document.removeEventListener('visibilitychange', flush);
			// Do not cancel the last keystroke's network save on navigation.
			queueMicrotask(() => {
				if (!scope.active) session.dispose();
			});
		};
	}, [actor, context, key, surface, session, accept, scope, resumeRemote]);
	const capture = React.useCallback(
		(content: DraftContent, hasContent = true, force = false) => {
			if (!actor || scope.restoring) return;
			if (scope.baseline === null && !force) {
				scope.baseline = content.snapshot;
				return;
			}
			if (scope.baseline === content.snapshot) return;
			scope.baseline = content.snapshot;
			scope.touched = true;
			if (hasContent || session.current()) session.capture(content);
		},
		[actor, session, scope]
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
				await draftRequest(actor!, { operation: 'delete', id, revision });
				localStorage.removeItem(retiredKey);
			} catch (failure) {
				if ([404, 409, 410].includes((failure as any)?.status)) localStorage.removeItem(retiredKey);
			}
		});
		scope.baseline = null;
	}, [actor, key, session, scope]);
	return {
		forget: async (id: string) => {
			if (session.current()?.id === id) {
				await session.clear(async () => {});
				scope.baseline = null;
			}
		},
		status,
		error,
		capture,
		load: accept,
		clear,
		flush: session.flush,
		retry: status === 'conflict' ? session.saveCopy : session.retry,
		current: session.current
	};
}
