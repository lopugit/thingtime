// 'lopu' is the first-party assistant (api/utils/messenger/lopuChats.ts): a
// discriminator on Lopu chats and their assistant rows, never an importable
// or live-device provider — publicExternalAiSource ties it to
// access === 'lopu' in both directions.
export const AI_SOURCE_PROVIDERS = ['chatgpt', 'claude', 'lopu'] as const;

export type AiSourceProvider = (typeof AI_SOURCE_PROVIDERS)[number];
// the providers a desktop import or a live device session may claim
export type ExternalAiSourceProvider = Exclude<AiSourceProvider, 'lopu'>;
export type AiMessageRole = 'user' | 'assistant' | 'system' | 'unknown';

type PublicExternalAiSourceBase = {
  sourceId: string;
  label: string;
  role?: AiMessageRole;
  authorName?: string | null;
  segmentIndex?: number;
  segmentCount?: number;
	messageId?: string;
	revision?: number;
};

export type PublicImportedExternalAiSource = PublicExternalAiSourceBase & {
	provider: ExternalAiSourceProvider;
	access: 'imported';
	connector: string;
	deviceId?: string;
	readOnly: true;
};

export type PublicLiveExternalAiSource = PublicExternalAiSourceBase & {
	provider: ExternalAiSourceProvider;
	access: 'live';
	connector: string;
	deviceId: string;
	connectorId: string;
	sessionId: string;
	capabilities: string[];
	projectId?: string | null;
	projectLabel?: string | null;
	historyCursor?: string | null;
	historyHasMore?: boolean;
	historySyncedAt?: string;
	readOnly: false;
};

// Lopu conversations: readOnly is false on the chat (the user keeps talking)
// and true on Lopu's own reply rows (never editable; deletable by the owner).
export type PublicLopuExternalAiSource = PublicExternalAiSourceBase & {
	provider: 'lopu';
	access: 'lopu';
	connector: string;
	readOnly: boolean;
};

export type PublicExternalAiSource = PublicImportedExternalAiSource | PublicLiveExternalAiSource | PublicLopuExternalAiSource;

const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.trim().slice(0, max) : '');

export const publicExternalAiSource = (value: unknown): PublicExternalAiSource | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
	const provider = AI_SOURCE_PROVIDERS.includes(raw.provider as AiSourceProvider) ? (raw.provider as AiSourceProvider) : null;
  const sourceId = text(raw.sourceId, 64);
  const label = text(raw.label, 80);
	const deviceId = text(raw.deviceId, 160);
	const access =
		raw.access === undefined || raw.access === 'imported' ? 'imported' : raw.access === 'live' ? 'live' : raw.access === 'lopu' ? 'lopu' : null;
	if (!provider || !sourceId || !label || !access) return null;

	const role = ['user', 'assistant', 'system', 'unknown'].includes(String(raw.role)) ? (raw.role as AiMessageRole) : undefined;
  const authorName = text(raw.authorName, 80) || null;
	const segmentIndex = Number.isSafeInteger(raw.segmentIndex) && Number(raw.segmentIndex) >= 0 ? Number(raw.segmentIndex) : undefined;
	const segmentCount = Number.isSafeInteger(raw.segmentCount) && Number(raw.segmentCount) > 0 ? Number(raw.segmentCount) : undefined;
	const messageId = text(raw.messageId, 512) || undefined;
	const revision = Number.isSafeInteger(raw.revision) && Number(raw.revision) >= 1 ? Number(raw.revision) : undefined;

	const details = {
    sourceId,
    label,
    ...(role ? { role } : {}),
    ...(authorName ? { authorName } : {}),
    ...(segmentIndex !== undefined ? { segmentIndex } : {}),
		...(segmentCount !== undefined ? { segmentCount } : {}),
		...(messageId ? { messageId } : {}),
		...(revision !== undefined ? { revision } : {})
	};

	// The first-party assistant is neither importable nor a live device
	// session, and nothing else may wear its provider.
	if (provider === 'lopu') {
		if (access !== 'lopu') return null;
		const connector = text(raw.connector, 80);
		if (!connector) return null;
		return { ...details, provider, access, connector, readOnly: raw.readOnly === true };
	}
	if (access === 'lopu') return null;

	const shared = { provider, ...details };

	if (access === 'imported') {
		const connector = text(raw.connector, 80);
		if (!connector) return null;
		return {
			...shared,
			access,
			connector,
			...(deviceId ? { deviceId } : {}),
			readOnly: true
		};
	}

	const connectorId = text(raw.connectorId, 80);
	const connector = text(raw.connector, 80);
	const sessionId = text(raw.sessionId, 512);
	if (!deviceId || !connector || !connectorId || !sessionId || !Array.isArray(raw.capabilities) || raw.capabilities.length > 64) return null;
	const capabilities = raw.capabilities.map((value) => text(value, 100));
	if (capabilities.some((value) => !value)) return null;
	const projectId = raw.projectId === undefined || raw.projectId === null ? null : text(raw.projectId, 512);
	const projectLabel = raw.projectLabel === undefined || raw.projectLabel === null ? null : text(raw.projectLabel, 80);
	if (projectId === '' || projectLabel === '') return null;
	const hasHistoryProgress = raw.historyCursor !== undefined || raw.historyHasMore !== undefined || raw.historySyncedAt !== undefined;
	let historyProgress: { historyCursor: string | null; historyHasMore: boolean; historySyncedAt: string } | null = null;
	if (hasHistoryProgress) {
		const historyCursor =
			raw.historyCursor === null
				? null
				: typeof raw.historyCursor === 'string' &&
				  raw.historyCursor === raw.historyCursor.trim() &&
				  raw.historyCursor.length > 0 &&
				  Array.from(raw.historyCursor).length <= 2_048 &&
				  !/[\p{Cc}\p{Cf}]/u.test(raw.historyCursor)
				? raw.historyCursor
				: undefined;
		const syncedAt = typeof raw.historySyncedAt === 'string' ? new Date(raw.historySyncedAt) : null;
		if (
			historyCursor === undefined ||
			typeof raw.historyHasMore !== 'boolean' ||
			raw.historyHasMore !== (historyCursor !== null) ||
			!syncedAt ||
			!Number.isFinite(syncedAt.getTime())
		)
			return null;
		historyProgress = {
			historyCursor,
			historyHasMore: raw.historyHasMore,
			historySyncedAt: syncedAt.toISOString()
		};
	}

	return {
		...shared,
		access,
		connector,
		deviceId,
		connectorId,
		sessionId,
		capabilities,
		...(projectId ? { projectId } : {}),
		...(projectLabel ? { projectLabel } : {}),
		...(historyProgress || {}),
		readOnly: false
  };
};

