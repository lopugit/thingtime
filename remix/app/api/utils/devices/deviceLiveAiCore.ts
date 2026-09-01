import { decideDeviceRevision, deviceFail, deviceHash, devicePayloadHash, type DeviceFail, type RevisionDecision } from './deviceCore';

export const deviceLiveProviderForConnectorKind = (kind: unknown): 'chatgpt' | 'claude' | null => {
	if (typeof kind !== 'string') return null;
	const normalized = kind.trim().toLowerCase();
	if (normalized === 'claude' || normalized === 'claude-desktop' || normalized === 'claude-thingtime') return 'claude';
	if (normalized === 'chatgpt' || normalized === 'chatgpt-desktop' || normalized === 'openai' || normalized === 'codex') {
		return 'chatgpt';
	}
	return null;
};

export const deviceLiveExternalNamespace = (ownerId: string, deviceId: string, connectorId: string, sessionId: string): string =>
	deviceHash('ai-live-scope', ownerId, deviceId, connectorId, sessionId);

export const DEVICE_LIVE_SESSION_STATES = ['idle', 'running', 'waiting', 'waiting-approval', 'error', 'archived', 'unknown'] as const;
export type DeviceLiveSessionState = (typeof DEVICE_LIVE_SESSION_STATES)[number];

export const DEVICE_LIVE_TRANSCRIPT_ACTIVITY_TYPES = ['command', 'file-change', 'tool', 'web-search', 'plan', 'other'] as const;
export type DeviceLiveTranscriptActivityType = (typeof DEVICE_LIVE_TRANSCRIPT_ACTIVITY_TYPES)[number];

export const DEVICE_LIVE_ITEM_ACTIVITY_TYPES = ['plan', 'commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall', 'webSearch'] as const;
export type DeviceLiveItemActivityType = (typeof DEVICE_LIVE_ITEM_ACTIVITY_TYPES)[number];

export const DEVICE_LIVE_EVENT_TYPES = [
	'message.queued',
	'message.submitted',
	'message.delta',
	'item.started',
	'item.completed',
	'turn.started',
	'turn.completed',
	'turn.interrupted',
	'approval.requested',
	'approval.responded',
	'connector.warning'
] as const;
export type DeviceLiveEventType = (typeof DEVICE_LIVE_EVENT_TYPES)[number];

export type DeviceLiveSessionSummary = {
	sessionId: string;
	revision: number;
	title: string;
	projectId?: string | null;
	projectLabel?: string | null;
	state: DeviceLiveSessionState;
	createdAt?: string | null;
	updatedAt?: string | null;
};

export type DeviceLiveMessageEnvelope = {
	messageId: string;
	revision: number;
	role: 'user' | 'assistant';
	text: string;
	createdAt: string | null;
	completedAt: string | null;
};

export type DeviceLiveTranscriptMessage = DeviceLiveMessageEnvelope & {
	type: 'message';
};

export type DeviceLiveTranscriptActivity = {
	type: 'activity';
	activityId: string;
	revision: number;
	turnId: string;
	activity: DeviceLiveTranscriptActivityType;
	label: string;
	status: string;
	observedAt: string | null;
};

export type DeviceLiveTranscriptEntry = DeviceLiveTranscriptMessage | DeviceLiveTranscriptActivity;

export const liveTranscriptRevisionHash = (message: DeviceLiveMessageEnvelope): string =>
	devicePayloadHash({
		role: message.role,
		text: message.text,
		createdAt: message.createdAt,
		completedAt: message.completedAt
	});

export const decideLiveTranscriptRevision = (
	existingRevision: number | null,
	existingHash: string | null,
	message: DeviceLiveMessageEnvelope
): RevisionDecision => decideDeviceRevision(existingRevision, existingHash, message.revision, liveTranscriptRevisionHash(message));

export const liveTranscriptActivityRevisionHash = (activity: DeviceLiveTranscriptActivity): string =>
	devicePayloadHash({
		turnId: activity.turnId,
		activity: activity.activity,
		label: activity.label,
		status: activity.status,
		observedAt: activity.observedAt
	});

export const decideLiveTranscriptActivityRevision = (
	existingRevision: number | null,
	existingHash: string | null,
	activity: DeviceLiveTranscriptActivity
): RevisionDecision => decideDeviceRevision(existingRevision, existingHash, activity.revision, liveTranscriptActivityRevisionHash(activity));

export const staleLiveSegmentIndexes = (existingIndexes: number[], nextCount: number): number[] =>
	existingIndexes.filter((index) => Number.isSafeInteger(index) && index >= Math.max(0, nextCount));

