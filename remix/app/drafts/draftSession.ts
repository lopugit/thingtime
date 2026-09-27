import { createLatestRevisionAutosave } from '~/Providers/latestRevisionAutosave';
import type { AccountDraft, DraftContent } from './draftCore';
import { remapPostDraftAttachments } from './postDraft';

export type LocalDraft = {
	id: string;
	revision: number;
	dirty?: boolean;
	content: DraftContent;
	pending?: { writeId: string; content: DraftContent; revision: number };
	pendingCopy?: { sourceId: string; content: DraftContent };
	attachmentRemaps?: [string, string][];
};
export type DraftSaveState = 'idle' | 'saving' | 'saved' | 'offline' | 'conflict';
/** Serializes writes, retaining the exact uncertain request across retries. */
export function createDraftSession(options: {
	seed?: LocalDraft | null;
	uuid: () => string;
	save: (input: { id: string; revision: number; writeId: string; content: DraftContent }) => Promise<AccountDraft>;
	copy?: (input: { id: string; sourceId: string; content: DraftContent }) => Promise<AccountDraft>;
	recovered?: (draft: LocalDraft) => void;
	persist: (draft: LocalDraft | null) => void;
	changed: (status: DraftSaveState, error?: string) => void;
}) {
	let current: LocalDraft | null = options.seed || null;
	let counter = 0,
		disabled = false;
	let replacing: 'load' | 'clear' | null = null;
	let nextDraft: DraftContent | null = null;
	let recovering = false;
	let retryTimer: ReturnType<typeof setTimeout> | null = null,
		retryDelay = 2000,
		closing = false;
	const cancelRetry = () => {
		if (retryTimer) clearTimeout(retryTimer);
		retryTimer = null;
	};
	const remap = (content: DraftContent, mapping: Map<string, string>): DraftContent => ({
		...content,
		attachmentIds: content.attachmentIds.map((id) => mapping.get(id) || id),
		snapshot: remapPostDraftAttachments(content.snapshot, mapping)
	});
	const writePending = async () => {
		if (!current?.pending) return;
		const request = { id: current.id, ...current.pending };
		const saved = await options.save(request);
		current.revision = saved.revision;
		delete current.pending;
		current.dirty = current.content.snapshot !== request.content.snapshot;
		options.persist(current);
	};
	const queue = createLatestRevisionAutosave<DraftContent, DraftContent>({
		debounceMs: 250,
		maxWaitMs: 1000,
		serialize: (value) => value,
		write: async (content) => {
			if (!current || disabled) return;
			cancelRetry();
			options.changed('saving');
			if (current.pendingCopy) {
				if (!options.copy) throw new Error('Draft copy is unavailable');
				const copied = await options.copy({ id: current.id, ...current.pendingCopy });
				const mapping = new Map(current.pendingCopy.content.attachmentIds.map((id, index) => [id, copied.attachmentIds[index]]));
				current.revision = copied.revision;
				current.attachmentRemaps = [...mapping];
				current.content = remap(current.content, mapping);
				content = remap(content, mapping);
				delete current.pendingCopy;
				options.persist(current);
				queue.schedule(current.content, ++counter);
				options.recovered?.(current);
			}
			// A response may have been lost. Reconcile the immutable old operation
			// before allocating a later revision; retries can never revert newer text.
			await writePending();
			current.pending = { content, revision: current.revision, writeId: options.uuid() };
			options.persist(current);
			await writePending();
			retryDelay = 2000;
			options.changed('saved');
		},
		onError: (error) => {
			const status = (error as any)?.status;
			options.changed([409, 410].includes(status) ? 'conflict' : 'offline', (error as Error)?.message || 'Waiting to sync');
			if (!closing && !disabled && (!status || status === 408 || status === 429 || status >= 500)) {
				cancelRetry();
				retryTimer = setTimeout(() => {
					retryTimer = null;
					void queue.flush().catch(() => {});
				}, retryDelay);
				(retryTimer as any)?.unref?.();
				retryDelay = Math.min(retryDelay * 2, 60000);
			}
		}
	});
	const capture = (content: DraftContent) => {
		if (disabled || closing) return;
		if (current?.attachmentRemaps) content = remap(content, new Map(current.attachmentRemaps));
		if (replacing === 'clear') {
			nextDraft = content;
			return;
		}
		if (replacing) return;
		current = current ? { ...current, content, dirty: true } : { id: options.uuid(), revision: 0, content, dirty: true };
		options.persist(current); // immediate recovery copy; no debounce window
		options.changed('saving');
		queue.schedule(content, ++counter);
	};
	return {
		capture,
		flush: () => queue.flush(),
		current: () => current,
		async load(draft: AccountDraft) {
			replacing = 'load';
			try {
				await queue.flush();
				if (current?.id === draft.id && current.revision >= draft.revision) return;
				const { id, revision, name, context, surface, snapshot, attachmentIds } = draft;
				current = { id, revision, dirty: false, content: { name, context, surface, snapshot, attachmentIds } };
				options.persist(current);
				options.changed('saved');
			} finally {
				replacing = null;
			}
		},
		async clear(remove: (id: string, revision: number) => Promise<void>) {
			replacing = 'clear';
			try {
				await queue.flush();
				if (current?.revision) await remove(current.id, current.revision);
				current = null;
				options.persist(null);
				options.changed('idle');
			} finally {
				replacing = null;
				const next = nextDraft;
				nextDraft = null;
				if (next) capture(next);
			}
		},
		retry: () => {
			if (current) capture(current.content);
			return queue.flush();
		},
		saveCopy: async () => {
			if (!current) return;
			if (recovering || current.pendingCopy) return queue.flush();
			recovering = true;
			const content = current.content;
			const sourceId = current.id;
			current = options.copy ? { id: options.uuid(), revision: 0, content, pendingCopy: { sourceId, content } } : null;
			capture(content);
			try {
				await queue.flush();
			} finally {
				recovering = false;
			}
		},
		suspend: () => {
			disabled = true;
			cancelRetry();
		},
		dispose: () => {
			closing = true;
			cancelRetry();
			void queue
				.flush()
				.catch(() => {})
				.finally(() => queue.dispose());
		}
	};
}
