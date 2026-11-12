import type { PagedConflictReviewResult, PagedConflictReviewSession } from './pagedForegroundReview';
import type { ReviewDraftCursor } from './pagedReviewDraft';

type ReviewPage = Awaited<ReturnType<PagedConflictReviewSession['read']>>;
export type ConflictReviewView = {
	page: ReviewPage | null;
	busy: boolean;
	error: string | null;
	closed: boolean;
};

function freeze<T>(value: T): T {
	if (value && typeof value === 'object') {
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	return value;
}

/** Data/action adapter for editable review blocks. Owns at most one page and
 * a fixed number of keyset cursors; saved choices and counts remain in the journal. Hosts
 * dispose on identity changes/unmount and resolve the foreground callback only
 * from finish/cancel, never from a rendered saved template or cached snapshot. */
export function createConflictReviewController(
	session: PagedConflictReviewSession,
	complete: (result: PagedConflictReviewResult) => void
) {
	let view: ConflictReviewView = freeze({ page: null, busy: false, error: null, closed: false });
	let cursor: ReviewDraftCursor | undefined;
	const listeners = new Set<() => void>();
	const publish = (next: ConflictReviewView) => {
		view = freeze(next);
		for (const listener of listeners) listener();
	};
	const current = () => { if (view.closed) throw Error('This conflict review is no longer open.'); };
	const work = async <T>(run: () => Promise<T>, completing = false): Promise<T> => {
		current();
		if (view.busy) throw Error('Wait for the current review change to finish.');
		publish({ ...view, busy: true, error: null });
		try { const result = await run(); if (!completing) current(); return result; }
		catch (error) {
			if (!view.closed) publish({ ...view, error: error instanceof Error ? error.message : 'Review unavailable. Reload this page to try again.' });
			throw error;
		} finally { if (!view.closed) publish({ ...view, busy: false }); }
	};
	const load = (target?: ReviewDraftCursor) => {
		const next = target === undefined ? undefined : structuredClone(target);
		return work(async () => {
			const page = await session.read(next); current();
			cursor = next;
			publish({ ...view, page: structuredClone(page) });
		});
	};
	const close = () => {
		if (!view.closed) publish({ page: null, error: null, busy: false, closed: true });
		cursor = undefined;
		listeners.clear();
	};
	return {
		getSnapshot: () => view,
		subscribe(listener: () => void) { current(); listeners.add(listener); return () => { listeners.delete(listener); }; },
		reload: () => load(cursor),
		next: () => {
			current(); if (!view.page?.next) return Promise.reject(Error('There are no more conflicts.'));
			return load(view.page.next);
		},
		previous: () => {
			current(); if (!view.page?.previous) return Promise.reject(Error('This is the first conflict page.'));
			return load(view.page.previous);
		},
		choose: (path: string, from: 'local' | 'remote' | null, revision: number) => work(async () => {
			const row = view.page?.rows.find(row => row.conflict.path === path);
			if (!row || row.revision !== revision) throw Error('Conflict choice changed. Reload this page before choosing again.');
			const saved = await session.choose(path, from, revision); current();
			publish({ ...view, page: { ...view.page!, progress: structuredClone(saved.progress),
				rows: view.page!.rows.map(item => item === row ? structuredClone(saved.row) : item) } });
		}),
		finish: (action: 'resolve' | 'retain') => {
			const approved = view.page?.progress;
			if (view.error) return Promise.reject(Error('Reload this review before applying it.'));
			return work(async () => {
				if (!['resolve', 'retain'].includes(action) || !approved || approved.phase !== 'reviewing' || !approved.count ||
					(action === 'resolve' ? approved.blocked > 0 || approved.selected !== approved.count : approved.retentionBlocked > 0))
					throw Error('This review is incomplete or needs changes in the source folders.');
				const fresh = await session.read(cursor); current();
				publish({ ...view, page: structuredClone(fresh) });
				if (fresh.progress.revision !== approved.revision) throw Error('Saved choices changed. Review the current choices before applying.');
				complete({ action, revision: approved.revision });
				close();
			}, true);
		},
		cancel: () => {
			current(); if (view.busy) throw Error('Wait for the current review change to finish.');
			complete({ action: 'cancel' }); close();
		},
		// Interruption retains choices. Only explicit cancel releases the draft.
		dispose: close
	};
}