// Unlike snapshot imports, live transcript text is also reconstructed from
// streamed deltas. Preserve every code point at segment boundaries so the
// durable mirror is byte-for-byte equivalent to the completed visible text.
export const splitLiveMessageText = (value: string, max: number): string[] => {
	if (!Number.isSafeInteger(max) || max < 1) throw new RangeError('Live message segment size must be positive');
	const chars = Array.from(value);
	if (!chars.length) return [];
	const chunks: string[] = [];
	let offset = 0;
	while (offset < chars.length) {
		let end = Math.min(offset + max, chars.length);
		if (end < chars.length) {
			const floor = offset + Math.floor(max * 0.6);
			for (let index = end - 1; index >= floor; index -= 1) {
				if (/\s/u.test(chars[index]!)) {
					end = index + 1;
					break;
				}
			}
		}
		chunks.push(chars.slice(offset, end).join(''));
		offset = end;
	}
	return chunks;
};

export type DeviceLiveTranscriptPage = {
	cursor: string | null;
	nextCursor: string | null;
	hasMore: boolean;
};

type DeviceLiveEventBase = {
	eventId: string;
	sequence: number;
	observedAt: string;
	turnId: string | null;
	itemId: string | null;
};

export type DeviceLiveSafeTurn = {
	id: string;
	status: string;
};

export type DeviceLiveSafeVisibleItem = {
	id: string | null;
	type: 'agentMessage' | 'userMessage';
	text: string;
};

export type DeviceLiveSafeActivityItem = {
	id: string | null;
	type: 'activity';
	activity: DeviceLiveItemActivityType;
	label: string;
	status: string;
};

export type DeviceLiveSafeItem = DeviceLiveSafeVisibleItem | DeviceLiveSafeActivityItem;

export type DeviceLiveConnectorEvent =
	| (DeviceLiveEventBase & { type: 'turn.started' | 'turn.completed'; turnId: string; payload: { turn: DeviceLiveSafeTurn } })
	| (DeviceLiveEventBase & { type: 'turn.interrupted'; turnId: string; payload: { commandId: string } })
	| (DeviceLiveEventBase & { type: 'message.queued'; payload: { commandId: string; text: string; queuePosition?: number } })
	| (DeviceLiveEventBase & {
			type: 'message.submitted';
			payload: { commandId: string; mode: 'queue' | 'steer'; text: string };
			message: DeviceLiveMessageEnvelope & { role: 'user' };
	  })
	| (DeviceLiveEventBase & { type: 'message.delta'; itemId: string; payload: { delta: string } })
	| (DeviceLiveEventBase & { type: 'item.started'; itemId: string; payload: { item: DeviceLiveSafeItem } })
	| (DeviceLiveEventBase & {
			type: 'approval.requested';
			payload: { requestId: string; label: string };
	  })
	| (DeviceLiveEventBase & {
			type: 'approval.responded';
			payload:
				| {
						requestId: string;
						decision: 'accept' | 'acceptForSession' | 'decline' | 'cancel';
						commandId: string;
				  }
				| { requestId: string; decision: 'cancel'; reason: 'expired' };
	  })
	| (DeviceLiveEventBase & {
			type: 'connector.warning';
			payload: { message: string; commandId?: string } | { reason: 'native-history-fallback' };
	  })
	| (DeviceLiveEventBase & {
			type: 'item.completed';
			itemId: string;
			payload: { item: DeviceLiveSafeItem };
			message?: DeviceLiveMessageEnvelope;
	  });

export const deviceLiveMaterializedMessages = (events: DeviceLiveConnectorEvent[]): DeviceLiveMessageEnvelope[] =>
	events.flatMap((event) => {
		if (event.type === 'message.submitted') return [event.message];
		if (event.type === 'item.completed' && event.message) return [event.message];
		return [];
	});

export type DeviceNodeLiveSyncRequest =
	| { op: 'sessions.upsert'; connectorId: string; sessions: DeviceLiveSessionSummary[] }
	| {
			op: 'transcript.page';
			connectorId: string;
			sessionId: string;
			page: DeviceLiveTranscriptPage;
			entries: DeviceLiveTranscriptEntry[];
	  }
	| {
			op: 'events.append';
			connectorId: string;
			sessionId: string;
			events: DeviceLiveConnectorEvent[];
	  };

export type DeviceNodeLiveSyncResponse =
	| {
			ok: true;
			op: 'sessions.upsert';
			accepted: number;
			idempotent: number;
			sessions: Array<{ sessionId: string; chatId: string; revision: number }>;
	  }
	| {
			ok: true;
			op: 'transcript.page';
			accepted: number;
			idempotent: number;
			messageSegments: number;
			acceptedActivities: number;
			idempotentActivities: number;
			nextCursor: string | null;
			hasMore: boolean;
	  }
	| {
			ok: true;
			op: 'events.append';
			acceptedEvents: number;
			replayedEvents: number;
			reconciledEvents: number;
			materializedMessages: number;
			idempotentMessages: number;
			messageSegments: number;
			lastSequence: number;
	  };

