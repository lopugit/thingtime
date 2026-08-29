import { parseThingtime, stringifyThingtime } from './thingtimeSerialization';

// Cross-tab sync for the persisted thingtime tree (TODO/claude-todo/07).
//
// Every tab holds its own full in-memory thingtime and persists the whole tree,
// so a stale tab can otherwise overwrite changes made elsewhere. Broadcast only
// successfully applied path-level writes and feed received writes back through
// ThingtimeProvider's existing mutation queue so every tab converges before its
// next full-tree autosave.

export type ThingtimeSyncPath = string | string[];

type ThingtimeSyncMessage = {
	type: 'tt-write';
	path: ThingtimeSyncPath;
	payload: string;
	sourceTabId: string;
	timestamp: number;
};

type ThingtimeSyncEnvelope = {
	codec: 'thingtime-safe-v1';
	isUndefined?: true;
	value?: any;
};

export type ThingtimeSyncChannel = {
	publish: (path: ThingtimeSyncPath, value: any) => void;
	close: () => void;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const UNSAFE_PATH_PARTS = new Set(['__proto__', 'prototype', 'constructor']);
const ROOT_ALIASES = new Set(['thingtime', 'tt']);

const pathParts = (value: ThingtimeSyncPath): string[] => {
	return typeof value === 'string' ? value.split(/[.[\]"']+/).filter(Boolean) : value;
};

const isTabLocalPath = (parts: string[]): boolean => {
	const rootPart = ROOT_ALIASES.has(parts[0]) ? parts[1] : parts[0];
	return rootPart === 'timemachine';
};

// A bare 'tt' / 'thingtime' path is not a path-level write: ThingtimeProvider's
// applyThingtimeUpdate treats it as a whole-tree REPLACEMENT. Broadcasting one
// would hand every other tab the sender's entire root — including the
// `timemachine` timeline that isTabLocalPath keeps tab-local on every other
// path — and ship a full tree snapshot per keystroke. Whole-tree convergence is
// the persistence layer's job; this channel only carries path-level writes.
const isWholeTreeReplacement = (parts: string[]): boolean => parts.length === 1 && ROOT_ALIASES.has(parts[0]);

const isThingtimeSyncPath = (value: unknown): value is ThingtimeSyncPath => {
	if (typeof value === 'string') {
		const parts = pathParts(value);
		return (
			value.length > 0 &&
			parts.length > 0 &&
			!isTabLocalPath(parts) &&
			!isWholeTreeReplacement(parts) &&
			parts.every((part) => !UNSAFE_PATH_PARTS.has(part))
		);
	}

	return (
		Array.isArray(value) &&
		value.length > 0 &&
		value.every((part) => typeof part === 'string' && part.length > 0 && !UNSAFE_PATH_PARTS.has(part)) &&
		!isTabLocalPath(value) &&
		!isWholeTreeReplacement(value)
	);
};

const isThingtimeSyncMessage = (value: unknown): value is ThingtimeSyncMessage => {
	if (!isRecord(value)) return false;
	return (
		value.type === 'tt-write' &&
		isThingtimeSyncPath(value.path) &&
		typeof value.payload === 'string' &&
		value.payload.length > 0 &&
		typeof value.sourceTabId === 'string' &&
		value.sourceTabId.length > 0 &&
		typeof value.timestamp === 'number' &&
		Number.isFinite(value.timestamp) &&
		value.timestamp >= 0
	);
};

const serializeSyncValue = (value: any): string => {
	const envelope: ThingtimeSyncEnvelope =
		value === undefined ? { codec: 'thingtime-safe-v1', isUndefined: true } : { codec: 'thingtime-safe-v1', value };
	return stringifyThingtime(envelope);
};

const parseSyncValue = (payload: string): { valid: true; value: any } | { valid: false } => {
	const envelope = parseThingtime(payload);
	if (!isRecord(envelope) || envelope.codec !== 'thingtime-safe-v1') return { valid: false };

	if (envelope.isUndefined === true) {
		return Object.prototype.hasOwnProperty.call(envelope, 'value') ? { valid: false } : { valid: true, value: undefined };
	}

	if (envelope.isUndefined !== undefined || !Object.prototype.hasOwnProperty.call(envelope, 'value')) {
		return { valid: false };
	}

	return { valid: true, value: envelope.value };
};

export const createThingtimeSyncChannel = (options: {
	tabId: string;
	onRemoteWrite: (path: ThingtimeSyncPath, value: any) => void;
	channelName?: string;
}): ThingtimeSyncChannel | null => {
	const { tabId, onRemoteWrite, channelName = 'thingtime' } = options;
	const BroadcastChannelConstructor = globalThis.BroadcastChannel;

	// Degrade gracefully to the prior single-tab behaviour (no second storage
	// mechanism) when BroadcastChannel is unavailable.
	if (typeof BroadcastChannelConstructor !== 'function') return null;

	const channel = new BroadcastChannelConstructor(channelName);
	let closed = false;

	channel.onmessage = (event: MessageEvent<unknown>) => {
		const message = event?.data;
		if (closed || !isThingtimeSyncMessage(message) || message.sourceTabId === tabId) return;

		try {
			const parsed = parseSyncValue(message.payload);
			if (!parsed.valid) return;
			onRemoteWrite(message.path, parsed.value);
		} catch (error) {
			console.error('[tt] Failed to apply a cross-tab Thingtime write', error);
		}
	};

	return {
		publish: (path, value) => {
			if (closed || !isThingtimeSyncPath(path)) return;

			try {
				const payload = serializeSyncValue(value);
				if (!payload) return;
				channel.postMessage({
					type: 'tt-write',
					path,
					payload,
					sourceTabId: tabId,
					timestamp: Date.now()
				} satisfies ThingtimeSyncMessage);
			} catch (error) {
				console.error('[tt] Failed to publish a cross-tab Thingtime write', error);
			}
		},
		close: () => {
			if (closed) return;
			closed = true;
			channel.onmessage = null;
			channel.close();
		}
	};
};
