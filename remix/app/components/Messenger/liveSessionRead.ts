import type { LiveAiSource } from './messengerTypes';

export const LIVE_SESSION_READ_PAGE_LIMIT = 100;
export const MAX_LIVE_SESSION_READ_PAGES_PER_OPEN = 20;
export const LIVE_SESSION_READ_POLL_INTERVAL_MS = 2_000;
export const MAX_LIVE_SESSION_READ_POLLS = 150;

export type LiveSessionReadCommandSnapshot = {
	id: string;
	status: 'queued' | 'claimed' | 'running' | 'needs-approval' | 'succeeded' | 'failed' | 'cancelled' | 'needs-review';
};

export type LiveSessionReadWaitResult = 'succeeded' | 'failed' | 'cancelled' | 'needs-review' | 'timed-out' | 'aborted';

export type LiveSessionReadPlan = {
	pageKey: string;
	requestId: string;
	command: {
		deviceId: string;
		kind: 'session.read';
		input: {
			connectorId: string;
			sessionId: string;
			cursor?: string;
			limit: number;
		};
		requiresApproval: boolean;
	};
};

const stableHex = (value: string): string => {
	let left = 0x811c9dc5;
	let right = 0x9e3779b9;
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		left = Math.imul(left ^ code, 0x01000193);
		right = Math.imul(right ^ (code + index), 0x85ebca6b);
	}
	return `${(left >>> 0).toString(16).padStart(8, '0')}${(right >>> 0).toString(16).padStart(8, '0')}`;
};

const canReadHistory = (capabilities: readonly string[]): boolean =>
	['read-history', 'session.read', 'session.list', 'ai.session.read'].some((capability) => capabilities.includes(capability));

/**
 * Plans exactly one materialization page from the durable mirrored cursor.
 * The request id is deterministic per source/cursor, so remounts and unknown
 * network outcomes reconcile through the server's command idempotency key.
 */
export const planLiveSessionRead = (source: LiveAiSource | null): LiveSessionReadPlan | null => {
	if (!source || !canReadHistory(source.capabilities)) return null;
	if (source.historySyncedAt && source.historyHasMore === false) return null;
	const cursor = source.historySyncedAt ? source.historyCursor : null;
	if (source.historySyncedAt && (source.historyHasMore !== true || typeof cursor !== 'string' || !cursor)) return null;
	const pageKey = cursor ? `cursor:${cursor}` : 'initial';
	const identity = `${source.deviceId}\u0000${source.connectorId}\u0000${source.sessionId}\u0000${pageKey}`;
	return {
		pageKey,
		requestId: `live-read-${stableHex(identity)}`,
		command: {
			deviceId: source.deviceId,
			kind: 'session.read',
			input: {
				connectorId: source.connectorId,
				sessionId: source.sessionId,
				...(cursor ? { cursor } : {}),
				limit: LIVE_SESSION_READ_PAGE_LIMIT
			},
			requiresApproval: source.capabilities.includes('explicit-approval')
		}
	};
};

const terminalReadStatus = (
	status: LiveSessionReadCommandSnapshot['status']
): Exclude<LiveSessionReadWaitResult, 'timed-out' | 'aborted'> | null =>
	status === 'succeeded' || status === 'failed' || status === 'cancelled' || status === 'needs-review' ? status : null;

const defaultSleep = (milliseconds: number, signal: AbortSignal): Promise<void> =>
	new Promise((resolve) => {
		if (signal.aborted) {
			resolve();
			return;
		}
		let timer: ReturnType<typeof setTimeout>;
		const finish = () => {
			clearTimeout(timer);
			signal.removeEventListener('abort', finish);
			resolve();
		};
		timer = setTimeout(finish, milliseconds);
		signal.addEventListener('abort', finish, { once: true });
	});

/**
 * Reconciles a queued read with its authoritative server command. This avoids
 * guessing when transcript materialization has completed and keeps approvals
 * usable for several minutes without an unbounded browser polling loop.
 */
export const waitForLiveSessionReadCommand = async ({
	command,
	loadCommands,
	signal,
	intervalMs = LIVE_SESSION_READ_POLL_INTERVAL_MS,
	maximumPolls = MAX_LIVE_SESSION_READ_POLLS,
	sleep = defaultSleep
}: {
	command: LiveSessionReadCommandSnapshot;
	loadCommands: (signal: AbortSignal) => Promise<LiveSessionReadCommandSnapshot[]>;
	signal: AbortSignal;
	intervalMs?: number;
	maximumPolls?: number;
	sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}): Promise<LiveSessionReadWaitResult> => {
	const initial = terminalReadStatus(command.status);
	if (initial) return initial;
	for (let attempt = 0; attempt < maximumPolls; attempt += 1) {
		await sleep(intervalMs, signal);
		if (signal.aborted) return 'aborted';
		try {
			const current = (await loadCommands(signal)).find((candidate) => candidate.id === command.id);
			const terminal = current ? terminalReadStatus(current.status) : null;
			if (terminal) return terminal;
		} catch (error) {
			if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) return 'aborted';
			// A transient list failure is safe to retry because this is read-only.
		}
	}
	return signal.aborted ? 'aborted' : 'timed-out';
};
