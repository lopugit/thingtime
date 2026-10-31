// Cross-tab sync for the persisted thingtime tree (TODO/claude-todo/07).
//
// Every tab holds its own full in-memory thingtime and persists the whole tree,
// so without live propagation a stale tab's next write silently reverts every
// other tab's changes (last-writer-wins). This channel broadcasts each applied
// write so all same-origin tabs converge instead of clobbering each other.
//
// Values travel through the caller-supplied serialize/parse pair — the same
// flatted codec the persist path uses — because thingtime values can contain
// functions and cycles that structured clone would reject, and because a value
// received here must revive exactly like one loaded from storage.

export type ThingtimeSyncPath = string | Array<string | number>;

type ThingtimeSyncMessage = {
	type: 'tt-write';
	path: ThingtimeSyncPath;
	// flatted-serialized `{ v: value }` wrapper so undefined survives the trip
	payload: string;
	sourceTabId: string;
	timestamp: number;
};

export type ThingtimeSyncChannel = {
	publish: (path: ThingtimeSyncPath, value: any) => void;
	close: () => void;
};

export const createThingtimeSyncChannel = (options: {
	tabId: string;
	serialize: (value: any) => string;
	parse: (text: string) => any;
	onRemoteWrite: (path: ThingtimeSyncPath, value: any) => void;
	channelName?: string;
}): ThingtimeSyncChannel | null => {
	const { tabId, serialize, parse, onRemoteWrite, channelName = 'thingtime' } = options;

	// Degrade gracefully to current single-tab behaviour (no second storage
	// mechanism) when BroadcastChannel is unavailable (SSR, very old WebKit).
	if (typeof BroadcastChannel === 'undefined') return null;

	const channel = new BroadcastChannel(channelName);
	let closed = false;

	channel.onmessage = (event: MessageEvent<ThingtimeSyncMessage>) => {
		const message = event?.data;
		if (closed || !message || message.type !== 'tt-write') return;
		if (message.sourceTabId === tabId) return;
		try {
			const wrapper = message.payload ? parse(message.payload) : null;
			if (!wrapper || typeof wrapper !== 'object') return;
			onRemoteWrite(message.path, wrapper.v);
		} catch (err) {
			console.error('[tt] Failed to apply a cross-tab thingtime write', err);
		}
	};

	return {
		publish: (path, value) => {
			if (closed) return;
			try {
				const payload = serialize({ v: value });
				if (!payload) return; // serializer already reported the failure
				const message: ThingtimeSyncMessage = {
					type: 'tt-write',
					path,
					payload,
					sourceTabId: tabId,
					timestamp: Date.now()
				};
				channel.postMessage(message);
			} catch (err) {
				console.error('[tt] Failed to publish a cross-tab thingtime write', err);
			}
		},
		close: () => {
			closed = true;
			channel.close();
		}
	};
};
