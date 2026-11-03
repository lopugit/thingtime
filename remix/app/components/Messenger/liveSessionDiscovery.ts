import type { PublicDeviceCommand } from '~/components/Devices/useDeviceApi';

export const LIVE_SESSION_LIST_PAGE_LIMIT = 100;
export const MAX_LIVE_SESSION_LIST_PAGES = 20;
export const LIVE_DEVICE_COMMAND_POLL_INTERVAL_MS = 2_000;
export const MAX_LIVE_DEVICE_COMMAND_POLLS = 150;

export type LiveDeviceCommandSnapshot = Pick<PublicDeviceCommand, 'id' | 'status' | 'outputRef' | 'error'>;
type LiveDeviceTerminalStatus = 'succeeded' | 'failed' | 'cancelled' | 'needs-review';
export type LiveDeviceCommandOutcome =
	| { status: LiveDeviceTerminalStatus; command: LiveDeviceCommandSnapshot }
	| { status: 'timed-out' | 'aborted'; command: null };

export type LiveSessionListResult = {
	status: LiveDeviceCommandOutcome['status'] | 'page-limit' | 'cursor-cycle' | 'invalid-cursor';
	pages: number;
	command: LiveDeviceCommandSnapshot | null;
};

const terminalStatus = (
	command: LiveDeviceCommandSnapshot
): LiveDeviceTerminalStatus | null =>
	command.status === 'succeeded' ||
	command.status === 'failed' ||
	command.status === 'cancelled' ||
	command.status === 'needs-review'
		? command.status
		: null;

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

export const waitForLiveDeviceCommand = async ({
	command,
	loadCommands,
	signal,
	intervalMs = LIVE_DEVICE_COMMAND_POLL_INTERVAL_MS,
	maximumPolls = MAX_LIVE_DEVICE_COMMAND_POLLS,
	sleep = defaultSleep
}: {
	command: LiveDeviceCommandSnapshot;
	loadCommands: (signal: AbortSignal) => Promise<LiveDeviceCommandSnapshot[]>;
	signal: AbortSignal;
	intervalMs?: number;
	maximumPolls?: number;
	sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}): Promise<LiveDeviceCommandOutcome> => {
	const initial = terminalStatus(command);
	if (initial) return { status: initial, command };
	for (let attempt = 0; attempt < maximumPolls; attempt += 1) {
		await sleep(intervalMs, signal);
		if (signal.aborted) return { status: 'aborted', command: null };
		try {
			const current = (await loadCommands(signal)).find((candidate) => candidate.id === command.id);
			if (!current) continue;
			const terminal = terminalStatus(current);
			if (terminal) return { status: terminal, command: current };
		} catch (error) {
			if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
				return { status: 'aborted', command: null };
			}
			// A transient command-list failure is safe to retry; the mutation is
			// identified by the original idempotent request id.
		}
	}
	return signal.aborted ? { status: 'aborted', command: null } : { status: 'timed-out', command: null };
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

const pageRequestId = (rootRequestId: string, cursor: string | null): string =>
	cursor ? `live-list-${stableHex(`${rootRequestId}\u0000${cursor}`)}` : rootRequestId;

const validCursor = (value: string): boolean =>
	value.length > 0 &&
	value === value.trim() &&
	Array.from(value).length <= 2_048 &&
	!/[\p{Cc}\p{Cf}]/u.test(value);

/**
 * Walks the connector's opaque session cursor only after each durable device
 * command reaches a terminal success. Page request ids are deterministic from
 * the root id and opaque cursor, making retries safe after unknown outcomes.
 */
export const runPagedLiveSessionList = async ({
	deviceId,
	connectorId,
	requestId,
	requiresApproval,
	createCommand,
	loadCommands,
	signal,
	maximumPages = MAX_LIVE_SESSION_LIST_PAGES,
	waitForCommand = waitForLiveDeviceCommand
}: {
	deviceId: string;
	connectorId: string;
	requestId: string;
	requiresApproval: boolean;
	createCommand: (
		input: {
			deviceId: string;
			requestId: string;
			kind: 'session.list';
			input: { connectorId: string; cursor?: string; limit: number };
			requiresApproval: boolean;
		},
		signal: AbortSignal
	) => Promise<{ command: LiveDeviceCommandSnapshot }>;
	loadCommands: (signal: AbortSignal) => Promise<LiveDeviceCommandSnapshot[]>;
	signal: AbortSignal;
	maximumPages?: number;
	waitForCommand?: typeof waitForLiveDeviceCommand;
}): Promise<LiveSessionListResult> => {
	let cursor: string | null = null;
	let pages = 0;
	const seenCursors = new Set<string>();
	while (pages < maximumPages) {
		if (signal.aborted) return { status: 'aborted', pages, command: null };
		const created = await createCommand(
			{
				deviceId,
				requestId: pageRequestId(requestId, cursor),
				kind: 'session.list',
				input: { connectorId, ...(cursor ? { cursor } : {}), limit: LIVE_SESSION_LIST_PAGE_LIMIT },
				requiresApproval
			},
			signal
		);
		const outcome = await waitForCommand({ command: created.command, loadCommands, signal });
		if (outcome.status !== 'succeeded') return { status: outcome.status, pages, command: outcome.command };
		pages += 1;
		const nextCursor = outcome.command.outputRef;
		if (!nextCursor) return { status: 'succeeded', pages, command: outcome.command };
		if (!validCursor(nextCursor)) return { status: 'invalid-cursor', pages, command: outcome.command };
		if (seenCursors.has(nextCursor)) return { status: 'cursor-cycle', pages, command: outcome.command };
		seenCursors.add(nextCursor);
		cursor = nextCursor;
	}
	return { status: 'page-limit', pages, command: null };
};