export type DeviceLiveReplayDecision = 'new' | 'replay' | 'reconcile' | 'conflict';

// Expiring browser events are not the durable source of truth: completed text
// is transactionally mirrored into quota-accounted Messenger rows. Once an old
// event receipt has expired, the durable session cursor may safely acknowledge
// it without applying its payload again. A still-retained mismatched receipt is
// always a conflict.
export const decideDeviceLiveReplay = (
	sequence: number,
	lastSequence: number,
	receipt: 'matching' | 'conflicting' | 'missing'
): DeviceLiveReplayDecision => {
	if (sequence > lastSequence) return 'new';
	if (receipt === 'matching') return 'replay';
	if (receipt === 'conflicting') return 'conflict';
	return 'reconcile';
};

const MAX_SESSIONS = 100;
const MAX_TRANSCRIPT_ENTRIES = 100;
const MAX_EVENTS = 100;
const MAX_ID_CHARS = 512;
const MAX_TEXT_CHARS = 256_000;
const MAX_BATCH_TEXT_CHARS = 512_000;
const MAX_DELTA_CHARS = 32_000;
const MAX_BATCH_DELTA_CHARS = 128_000;

const exactKeys = (value: Record<string, unknown>, allowed: readonly string[]): boolean => Object.keys(value).every((key) => allowed.includes(key));

const hasKeys = (value: Record<string, unknown>, required: readonly string[]): boolean =>
	required.every((key) => Object.prototype.hasOwnProperty.call(value, key));

const uniqueStrings = (values: string[]): boolean => new Set(values).size === values.length;

const opaque = (value: unknown, max = MAX_ID_CHARS): string | null => {
	if (typeof value !== 'string') return null;
	const result = value.trim();
	const unsafe = Array.from(result).some((character) => {
		const code = character.codePointAt(0) ?? 0;
		return code < 32 || code === 127 || character === '/' || character === '\\';
	});
	if (!result || result.length > max || unsafe) return null;
	return result;
};