// ── Lopu turn metadata (crystal.lopu on chat-message rows) ──
//
// Written by lopuChats.ts, projected onto PublicChatMessage.lopu so the chat
// UI can render tool-activity cards for historical turns. The sanitiser is
// the stored shape too: whatever the reply route hands over is bounded here
// once, on the way in, and read back verbatim.
export const LOPU_TURN_PROVIDERS = ['claude', 'openai', 'vault', 'test', 'fallback'] as const;
export type LopuTurnProvider = (typeof LOPU_TURN_PROVIDERS)[number];
export const LOPU_MAX_TOOL_CALLS = 20;
export const LOPU_TOOL_SUMMARY_MAX_CHARS = 240;
export const LOPU_PROVIDER_LABEL_MAX_CHARS = 80;

export type PublicLopuToolCall = { name: string; ok: boolean; summary: string; thingId?: string };

export type PublicLopuMessageMeta = {
	role: 'user' | 'assistant';
	requestId: string | null;
	segmentIndex: number;
	segmentCount: number;
	// assistant rows only
	model?: string | null;
	effort?: string | null;
	speed?: string | null;
	provider?: LopuTurnProvider;
	// the vault connection's display name — 'vault' rows only, so history
	// reads "via <name>" after a reload (never the endpoint or a credential)
	providerLabel?: string;
	usage?: { inputTokens: number; outputTokens: number };
	toolCalls?: PublicLopuToolCall[];
	stopReason?: string | null;
};

const nonNegativeInt = (value: unknown): number | undefined =>
	Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined;

export const publicLopuMessageMeta = (value: unknown): PublicLopuMessageMeta | null => {
	if (!value || typeof value !== 'object') return null;
	const raw = value as Record<string, unknown>;
	const role = raw.role === 'assistant' ? 'assistant' : raw.role === 'user' ? 'user' : null;
	if (!role) return null;
	const segmentIndex = nonNegativeInt(raw.segmentIndex) ?? 0;
	const segmentCount = Math.max(1, nonNegativeInt(raw.segmentCount) ?? 1);
	const meta: PublicLopuMessageMeta = { role, requestId: text(raw.requestId, 128) || null, segmentIndex, segmentCount };
	if (role !== 'assistant') return meta;
	meta.model = text(raw.model, 128) || null;
	meta.effort = text(raw.effort, 32) || null;
	meta.speed = text(raw.speed, 32) || null;
	if (LOPU_TURN_PROVIDERS.includes(raw.provider as LopuTurnProvider)) meta.provider = raw.provider as LopuTurnProvider;
	if (meta.provider === 'vault') {
		const providerLabel = text(raw.providerLabel, LOPU_PROVIDER_LABEL_MAX_CHARS);
		if (providerLabel) meta.providerLabel = providerLabel;
	}
	const usage = raw.usage && typeof raw.usage === 'object' ? (raw.usage as Record<string, unknown>) : null;
	const inputTokens = nonNegativeInt(usage?.inputTokens);
	const outputTokens = nonNegativeInt(usage?.outputTokens);
	if (inputTokens !== undefined && outputTokens !== undefined) meta.usage = { inputTokens, outputTokens };
	if (Array.isArray(raw.toolCalls)) {
		const toolCalls: PublicLopuToolCall[] = [];
		for (const entry of raw.toolCalls.slice(0, LOPU_MAX_TOOL_CALLS)) {
			if (!entry || typeof entry !== 'object') continue;
			const call = entry as Record<string, unknown>;
			const name = text(call.name, 80);
			if (!name) continue;
			const thingId = text(call.thingId, 128);
			toolCalls.push({
				name,
				ok: call.ok === true,
				summary: text(call.summary, LOPU_TOOL_SUMMARY_MAX_CHARS),
				...(thingId ? { thingId } : {})
			});
		}
		if (toolCalls.length) meta.toolCalls = toolCalls;
	}
	meta.stopReason = text(raw.stopReason, 40) || null;
	return meta;
};
