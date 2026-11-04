import { readLocalCache, writeLocalCache } from '~/hooks/localCache';

import { cacheableAgentSession, initialAgentSession, type AgentSessionMessage, type AgentSessionState } from './agentSessionCore';

const VERSION = 2;
const LEGACY_VERSION = 1;

type CachedAgentSession = {
	version: typeof VERSION;
	writtenAt: string;
	sessionId: string;
	messages: Array<Omit<AgentSessionMessage, 'commandId' | 'queuePosition'>>;
};

const token = (value: string | null | undefined) =>
	encodeURIComponent((typeof value === 'string' && value.trim() ? value.trim() : 'anonymous').slice(0, 180));

export const agentSessionCacheKey = (userId: string | null | undefined, deviceId: string, connectorId: string, sessionId: string) =>
	`tt-agent-session:${token(userId)}:${token(deviceId)}:${token(connectorId)}:${token(sessionId)}`;

const isMessage = (value: unknown): value is CachedAgentSession['messages'][number] => {
	if (!value || typeof value !== 'object') return false;
	const message = value as Record<string, unknown>;
	return (
		typeof message.id === 'string' &&
		(message.role === 'user' || message.role === 'assistant') &&
		typeof message.text === 'string' &&
		message.delivery === 'complete' &&
		(message.turnId === null || typeof message.turnId === 'string') &&
		typeof message.observedAt === 'string' &&
		!('commandId' in message) &&
		!('queuePosition' in message)
	);
};

export const readAgentSessionCache = (
	userId: string | null | undefined,
	deviceId: string,
	connectorId: string,
	sessionId: string
): AgentSessionState => {
	const cached = readLocalCache<unknown>(agentSessionCacheKey(userId, deviceId, connectorId, sessionId));
	return restoreAgentSessionCache(sessionId, cached);
};

export const restoreAgentSessionCache = (sessionId: string, cached: unknown): AgentSessionState => {
	const empty = initialAgentSession(sessionId);
	if (!cached || typeof cached !== 'object') return empty;
	const value = cached as Partial<CachedAgentSession>;
	if (
		(value.version !== VERSION && value.version !== LEGACY_VERSION) ||
		value.sessionId !== sessionId ||
		!Array.isArray(value.messages) ||
		!value.messages.every(isMessage)
	)
		return empty;
	// The cache deliberately contains only durable, completed chat bubbles. It
	// does not contain active turns, queued commands, activities, or approvals,
	// so restoring its former high-water sequence would make the reducer discard
	// the retained events needed to rebuild that transient state. Start event
	// replay from zero instead. The server stream is bounded; if an approval has
	// already aged out, it cannot be reconstructed unless the connector publishes
	// that pending approval again.
	return {
		...empty,
		messages: value.messages.slice(-200).map((message) => ({
			...message,
			commandId: null,
			queuePosition: null
		}))
	};
};

export const writeAgentSessionCache = (userId: string | null | undefined, deviceId: string, connectorId: string, state: AgentSessionState) => {
	const envelope: CachedAgentSession = {
		version: VERSION,
		writtenAt: new Date().toISOString(),
		...cacheableAgentSession(state)
	};
	writeLocalCache(agentSessionCacheKey(userId, deviceId, connectorId, state.sessionId), envelope);
};
