export const AI_SOURCE_PROVIDERS = ['chatgpt', 'claude'] as const;

export type AiSourceProvider = (typeof AI_SOURCE_PROVIDERS)[number];
export type AiMessageRole = 'user' | 'assistant' | 'system' | 'unknown';

type PublicExternalAiSourceBase = {
  provider: AiSourceProvider;
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
	access: 'imported';
	connector: string;
	deviceId?: string;
	readOnly: true;
};

export type PublicLiveExternalAiSource = PublicExternalAiSourceBase & {
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

export type PublicExternalAiSource = PublicImportedExternalAiSource | PublicLiveExternalAiSource;

const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.trim().slice(0, max) : '');

export const publicExternalAiSource = (value: unknown): PublicExternalAiSource | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
	const provider = AI_SOURCE_PROVIDERS.includes(raw.provider as AiSourceProvider) ? (raw.provider as AiSourceProvider) : null;
  const sourceId = text(raw.sourceId, 64);
  const label = text(raw.label, 80);
	const deviceId = text(raw.deviceId, 160);
	const access = raw.access === undefined || raw.access === 'imported' ? 'imported' : raw.access === 'live' ? 'live' : null;
	if (!provider || !sourceId || !label || !access) return null;

	const role = ['user', 'assistant', 'system', 'unknown'].includes(String(raw.role)) ? (raw.role as AiMessageRole) : undefined;
  const authorName = text(raw.authorName, 80) || null;
	const segmentIndex = Number.isSafeInteger(raw.segmentIndex) && Number(raw.segmentIndex) >= 0 ? Number(raw.segmentIndex) : undefined;
	const segmentCount = Number.isSafeInteger(raw.segmentCount) && Number(raw.segmentCount) > 0 ? Number(raw.segmentCount) : undefined;
	const messageId = text(raw.messageId, 512) || undefined;
	const revision = Number.isSafeInteger(raw.revision) && Number(raw.revision) >= 1 ? Number(raw.revision) : undefined;

	const shared = {
    provider,
    sourceId,
    label,
    ...(role ? { role } : {}),
    ...(authorName ? { authorName } : {}),
    ...(segmentIndex !== undefined ? { segmentIndex } : {}),
		...(segmentCount !== undefined ? { segmentCount } : {}),
		...(messageId ? { messageId } : {}),
		...(revision !== undefined ? { revision } : {})
	};

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
