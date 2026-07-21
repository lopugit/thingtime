export type ThingtimeCrossTabMessage = {
	sourceTabId: string;
	path: unknown;
	timestamp: number;
	/** Structured-clone-safe payload. Present unless `encoded` is used. */
	value?: unknown;
	/** Flatted-encoded payload for values structured clone rejects (functions, cycles with functions). */
	encoded?: string;
};

export type ThingtimeCrossTabSync = {
	publish: (path: unknown, value: unknown, timestamp: number) => void;
	close: () => void;
};

export type ThingtimeCrossTabChannel = {
	postMessage: (message: ThingtimeCrossTabMessage) => void;
	close: () => void;
	onmessage: ((event: { data: unknown }) => void) | null;
};

export type ThingtimeCrossTabSyncOptions = {
	tabId: string;
	channelName?: string;
	/** Serialize a value structured clone rejects. Wrap so any root (incl. undefined) survives. */
	encode: (value: unknown) => string;
	decode: (encoded: string) => unknown;
	onRemoteWrite: (path: unknown, value: unknown, timestamp: number) => void;
	/** Injectable for tests; the default returns null when BroadcastChannel is unavailable. */
	createChannel?: (name: string) => ThingtimeCrossTabChannel | null;
	onError?: (error: unknown, context: { phase: 'publish' | 'receive' }) => void;
};

const defaultCreateChannel = (name: string): ThingtimeCrossTabChannel | null => {
	if (typeof BroadcastChannel === 'undefined') return null;
	return new BroadcastChannel(name);
};

/**
 * Live cross-tab propagation for thingtime writes. Each tab publishes its local
 * writes on one BroadcastChannel and applies writes from other tabs, so every
 * tab converges on the same tree and a stale tab's full-tree persist no longer
 * reverts newer state. Degrades to current single-tab behaviour when
 * BroadcastChannel is unavailable.
 */
export const createThingtimeCrossTabSync = (options: ThingtimeCrossTabSyncOptions): ThingtimeCrossTabSync => {
	const { tabId, encode, decode, onRemoteWrite, onError } = options;
	const channel = (options.createChannel ?? defaultCreateChannel)(options.channelName ?? 'thingtime');

	if (!channel) {
		return { publish: () => {}, close: () => {} };
	}

	channel.onmessage = (event) => {
		try {
			const message = event?.data as ThingtimeCrossTabMessage | null;
			if (!message || typeof message !== 'object') return;
			if (!message.sourceTabId || message.sourceTabId === tabId) return;

			const value = typeof message.encoded === 'string' ? decode(message.encoded) : message.value;
			onRemoteWrite(message.path, value, message.timestamp);
		} catch (error) {
			onError?.(error, { phase: 'receive' });
		}
	};

	const publish = (path: unknown, value: unknown, timestamp: number) => {
		const base = { sourceTabId: tabId, path, timestamp };
		try {
			channel.postMessage({ ...base, value });
		} catch {
			// Structured clone rejected the value (functions, exotic objects).
			// Fall back to the same flatted encoding the persist path uses.
			try {
				channel.postMessage({ ...base, encoded: encode(value) });
			} catch (error) {
				onError?.(error, { phase: 'publish' });
			}
		}
	};

	return {
		publish,
		close: () => {
			channel.onmessage = null;
			channel.close();
		}
	};
};
