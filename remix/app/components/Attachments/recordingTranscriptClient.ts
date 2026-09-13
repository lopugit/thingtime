export type TranscriptRequest = (ownerId: string, ids: string[], signal: AbortSignal) => Promise<Record<string, string>>;

// Mounted players share bounded requests, not a permanent private-text cache.
// Each account has an independent generation; old responses cannot reach a
// new subscriber after unmount or an identity change.
export const createRecordingTranscriptClient = (request: TranscriptRequest) => {
	const groups = new Map<string, {
		listeners: Map<string, Set<(text: string | null) => void>>;
		generation: number;
		controller?: AbortController;
		timer?: ReturnType<typeof setTimeout>;
	}>();
	const refresh = (ownerId: string) => {
		const group = groups.get(ownerId);
		if (!group) return;
		clearTimeout(group.timer);
		group.controller?.abort();
		const generation = ++group.generation;
		group.timer = setTimeout(async () => {
			const controller = group.controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 20_000);
			const ids = [...group.listeners.keys()];
			try {
				for (let index = 0; index < ids.length; index += 20) {
					const batch = ids.slice(index, index + 20);
					const texts = await request(ownerId, batch, controller.signal);
					if (controller.signal.aborted || group.generation !== generation || groups.get(ownerId) !== group) return;
					for (const id of batch) for (const listener of group.listeners.get(id) || []) listener(texts[id] || null);
				}
			} catch {
				// A transient failure is not an empty successful read. Retain the
				// current quote, without a spinner or error toast on every file.
			} finally { clearTimeout(timeout); }
		}, 25);
	};
	return {
		refreshAll: () => { for (const ownerId of groups.keys()) refresh(ownerId); },
		subscribe: (ownerId: string, id: string, listener: (text: string | null) => void) => {
			let group = groups.get(ownerId);
			if (!group) { group = { listeners: new Map(), generation: 0 }; groups.set(ownerId, group); }
			const listeners = group.listeners.get(id) || new Set();
			listeners.add(listener);
			group.listeners.set(id, listeners);
			refresh(ownerId);
			return () => {
				listeners.delete(listener);
				if (!listeners.size) group.listeners.delete(id);
				if (!group.listeners.size) {
					clearTimeout(group.timer);
					group.controller?.abort();
					groups.delete(ownerId);
				}
			};
		}
	};
};