const hasForbiddenTextControl = (value: string): boolean =>
	Array.from(value).some((character) => {
		const code = character.codePointAt(0) ?? 0;
		return (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127;
	});

// Codex can represent hidden execution context as text-shaped items. Those
// records are not user-visible chat and must fail closed even if a connector
// accidentally places them in the otherwise-valid public message envelope.
const INTERNAL_CONTEXT_MARKER =
	/(?:<\s*\/?\s*(?:system-reminder|local-command-caveat|codex_internal_context|environment_context|recommended_plugins|permissions(?:\s+instructions)?|apps_instructions|plugins_instructions|skills_instructions|agent-instructions|instructions|memory(?:_summary)?|multi_agent_mode|oai-mem-citation)(?:\s|>)|^\s*#\s*AGENTS\.md instructions\b)/imu;
const INTERNAL_CONTEXT_STREAM_MARKER =
	/(?:system-reminder|local-command-caveat|codex_internal_context|environment_context|recommended_plugins|apps_instructions|plugins_instructions|skills_instructions|agent-instructions|memory_summary|multi_agent_mode|oai-mem-citation|AGENTS\.md\s+instructions)/imu;
const INTERNAL_CONTEXT_STREAM_TAIL_CHARS = 128;
export const DEVICE_LIVE_MAX_DELTA_GUARD_TAILS = 64;

export type DeviceLiveDeltaGuardTail = {
	itemId: string;
	turnId: string | null;
	tail: string;
};

export type DeviceLiveDeltaGuardEvent = {
	type: DeviceLiveEventType;
	itemId: string | null;
	turnId: string | null;
	delta?: string;
};

export const deviceLiveTextContainsInternalContext = (value: string): boolean =>
	INTERNAL_CONTEXT_MARKER.test(value) || INTERNAL_CONTEXT_STREAM_MARKER.test(value);

export const nextDeviceLiveDeltaGuardTail = (priorTail: string, delta: string): string | null => {
	const combined = `${priorTail}${delta}`;
	return deviceLiveTextContainsInternalContext(combined) ? null : Array.from(combined).slice(-INTERNAL_CONTEXT_STREAM_TAIL_CHARS).join('');
};

export const normalizeDeviceLiveDeltaGuardTails = (value: unknown): DeviceLiveDeltaGuardTail[] | null => {
	if (!Array.isArray(value) || value.length > DEVICE_LIVE_MAX_DELTA_GUARD_TAILS) return null;
	const seen = new Set<string>();
	const result: DeviceLiveDeltaGuardTail[] = [];
	for (const entry of value) {
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
		const raw = entry as Record<string, unknown>;
		if (!exactKeys(raw, ['itemId', 'turnId', 'tail']) || !hasKeys(raw, ['itemId', 'turnId', 'tail'])) return null;
		const itemId = opaque(raw.itemId, 160);
		const turnId = raw.turnId === null ? null : opaque(raw.turnId, 160);
		const tail = typeof raw.tail === 'string' ? raw.tail : null;
		if (
			!itemId ||
			(raw.turnId !== null && !turnId) ||
			!tail ||
			Array.from(tail).length > INTERNAL_CONTEXT_STREAM_TAIL_CHARS ||
			hasForbiddenTextControl(tail) ||
			deviceLiveTextContainsInternalContext(tail)
		) {
			return null;
		}
		const key = `${turnId ?? ''}\u0000${itemId}`;
		if (!seen.add(key)) return null;
		result.push({ itemId, turnId, tail });
	}
	return result;
};

export const advanceDeviceLiveDeltaGuardTails = (
	current: DeviceLiveDeltaGuardTail[],
	event: DeviceLiveDeltaGuardEvent
): { ok: true; tails: DeviceLiveDeltaGuardTail[] } | { ok: false; reason: 'capacity' | 'internal-context' } => {
	let tails = current.map((entry) => ({ ...entry }));
	const matches = (entry: DeviceLiveDeltaGuardTail): boolean => entry.itemId === event.itemId && entry.turnId === event.turnId;
	if (event.type === 'message.delta') {
		if (!event.itemId || typeof event.delta !== 'string') return { ok: false, reason: 'internal-context' };
		const index = tails.findIndex(matches);
		if (index < 0 && tails.length >= DEVICE_LIVE_MAX_DELTA_GUARD_TAILS) return { ok: false, reason: 'capacity' };
		const nextTail = nextDeviceLiveDeltaGuardTail(index >= 0 ? tails[index]!.tail : '', event.delta);
		if (nextTail === null) return { ok: false, reason: 'internal-context' };
		const next = { itemId: event.itemId, turnId: event.turnId, tail: nextTail };
		if (index >= 0) tails[index] = next;
		else tails.push(next);
		return { ok: true, tails };
	}
	if (event.type === 'item.started' || event.type === 'item.completed') {
		tails = tails.filter((entry) => !matches(entry));
	} else if ((event.type === 'turn.completed' || event.type === 'turn.interrupted') && event.turnId) {
		tails = tails.filter((entry) => entry.turnId !== event.turnId);
	}
	return { ok: true, tails };
};

const boundedPreservedText = (value: unknown, max: number, options: { allowEmpty?: boolean; requireVisible?: boolean } = {}): string | null => {
	if (typeof value !== 'string' || Array.from(value).length > max || hasForbiddenTextControl(value)) return null;
	if (!options.allowEmpty && value.length === 0) return null;
	if (options.requireVisible && !value.trim()) return null;
	return value;
};

const boundedText = (value: unknown, max: number): string | null => {
	const preserved = boundedPreservedText(value, max, { requireVisible: true });
	return preserved === null ? null : preserved.trim();
};

// Deltas are concatenated byte-for-byte by the browser. A single whitespace
// delta is meaningful, so only an actually empty/control-invalid delta fails.
const boundedDelta = (value: unknown): string | null => {
	const delta = boundedPreservedText(value, MAX_DELTA_CHARS);
	return delta !== null && !deviceLiveTextContainsInternalContext(delta) ? delta : null;
};

const boundedMessageText = (value: unknown): string | null => {
	const text = boundedPreservedText(value, MAX_TEXT_CHARS, { requireVisible: true });
	return text !== null && !deviceLiveTextContainsInternalContext(text) ? text : null;
};

const revision = (value: unknown): number | null => (Number.isSafeInteger(value) && Number(value) >= 1 ? Number(value) : null);

const timestamp = (value: unknown, optional = true): string | null | undefined => {
	if ((value === undefined || value === null) && optional) return null;
	if (typeof value !== 'string' || !value) return undefined;
	const parsed = new Date(value);
	if (!Number.isFinite(parsed.getTime()) || parsed.getTime() < Date.UTC(1990, 0, 1) || parsed.getTime() > Date.now() + 86_400_000) {
		return undefined;
	}
	return parsed.toISOString();
};

const nullableOpaque = (value: unknown, max = MAX_ID_CHARS): string | null | undefined => {
	if (value === undefined || value === null) return null;
	return opaque(value, max) ?? undefined;
};

const nullableCursor = (value: unknown): string | null | undefined => {
	if (value === null) return null;
	if (typeof value !== 'string' || !value || value !== value.trim() || Array.from(value).length > 2_048) return undefined;
	return hasForbiddenTextControl(value) ? undefined : value;
};

const normalizeSession = (value: unknown): DeviceLiveSessionSummary | null => {
	if (!value || typeof value !== 'object') return null;
	const raw = value as Record<string, unknown>;
	if (!exactKeys(raw, ['sessionId', 'revision', 'title', 'projectId', 'projectLabel', 'state', 'createdAt', 'updatedAt'])) return null;
	const sessionId = opaque(raw.sessionId);
	const sessionRevision = revision(raw.revision);
	const title = boundedText(raw.title, 80);
	const projectId = nullableOpaque(raw.projectId);
	const projectLabel = raw.projectLabel === undefined || raw.projectLabel === null ? null : boundedText(raw.projectLabel, 80);
	const state = (DEVICE_LIVE_SESSION_STATES as readonly unknown[]).includes(raw.state) ? (raw.state as DeviceLiveSessionState) : null;
	const createdAt = timestamp(raw.createdAt);
	const updatedAt = timestamp(raw.updatedAt);
	if (!sessionId || !sessionRevision || !title || projectId === undefined || (projectLabel === null && raw.projectLabel != null) || !state)
		return null;
	if (createdAt === undefined || updatedAt === undefined) return null;
	return { sessionId, revision: sessionRevision, title, projectId, projectLabel, state, createdAt, updatedAt };
};

const normalizeMessageEnvelope = (value: unknown): DeviceLiveMessageEnvelope | null => {
	if (!value || typeof value !== 'object') return null;
	const raw = value as Record<string, unknown>;
	const keys = ['messageId', 'revision', 'role', 'text', 'createdAt', 'completedAt'];
	if (!exactKeys(raw, keys) || !hasKeys(raw, keys)) return null;
	const messageId = opaque(raw.messageId);
	const messageRevision = revision(raw.revision);
	const role = raw.role === 'user' || raw.role === 'assistant' ? raw.role : null;
	const text = boundedMessageText(raw.text);
	const createdAt = timestamp(raw.createdAt);
	const completedAt = timestamp(raw.completedAt);
	if (!messageId || !messageRevision || !role || text === null || createdAt === undefined || completedAt === undefined) return null;
	if (createdAt && completedAt && new Date(createdAt).getTime() > new Date(completedAt).getTime()) return null;
	return { messageId, revision: messageRevision, role, text, createdAt, completedAt };
};

const normalizeTranscriptMessage = (value: unknown): DeviceLiveTranscriptMessage | null => {
	if (!value || typeof value !== 'object') return null;
	const raw = value as Record<string, unknown>;
	if (raw.type !== 'message' || !exactKeys(raw, ['type', 'messageId', 'revision', 'role', 'text', 'createdAt', 'completedAt'])) return null;
	const envelope = normalizeMessageEnvelope({
		messageId: raw.messageId,
		revision: raw.revision,
		role: raw.role,
		text: raw.text,
		createdAt: raw.createdAt,
		completedAt: raw.completedAt
	});
	return envelope ? { type: 'message', ...envelope } : null;
};

const normalizeTranscriptActivity = (value: unknown): DeviceLiveTranscriptActivity | null => {
	if (!value || typeof value !== 'object') return null;
	const raw = value as Record<string, unknown>;
	const keys = ['type', 'activityId', 'revision', 'turnId', 'activity', 'label', 'status', 'observedAt'];
	if (raw.type !== 'activity' || !exactKeys(raw, keys) || !hasKeys(raw, keys)) return null;
	const activityId = opaque(raw.activityId);
	const activityRevision = revision(raw.revision);
	const turnId = opaque(raw.turnId, 160);
	const activity = (DEVICE_LIVE_TRANSCRIPT_ACTIVITY_TYPES as readonly unknown[]).includes(raw.activity)
		? (raw.activity as DeviceLiveTranscriptActivityType)
		: null;
	const label = boundedText(raw.label, 160);
	const status = boundedText(raw.status, 64);
	const observedAt = timestamp(raw.observedAt);
	return activityId && activityRevision && turnId && activity && label && status && observedAt !== undefined
		? { type: 'activity', activityId, revision: activityRevision, turnId, activity, label, status, observedAt }
		: null;
};

const normalizePage = (value: unknown): DeviceLiveTranscriptPage | null => {
	if (!value || typeof value !== 'object') return null;
	const raw = value as Record<string, unknown>;
	if (!exactKeys(raw, ['cursor', 'nextCursor', 'hasMore']) || !hasKeys(raw, ['cursor', 'nextCursor', 'hasMore']) || typeof raw.hasMore !== 'boolean')
		return null;
	const cursor = nullableCursor(raw.cursor);
	const nextCursor = nullableCursor(raw.nextCursor);
	if (cursor === undefined || nextCursor === undefined) return null;
	// A continuation must advance to a new opaque cursor. Requiring the cursor
	// and hasMore signals to agree prevents a native connector from creating an
	// unbounded browser read loop with a stuck or contradictory page token.
	if (raw.hasMore !== (nextCursor !== null) || (raw.hasMore && nextCursor === cursor)) return null;
	return { cursor, nextCursor, hasMore: raw.hasMore };
};

const normalizeSafeTurn = (value: unknown): DeviceLiveSafeTurn | null => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const raw = value as Record<string, unknown>;
	if (!exactKeys(raw, ['id', 'status']) || !hasKeys(raw, ['id', 'status'])) return null;
	const id = opaque(raw.id, 160);
	const status = boundedText(raw.status, 64);
	return id && status ? { id, status } : null;
};

const normalizeSafeItem = (value: unknown): DeviceLiveSafeItem | null => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const raw = value as Record<string, unknown>;
	const id = nullableOpaque(raw.id, 160);
	if (id === undefined || !Object.prototype.hasOwnProperty.call(raw, 'id')) return null;
	if (raw.type === 'agentMessage' || raw.type === 'userMessage') {
		if (!exactKeys(raw, ['id', 'type', 'text']) || !hasKeys(raw, ['id', 'type', 'text'])) return null;
		const text = boundedPreservedText(raw.text, MAX_TEXT_CHARS, { allowEmpty: true });
		return text === null || deviceLiveTextContainsInternalContext(text) ? null : { id, type: raw.type, text };
	}
	if (raw.type !== 'activity') return null;
	const keys = ['id', 'type', 'activity', 'label', 'status'];
	if (!exactKeys(raw, keys) || !hasKeys(raw, keys)) return null;
	const activity = (DEVICE_LIVE_ITEM_ACTIVITY_TYPES as readonly unknown[]).includes(raw.activity)
		? (raw.activity as DeviceLiveItemActivityType)
		: null;
	const label = boundedText(raw.label, 160);
	const status = boundedText(raw.status, 64);
	return activity && label && status ? { id, type: 'activity', activity, label, status } : null;
};

