import { parseThingtime, stringifyThingtime } from './thingtimeSerialization';

// Cross-tab sync for the persisted thingtime tree (TODO/claude-todo/07).
//
// Every tab holds its own full in-memory thingtime and persists the whole tree,
// so a stale tab can otherwise overwrite changes made elsewhere. Broadcast only
// successfully applied path-level writes and feed received writes back through
// ThingtimeProvider's existing mutation queue so every tab converges before its
// next full-tree autosave.
//
// What crosses is the WRITE, never the local side effects that accompanied it.
// ThingtimeProvider's `events` Subject is per-provider, so it is per-tab, and
// nothing here forwards it. The case that bites is a key rename
// (Thingtime.tsx's updatePath): it writes the rewritten parent — which must and
// does cross — and then emits `path-renamed` so that everything bound to the old
// path by STRING follows it (EditorSplit's window leaves, PostComposer's
// draftPath). A peer applies the data and never sees the event, so its bound
// windows go blank against a key that no longer exists — the exact failure the
// local listener exists to prevent. No data is lost; the value is intact under
// the new key, and re-pointing or a reload clears it.
//
// The fix is NOT to mark the rename tabLocal — a rename is user data, and
// withholding it restores the whole-tree clobber this channel exists to fix. It
// is to carry a second message type and re-emit it on the receiver's Subject,
// which is an architecture decision (does this transport carry events, or only
// writes?) rather than something to settle inside a review pass. Recorded here
// with a guard test below that fails if anyone reaches for the wrong fix.

export type ThingtimeSyncPath = string | string[];

type ThingtimeSyncMessage = {
	type: 'tt-write';
	path: ThingtimeSyncPath;
	payload: string;
	sourceTabId: string;
	// Diagnostic only — NOT a conflict-resolution field, despite reading like
	// one. Nothing compares it, so the channel is arrival-order last-writer-wins
	// per path, and two tabs that write the SAME path inside one message
	// round-trip do not converge: each applies its own value, then receives and
	// applies the other's, so the two tabs end up holding each other's value
	// permanently (reproduced in the test below). Whichever tab autosaves last
	// then persists its swapped copy.
	//
	// This is narrow in practice — it needs sub-round-trip concurrency on one
	// key, which one pair of hands at one keyboard does not produce, and the
	// clobber this channel exists to fix is the WHOLE-TREE one — so it is
	// recorded rather than fixed here. Resolving it is not a change to this
	// module: the receiver would have to reject a remote write older than the
	// last write applied locally at that path, which means per-path applied
	// timestamps living in ThingtimeProvider next to the mutation queue, plus
	// eviction so that map does not grow with the tree. Same-machine tabs share
	// one clock, so the comparison would at least be sound. If that lands, this
	// field stops being diagnostic and the pinning test below is what says so.
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

export type ThingtimeSyncPublishOptions = {
	fromRemote?: boolean;
	tabLocal?: boolean;
};

// Which successfully applied writes belong on the wire, excluded for two
// different reasons:
//
//   fromRemote — the write IS another tab's broadcast, already applied here
//     through the normal queue. Republishing it would echo it back around the
//     channel.
//   tabLocal   — the call site declared the write ephemeral view chrome for
//     THIS viewport (what is currently open and focused) rather than user data
//     or a saved preference. Such a key is still persisted, so a reload
//     restores it exactly as before — it just stops one tab actuating another
//     tab's UI mid-session.
//
// Chrome is declared at the write site rather than pattern-matched here so the
// transport stays generic: this module knows nothing about drawers, the
// Commander, or the composer, and no central list has to be kept in sync with
// call sites in unrelated files.
//
// Be clear-eyed about what that does NOT buy, because it is easy to read the
// paragraph above as a safety property. Declaring at the write site distributes
// the denylist; it does not remove it. Broadcast is still the DEFAULT, so a new
// write site that nobody annotates does start crossing tabs by accident — which
// is not hypothetical: review of this change found seven separate keys that
// should never have been on the wire (root `timemachine` under doubled aliases,
// `commanderActive`, `settings.drawer.open`/`selectedItem`,
// `settings.editor.openConfig`/`live`, the composer's `tmp` seed, and the DevKit
// prefills), each after the previous one was called the last.
//
// The fail-safe alternative is to invert the default: publish nothing unless a
// write opts in (`shared: true`), or allowlist the syncable subtrees outright.
// Every miss above would then have been a key that quietly did not sync, rather
// than one that quietly destroyed a peer's typed input. That is a deliberate
// design change with a real cost — it re-annotates every genuine data write —
// so it is recorded here as the known trade-off, not made unilaterally. The
// call-site guard tests below are the compensating control in the meantime; add
// to them whenever a new viewport-scoped key appears.
export const shouldPublishAppliedWrite = (options?: ThingtimeSyncPublishOptions): boolean => {
	return !options?.fromRemote && !options?.tabLocal;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const UNSAFE_PATH_PARTS = new Set(['__proto__', 'prototype', 'constructor']);
const ROOT_ALIASES = new Set(['thingtime', 'tt']);

const pathParts = (value: ThingtimeSyncPath): string[] => {
	return typeof value === 'string' ? value.split(/[.[\]"']+/).filter(Boolean) : value;
};

// The root is self-referential: applyThingtimeUpdate re-establishes
// `thingtime.tt === thingtime` and `thingtime.thingtime === thingtime` before
// every write, so a whole LEADING RUN of root aliases resolves back to the root
// — `tt.tt.settings` and `settings` address the same node. Classifying a path
// therefore has to collapse the entire run, not just one alias. Only the
// leading run: a nested user key named `tt` (`Content.tt.…`) is ordinary data.
const withoutRootAliases = (parts: string[]): string[] => {
	let index = 0;
	while (index < parts.length && ROOT_ALIASES.has(parts[index])) index += 1;
	return parts.slice(index);
};

const isTabLocalPath = (parts: string[]): boolean => withoutRootAliases(parts)[0] === 'timemachine';

// A path that is nothing but root aliases is not a path-level write:
// ThingtimeProvider's applyThingtimeUpdate treats a bare 'tt'/'thingtime' as a
// whole-tree REPLACEMENT, and a doubled `tt.tt` resolves to the root's own
// alias property. Broadcasting either would hand every other tab the sender's
// entire root — including the `timemachine` timeline that isTabLocalPath keeps
// tab-local on every other path — or replace the receiving tab's self-alias
// with an arbitrary payload, and ship a full tree snapshot per keystroke.
// Whole-tree convergence is the persistence layer's job; this channel only
// carries path-level writes.
const isWholeTreeReplacement = (parts: string[]): boolean => withoutRootAliases(parts).length === 0;

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
