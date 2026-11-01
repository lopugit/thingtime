import type { SendLopuOptions } from './lopuChatStore';

export type QueuedLopuMessage = {
	id: string;
	chatId: string;
	text: string;
	together: boolean;
	options: Omit<SendLopuOptions, 'onAccepted'>;
};
export type LopuQueueBatch = { ids: string[]; requestId: string; text: string; options: SendLopuOptions };
type QueueState = {
	owner: string | null;
	items: QueuedLopuMessage[];
	paused: boolean;
	error: string | null;
	batch: LopuQueueBatch | null;
	busy: boolean;
};
let state: QueueState = { owner: null, items: [], paused: false, error: null, batch: null, busy: false };
let generation = 0;
const listeners = new Set<() => void>();
export const subscribeLopuQueue = (fn: () => void) => {
	listeners.add(fn);
	return () => {
		listeners.delete(fn);
	};
};
export const getLopuQueue = () => state;
const key = (owner: string) => `tt-lopu-message-queue-v1-${encodeURIComponent(owner)}`;
const update = (patch: Partial<QueueState>) => {
	state = { ...state, ...patch };
	try {
		if (state.owner) sessionStorage.setItem(key(state.owner), JSON.stringify({ items: state.items, paused: state.paused, batch: state.batch }));
	} catch {
		/* Keep the in-memory draft if storage is full. */
	}
	listeners.forEach((fn) => fn());
};
export const bindLopuQueue = (owner: string | null) => {
	if (owner === state.owner) return;
	generation++;
	state = { owner, items: [], paused: false, error: null, batch: null, busy: false };
	try {
		const saved = owner ? JSON.parse(sessionStorage.getItem(key(owner)) || 'null') : null;
		if (saved && Array.isArray(saved.items))
			state = {
				...state,
				items: saved.items
					.filter(
						(item: any) =>
							typeof item?.id === 'string' && typeof item.chatId === 'string' && typeof item.text === 'string' && item.text.length <= 16000
					)
					.slice(0, 50),
				batch: saved.batch ?? null,
				paused: true
			};
	} catch {
		/* A damaged local draft must not prevent chat. */
	}
	queueMicrotask(() => listeners.forEach((fn) => fn()));
};
export const addLopuQueueMessage = (chatId: string, text: string, options: SendLopuOptions) => {
	if (!state.owner || !text.trim() || Array.from(text.trim()).length > 8000 || state.items.length >= 50)
		throw new Error('Queue up to 50 messages, with up to 8000 characters each.');
	const { onAccepted: _accepted, ...snapshot } = options;
	update({
		items: [...state.items, { id: crypto.randomUUID(), chatId, text: text.trim(), together: true, options: structuredClone(snapshot) }],
		error: null
	});
};
export const editLopuQueue = (id: string, patch: { together?: boolean; remove?: boolean; before?: string; direction?: -1 | 1 }) => {
	if (state.batch?.ids.includes(id)) return;
	let items = [...state.items];
	const index = items.findIndex((item) => item.id === id);
	if (index < 0) return;
	if (patch.remove) items.splice(index, 1);
	else if (typeof patch.together === 'boolean') items[index] = { ...items[index], together: patch.together };
	else {
		const siblings = items.filter((item) => item.chatId === items[index].chatId);
		const target = patch.before
			? items.findIndex((item) => item.id === patch.before && item.chatId === items[index].chatId)
			: items.indexOf(siblings[siblings.indexOf(items[index]) + (patch.direction || 0)]);
		if (target < 0 || state.batch?.ids.includes(items[target].id)) return;
		const [item] = items.splice(index, 1);
		items.splice(target, 0, item);
	}
	update({ items });
};
export const pauseLopuQueue = (paused: boolean) => update({ paused, error: paused ? state.error : null });

/** Consecutive checked messages share one reply; unchecked messages are barriers. */
export const planLopuQueueBatch = (items: QueuedLopuMessage[], chatId: string): LopuQueueBatch | null => {
	const pending = items.filter((item) => item.chatId === chatId);
	if (!pending.length) return null;
	const selected = [pending[0]];
	for (const item of pending.slice(1)) {
		if (!selected[0].together || !item.together) break;
		// Preserve each message's model, page snapshot and media context exactly.
		if (JSON.stringify(item.options) !== JSON.stringify(selected[0].options)) break;
		if (Array.from([...selected, item].map((entry) => entry.text).join('\n\n')).length > 8000) break;
		selected.push(item);
	}
	return {
		ids: selected.map((item) => item.id),
		requestId: selected[0].id,
		text: selected.map((item) => item.text).join('\n\n'),
		options: { ...selected[0].options, chatId }
	};
};
export const drainLopuQueue = async (chatId: string, send: (text: string, options: SendLopuOptions) => Promise<any>) => {
	if (state.busy || state.paused || !state.owner) return;
	const batch = state.batch ?? planLopuQueueBatch(state.items, chatId);
	if (!batch || batch.options.chatId !== chatId) return;
	const owner = state.owner,
		epoch = generation;
	update({ batch, busy: true });
	const onAccepted = () => {
		if (state.owner !== owner || generation !== epoch) return;
		// Once persisted, this is a sent message. A later interrupted reply must
		// not leave it locked in the queue or resend it on Resume.
		update({ items: state.items.filter((item) => !batch.ids.includes(item.id)), batch: null });
	};
	try {
		const result = await send(batch.text, { ...batch.options, requestId: batch.requestId, onAccepted });
		if (state.owner !== owner || generation !== epoch) return;
		if (!result.ok) throw new Error(result.error || 'Queue paused. Retry when ready.');
		update({ items: state.items.filter((item) => !batch.ids.includes(item.id)), batch: null, busy: false });
	} catch (error) {
		if (state.owner === owner && generation === epoch)
			update({ busy: false, paused: true, error: error instanceof Error ? error.message : 'Queue paused. Retry when ready.' });
	}
};

export const reorderLopuQueue = (chatId: string, ids: string[]) => {
	const items = state.items.filter((item) => item.chatId === chatId);
	if (state.batch || ids.length !== items.length || new Set(ids).size !== ids.length || ids.some((id) => !items.some((item) => item.id === id)))
		return;
	const ordered = ids.map((id) => items.find((item) => item.id === id)!);
	let index = 0;
	update({ items: state.items.map((item) => (item.chatId === chatId ? ordered[index++] : item)) });
};