const normalizeEvent = (value: unknown): DeviceLiveConnectorEvent | null => {
	if (!value || typeof value !== 'object') return null;
	const raw = value as Record<string, unknown>;
	const type = (DEVICE_LIVE_EVENT_TYPES as readonly unknown[]).includes(raw.type) ? (raw.type as DeviceLiveEventType) : null;
	const allowed =
		type === 'item.completed' || type === 'message.submitted'
			? ['eventId', 'sequence', 'observedAt', 'turnId', 'itemId', 'type', 'payload', 'message']
			: ['eventId', 'sequence', 'observedAt', 'turnId', 'itemId', 'type', 'payload'];
	if (!type || !exactKeys(raw, allowed) || !hasKeys(raw, ['eventId', 'sequence', 'observedAt', 'turnId', 'itemId', 'type', 'payload'])) return null;
	const eventId = opaque(raw.eventId, 160);
	const eventSequence = revision(raw.sequence);
	const observedAt = timestamp(raw.observedAt, false);
	const turnId = nullableOpaque(raw.turnId, 160);
	const itemId = nullableOpaque(raw.itemId, 160);
	if (!eventId || !eventSequence || !observedAt || turnId === undefined || itemId === undefined) return null;
	if (!raw.payload || typeof raw.payload !== 'object' || Array.isArray(raw.payload)) return null;
	const payload = raw.payload as Record<string, unknown>;
	const base = { eventId, sequence: eventSequence, observedAt, turnId, itemId };
	if (type === 'turn.started' || type === 'turn.completed') {
		const turn = normalizeSafeTurn(payload.turn);
		return turnId && turn && turn.id === turnId && exactKeys(payload, ['turn']) && hasKeys(payload, ['turn'])
			? { ...base, type, turnId, payload: { turn } }
			: null;
	}
	if (type === 'turn.interrupted') {
		const commandId = opaque(payload.commandId, 160);
		return turnId && commandId && exactKeys(payload, ['commandId']) && hasKeys(payload, ['commandId'])
			? { ...base, type, turnId, payload: { commandId } }
			: null;
	}
	if (type === 'message.queued') {
		const commandId = opaque(payload.commandId, 160);
		const text = boundedMessageText(payload.text);
		const queuePosition = payload.queuePosition !== undefined ? revision(payload.queuePosition) : null;
		if (
			!commandId ||
			text === null ||
			!exactKeys(payload, ['commandId', 'text', 'queuePosition']) ||
			!hasKeys(payload, ['commandId', 'text']) ||
			(payload.queuePosition !== undefined && queuePosition === null)
		)
			return null;
		return { ...base, type, payload: { commandId, text, ...(queuePosition ? { queuePosition } : {}) } };
	}
	if (type === 'message.submitted') {
		const commandId = opaque(payload.commandId, 160);
		const mode = payload.mode === 'queue' || payload.mode === 'steer' ? payload.mode : null;
		const text = boundedMessageText(payload.text);
		const message = normalizeMessageEnvelope(raw.message);
		if (
			!commandId ||
			!mode ||
			text === null ||
			!message ||
			message.role !== 'user' ||
			message.messageId !== commandId ||
			message.text !== text ||
			message.completedAt !== observedAt ||
			!exactKeys(payload, ['commandId', 'mode', 'text']) ||
			!hasKeys(payload, ['commandId', 'mode', 'text'])
		)
			return null;
		return { ...base, type, payload: { commandId, mode, text }, message: { ...message, role: 'user' } };
	}
	if (type === 'message.delta') {
		const delta = boundedDelta(payload.delta);
		return itemId && exactKeys(payload, ['delta']) && hasKeys(payload, ['delta']) && delta !== null
			? { ...base, type, itemId, payload: { delta } }
			: null;
	}
	if (type === 'item.started' || type === 'item.completed') {
		const item = normalizeSafeItem(payload.item);
		const canonicalItemId = itemId || item?.id || null;
		if (!item || !canonicalItemId || (item.id && itemId && item.id !== itemId) || !exactKeys(payload, ['item']) || !hasKeys(payload, ['item']))
			return null;
		const normalizedItem = { ...item, id: canonicalItemId } as DeviceLiveSafeItem;
		if (type === 'item.started') {
			return { ...base, type, itemId: canonicalItemId, payload: { item: normalizedItem } };
		}
		const hasVisibleText = normalizedItem.type !== 'activity' && Boolean(normalizedItem.text.trim());
		const message = raw.message === undefined ? null : normalizeMessageEnvelope(raw.message);
		if (!hasVisibleText) {
			return raw.message === undefined ? { ...base, type, itemId: canonicalItemId, payload: { item: normalizedItem } } : null;
		}
		const expectedRole = normalizedItem.type === 'userMessage' ? 'user' : 'assistant';
		if (expectedRole === 'user' && raw.message === undefined) {
			return { ...base, type, itemId: canonicalItemId, payload: { item: normalizedItem } };
		}
		return message &&
			message.messageId === canonicalItemId &&
			message.role === expectedRole &&
			message.text === normalizedItem.text &&
			message.completedAt === observedAt
			? { ...base, type, itemId: canonicalItemId, payload: { item: normalizedItem }, message }
			: null;
	}
	if (type === 'approval.requested') {
		const requestId = opaque(payload.requestId, 160);
		const label = boundedText(payload.label, 160);
		return requestId && label && exactKeys(payload, ['requestId', 'label']) && hasKeys(payload, ['requestId', 'label'])
			? { ...base, type, payload: { requestId, label } }
			: null;
	}
	if (type === 'approval.responded') {
		const requestId = opaque(payload.requestId, 160);
		const decision =
			payload.decision === 'accept' || payload.decision === 'acceptForSession' || payload.decision === 'decline' || payload.decision === 'cancel'
				? payload.decision
				: null;
		if (payload.reason === 'expired') {
			return requestId &&
				decision === 'cancel' &&
				exactKeys(payload, ['requestId', 'decision', 'reason']) &&
				hasKeys(payload, ['requestId', 'decision', 'reason'])
				? { ...base, type, payload: { requestId, decision: 'cancel', reason: 'expired' } }
				: null;
		}
		const commandId = opaque(payload.commandId, 160);
		return requestId &&
			decision &&
			commandId &&
			exactKeys(payload, ['requestId', 'decision', 'commandId']) &&
			hasKeys(payload, ['requestId', 'decision', 'commandId'])
			? { ...base, type, payload: { requestId, decision, commandId } }
			: null;
	}
	if (payload.reason === 'native-history-fallback') {
		return exactKeys(payload, ['reason']) && hasKeys(payload, ['reason'])
			? { ...base, type: 'connector.warning', payload: { reason: 'native-history-fallback' } }
			: null;
	}
	const message = boundedText(payload.message, 500);
	const commandId = payload.commandId === undefined ? null : opaque(payload.commandId, 160);
	return message && exactKeys(payload, ['message', 'commandId']) && hasKeys(payload, ['message']) && (payload.commandId === undefined || commandId)
		? { ...base, type: 'connector.warning', payload: { message, ...(commandId ? { commandId } : {}) } }
		: null;
};

export const normalizeDeviceNodeLiveSyncRequest = (value: unknown): DeviceFail | { ok: true; request: DeviceNodeLiveSyncRequest } => {
	if (!value || typeof value !== 'object') return deviceFail(400, 'A live sync request is required');
	const raw = value as Record<string, unknown>;
	const connectorId = opaque(raw.connectorId, 80);
	if (!connectorId) return deviceFail(400, 'connectorId is required');
	if (raw.op === 'sessions.upsert') {
		if (!exactKeys(raw, ['op', 'connectorId', 'sessions']) || !Array.isArray(raw.sessions) || raw.sessions.length > MAX_SESSIONS) {
			return deviceFail(400, `sessions.upsert accepts at most ${MAX_SESSIONS} exact session summaries`);
		}
		const sessions = raw.sessions.map(normalizeSession);
		if (sessions.some((entry) => !entry) || !uniqueStrings(sessions.map((entry) => entry?.sessionId || ''))) {
			return deviceFail(400, 'One or more live session summaries are invalid or duplicated');
		}
		return { ok: true, request: { op: 'sessions.upsert', connectorId, sessions: sessions as DeviceLiveSessionSummary[] } };
	}
	if (raw.op === 'transcript.page') {
		if (
			!exactKeys(raw, ['op', 'connectorId', 'sessionId', 'page', 'entries']) ||
			!Array.isArray(raw.entries) ||
			raw.entries.length > MAX_TRANSCRIPT_ENTRIES
		) {
			return deviceFail(400, `transcript.page accepts at most ${MAX_TRANSCRIPT_ENTRIES} exact visible entries`);
		}
		const sessionId = opaque(raw.sessionId);
		const page = normalizePage(raw.page);
		const entries = raw.entries.map((entry) => {
			if (!entry || typeof entry !== 'object') return null;
			return (entry as Record<string, unknown>).type === 'activity' ? normalizeTranscriptActivity(entry) : normalizeTranscriptMessage(entry);
		});
		const totalText = entries.reduce((total, entry) => total + (entry?.type === 'message' ? Array.from(entry.text).length : 0), 0);
		const entryKeys = entries.map((entry) =>
			entry?.type === 'message' ? `message:${entry.messageId}` : entry?.type === 'activity' ? `activity:${entry.activityId}` : ''
		);
		if (!sessionId || !page || entries.some((entry) => !entry) || !uniqueStrings(entryKeys) || totalText > MAX_BATCH_TEXT_CHARS) {
			return deviceFail(400, 'The transcript page is invalid or too large');
		}
		return { ok: true, request: { op: 'transcript.page', connectorId, sessionId, page, entries: entries as DeviceLiveTranscriptEntry[] } };
	}
	if (raw.op === 'events.append') {
		if (
			!exactKeys(raw, ['op', 'connectorId', 'sessionId', 'events']) ||
			!Array.isArray(raw.events) ||
			!raw.events.length ||
			raw.events.length > MAX_EVENTS
		) {
			return deviceFail(400, `events.append requires 1..${MAX_EVENTS} exact events`);
		}
		const sessionId = opaque(raw.sessionId);
		const events = raw.events.map(normalizeEvent);
		const deltaChars = events.reduce((total, event) => total + (event?.type === 'message.delta' ? Array.from(event.payload.delta).length : 0), 0);
		const completedChars = events.reduce(
			(total, event) =>
				total +
				(event && (event.type === 'item.completed' || event.type === 'message.submitted') && event.message
					? Array.from(event.message.text).length
					: 0),
			0
		);
		const contiguous = events.every(
			(event, index) => !index || (!!event && !!events[index - 1] && event.sequence === events[index - 1]!.sequence + 1)
		);
		const deltaTails = new Map<string, string>();
		const safeDeltaStreams = events.every((event) => {
			if (!event || event.type !== 'message.delta') return true;
			const prior = deltaTails.get(event.itemId) || '';
			const next = nextDeviceLiveDeltaGuardTail(prior, event.payload.delta);
			if (next === null) return false;
			deltaTails.set(event.itemId, next);
			return true;
		});
		const eventIdsUnique = uniqueStrings(events.map((event) => event?.eventId || ''));
		if (
			!sessionId ||
			events.some((event) => !event) ||
			!contiguous ||
			!safeDeltaStreams ||
			!eventIdsUnique ||
			deltaChars > MAX_BATCH_DELTA_CHARS ||
			completedChars > MAX_BATCH_TEXT_CHARS
		) {
			return deviceFail(400, 'Live events must be valid, contiguous, and within visible-text limits');
		}
		return { ok: true, request: { op: 'events.append', connectorId, sessionId, events: events as DeviceLiveConnectorEvent[] } };
	}
	return deviceFail(400, 'Unknown live sync operation');
};
