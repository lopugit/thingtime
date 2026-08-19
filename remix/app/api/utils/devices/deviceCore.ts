import { createHash } from 'node:crypto';

export const DEVICE_COMMAND_KINDS = [
	'connector.start',
	'connector.stop',
	'session.list',
	'session.read',
	'session.create',
	'session.send',
	'session.interrupt',
	'approval.respond',
	'app.focus',
	'app.launch',
	'app.quit',
	'system.volume.set',
	'system.brightness.set',
	'system.lock',
	'screen.start',
	'screen.stop'
] as const;

export type DeviceCommandKind = (typeof DEVICE_COMMAND_KINDS)[number];

export const DEVICE_COMMANDS_REQUIRING_APPROVAL = [
	'app.focus',
	'app.launch',
	'app.quit',
	'system.volume.set',
	'system.brightness.set',
	'system.lock',
	'screen.start',
	'screen.stop'
] as const satisfies readonly DeviceCommandKind[];

const COMMANDS_REQUIRING_APPROVAL = new Set<DeviceCommandKind>(DEVICE_COMMANDS_REQUIRING_APPROVAL);

export const DEVICE_CONNECTOR_MUTATING_COMMANDS = [
	'connector.start',
	'connector.stop',
	// Semantic Accessibility may have to select a visible chat before reading.
	// Treat that read as an approval-gated UI action while native Codex reads
	// remain approval-free through connector-specific policy below.
	'session.read',
	'session.create',
	'session.send',
	'session.interrupt',
	'approval.respond'
] as const satisfies readonly DeviceCommandKind[];

export const DEVICE_SEMANTIC_AX_CONNECTOR_KINDS = ['chatgpt-desktop', 'claude-desktop', 'claude-thingtime'] as const;

const CONNECTOR_MUTATING_COMMANDS = new Set<DeviceCommandKind>(DEVICE_CONNECTOR_MUTATING_COMMANDS);
const SEMANTIC_AX_CONNECTOR_KINDS = new Set<string>(DEVICE_SEMANTIC_AX_CONNECTOR_KINDS);

export const deviceCommandRequiresApproval = (kind: DeviceCommandKind, callerRequiresApproval: boolean): boolean =>
	callerRequiresApproval || COMMANDS_REQUIRING_APPROVAL.has(kind);

export const deviceConnectorCommandRequiresApproval = (
	kind: DeviceCommandKind,
	callerRequiresApproval: boolean,
	connector: Pick<DeviceConnectorSnapshot, 'kind' | 'capabilities'> | null
): boolean => {
	if (deviceCommandRequiresApproval(kind, callerRequiresApproval)) return true;
	if (!connector || !CONNECTOR_MUTATING_COMMANDS.has(kind)) return false;
	return hasConnectorCapability(connector, 'explicit-approval') || SEMANTIC_AX_CONNECTOR_KINDS.has(connector.kind.trim().toLowerCase());
};

export const DEVICE_COMMAND_STATUSES = [
	'queued',
	'claimed',
	'running',
	'needs-approval',
	'succeeded',
	'failed',
	'cancelled',
	'needs-review'
] as const;

export type DeviceCommandStatus = (typeof DEVICE_COMMAND_STATUSES)[number];

export const DEVICE_COMMAND_APPROVAL_STATES = ['not-required', 'pending', 'approved', 'denied'] as const;
export type DeviceCommandApprovalState = (typeof DEVICE_COMMAND_APPROVAL_STATES)[number];

export const DEVICE_APPROVAL_STATUSES = ['pending', 'approved', 'denied', 'expired'] as const;
export type DeviceApprovalStatus = (typeof DEVICE_APPROVAL_STATUSES)[number];

export const DEVICE_SCREEN_STATUSES = ['requested', 'awaiting-local-approval', 'connecting', 'active', 'ended', 'failed'] as const;
export type DeviceScreenStatus = (typeof DEVICE_SCREEN_STATUSES)[number];

export type DeviceFail = { ok: false; status: number; error: string };
export const deviceFail = (status: number, error: string): DeviceFail => ({ ok: false, status, error });

const bounded = (value: unknown, max: number): string => (typeof value === 'string' ? value.trim().slice(0, max) : '');

const normalizedScalar = (value: unknown): string | number | boolean | null => {
	if (value === null) return null;
	if (typeof value === 'boolean') return value;
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	return typeof value === 'string' ? value : null;
};

const stableValue = (value: unknown, depth = 0): unknown => {
	if (depth > 10) return null;
	if (Array.isArray(value)) return value.map((entry) => stableValue(entry, depth + 1));
	if (value && typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const key of Object.keys(value as Record<string, unknown>).sort()) {
			out[key] = stableValue((value as Record<string, unknown>)[key], depth + 1);
		}
		return out;
	}
	return normalizedScalar(value);
};

export const stableDeviceJson = (value: unknown): string => JSON.stringify(stableValue(value));

export const deviceHash = (namespace: string, ...parts: string[]): string => {
	const hash = createHash('sha256').update(`thingtime-device:${namespace}:v1`);
	for (const part of parts) hash.update('\0').update(part);
	return hash.digest('hex');
};

export const devicePayloadHash = (value: unknown): string => createHash('sha256').update(stableDeviceJson(value)).digest('hex');

export type DeviceDescriptor = {
	name: string;
	platform: 'macos' | 'windows' | 'linux';
	model: string | null;
	osVersion: string | null;
	appVersion: string | null;
};

export const normalizeDeviceDescriptor = (value: unknown): DeviceDescriptor | null => {
	if (!value || typeof value !== 'object') return null;
	const raw = value as Record<string, unknown>;
	if (!Object.keys(raw).every((key) => ['name', 'platform', 'model', 'osVersion', 'appVersion'].includes(key))) return null;
	const name = bounded(raw.name, 120);
	const platform = raw.platform === 'macos' || raw.platform === 'windows' || raw.platform === 'linux' ? raw.platform : null;
	if (!name || !platform) return null;
	return {
		name,
		platform,
		model: bounded(raw.model, 160) || null,
		osVersion: bounded(raw.osVersion, 80) || null,
		appVersion: bounded(raw.appVersion, 80) || null
	};
};

export type DeviceOpenApp = { id: string; name: string; frontmost: boolean };
export const MAX_DEVICE_OPEN_APPS = 64;
export type DeviceStateSnapshot = {
	locked: boolean;
	volume: number | null;
	brightness: number | null;
	battery: { level: number; charging: boolean } | null;
	openApps: DeviceOpenApp[];
};

const unitInterval = (value: unknown): number | null => {
	const number = Number(value);
	return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : null;
};

export const normalizeDeviceState = (value: unknown): DeviceStateSnapshot | null => {
	if (!value || typeof value !== 'object') return null;
	const raw = value as Record<string, unknown>;
	if (typeof raw.locked !== 'boolean') return null;
	if (!Object.keys(raw).every((key) => ['locked', 'volume', 'brightness', 'battery', 'openApps'].includes(key))) return null;
	const appsRaw = raw.openApps === undefined ? [] : raw.openApps;
	if (!Array.isArray(appsRaw) || appsRaw.length > MAX_DEVICE_OPEN_APPS) return null;
	const openApps: DeviceOpenApp[] = [];
	for (const entry of appsRaw) {
		if (!entry || typeof entry !== 'object') return null;
		const app = entry as Record<string, unknown>;
		if (!Object.keys(app).every((key) => ['id', 'name', 'frontmost'].includes(key))) return null;
		const id = bounded(app.id, 160);
		const name = bounded(app.name, 120);
		if (!id || !name) return null;
		openApps.push({ id, name, frontmost: app.frontmost === true });
	}
	let battery: DeviceStateSnapshot['battery'] = null;
	if (raw.battery !== undefined && raw.battery !== null) {
		if (!raw.battery || typeof raw.battery !== 'object') return null;
		const candidate = raw.battery as Record<string, unknown>;
		if (!Object.keys(candidate).every((key) => ['level', 'charging'].includes(key))) return null;
		const level = unitInterval(candidate.level);
		if (level === null || typeof candidate.charging !== 'boolean') return null;
		battery = { level, charging: candidate.charging };
	}
	const volume = raw.volume === undefined || raw.volume === null ? null : unitInterval(raw.volume);
	const brightness = raw.brightness === undefined || raw.brightness === null ? null : unitInterval(raw.brightness);
	if (raw.volume !== undefined && raw.volume !== null && volume === null) return null;
	if (raw.brightness !== undefined && raw.brightness !== null && brightness === null) return null;
	return {
		locked: raw.locked,
		volume,
		brightness,
		battery,
		openApps
	};
};

export type DeviceConnectorSnapshot = {
	id: string;
	kind: string;
	label: string;
	status: 'connected' | 'disconnected' | 'degraded' | 'needs-permission';
	capabilities: string[];
	projects: DeviceConnectorProjectReference[];
};

export const DEVICE_CONNECTOR_CAPABILITIES = [
	'read-history',
	'create-session',
	'send-message',
	'steer-turn',
	'interrupt-turn',
	'review-approval',
	'accessibility',
	'explicit-approval'
] as const;

export type DeviceConnectorCapability = (typeof DEVICE_CONNECTOR_CAPABILITIES)[number];

const DEVICE_CONNECTOR_CAPABILITY_SET = new Set<string>(DEVICE_CONNECTOR_CAPABILITIES);
const DEVICE_CONNECTOR_CAPABILITY_ALIASES: Readonly<Record<string, DeviceConnectorCapability>> = {
	'session.list': 'read-history',
	'session.read': 'read-history',
	'ai.session.read': 'read-history',
	'session.create': 'create-session',
	'ai.session.create': 'create-session',
	'session.send': 'send-message',
	'ai.session.message': 'send-message',
	'session.steer': 'steer-turn',
	'ai.session.steer': 'steer-turn',
	'session.interrupt': 'interrupt-turn',
	'ai.session.interrupt': 'interrupt-turn',
	'approval.respond': 'review-approval',
	'approvals.respond': 'review-approval'
};

export const normalizeDeviceConnectorCapability = (value: unknown): DeviceConnectorCapability | null => {
	if (typeof value !== 'string') return null;
	const normalized = value.trim().toLowerCase();
	if (!normalized || normalized.length > 100 || !/^[a-z][a-z0-9.-]*$/u.test(normalized)) return null;
	const aliased = DEVICE_CONNECTOR_CAPABILITY_ALIASES[normalized];
	if (aliased) return aliased;
	return DEVICE_CONNECTOR_CAPABILITY_SET.has(normalized) ? (normalized as DeviceConnectorCapability) : null;
};

export const MAX_DEVICE_CONNECTOR_PROJECTS = 128;

export type DeviceConnectorProjectReference = {
	projectId: string;
	projectLabel: string;
};

const normalizeDeviceConnectorProjects = (value: unknown): DeviceConnectorProjectReference[] | null => {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.length > MAX_DEVICE_CONNECTOR_PROJECTS) return null;
	const projects: DeviceConnectorProjectReference[] = [];
	const ids = new Set<string>();
	for (const entry of value) {
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
		const raw = entry as Record<string, unknown>;
		if (!Object.keys(raw).every((key) => key === 'projectId' || key === 'projectLabel')) return null;
		if (typeof raw.projectId !== 'string' || typeof raw.projectLabel !== 'string') return null;
		const projectId = raw.projectId;
		const projectLabel = raw.projectLabel;
		if (
			projectId !== projectId.trim() ||
			!projectId ||
			Array.from(projectId).length > 128 ||
			!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(projectId) ||
			ids.has(projectId) ||
			projectLabel !== projectLabel.trim() ||
			!projectLabel ||
			Array.from(projectLabel).length > 120 ||
			/[\\/\p{Cc}\p{Cf}]/u.test(projectLabel)
		)
			return null;
		ids.add(projectId);
		projects.push({ projectId, projectLabel });
	}
	return projects;
};

export const normalizeDeviceConnectors = (value: unknown): DeviceConnectorSnapshot[] | null => {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.length > 32) return null;
	const out: DeviceConnectorSnapshot[] = [];
	const ids = new Set<string>();
	for (const entry of value) {
		if (!entry || typeof entry !== 'object') return null;
		const raw = entry as Record<string, unknown>;
		if (!Object.keys(raw).every((key) => ['id', 'kind', 'label', 'status', 'capabilities', 'projects'].includes(key))) return null;
		const id = bounded(raw.id, 120);
		const kind = bounded(raw.kind, 80);
		const label = bounded(raw.label, 120);
		const status =
			raw.status === 'connected' || raw.status === 'disconnected' || raw.status === 'degraded' || raw.status === 'needs-permission'
				? raw.status
				: null;
		if (!id || ids.has(id) || !kind || !label || !status) return null;
		if (!Array.isArray(raw.capabilities) || raw.capabilities.length > 32) return null;
		const projects = normalizeDeviceConnectorProjects(raw.projects);
		if (!projects) return null;
		const capabilities: string[] = [];
		for (const capability of raw.capabilities) {
			const normalized = normalizeDeviceConnectorCapability(capability);
			if (!normalized) return null;
			if (!capabilities.includes(normalized)) capabilities.push(normalized);
		}
		capabilities.sort();
		ids.add(id);
		out.push({ id, kind, label, status, capabilities, projects });
	}
	return out;
};

const FORBIDDEN_PERSISTED_KEYS = new Set(['sdp', 'ice', 'candidate', 'frame', 'frames', 'imageData', 'rawFrame', 'pixels', 'audioData']);

const sanitizeJsonValue = (value: unknown, depth = 0): unknown | undefined => {
	if (depth > 8) return undefined;
	if (value === null || typeof value === 'boolean') return value;
	if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
	if (typeof value === 'string') return value.length <= 16_000 ? value : undefined;
	if (Array.isArray(value)) {
		if (value.length > 100) return undefined;
		const out: unknown[] = [];
		for (const entry of value) {
			const sanitized = sanitizeJsonValue(entry, depth + 1);
			if (sanitized === undefined) return undefined;
			out.push(sanitized);
		}
		return out;
	}
	if (value && typeof value === 'object') {
		const keys = Object.keys(value as Record<string, unknown>);
		if (keys.length > 100) return undefined;
		const out: Record<string, unknown> = {};
		for (const key of keys) {
			if (!key || key.length > 100 || key.startsWith('$') || key.includes('.') || FORBIDDEN_PERSISTED_KEYS.has(key)) {
				return undefined;
			}
			const sanitized = sanitizeJsonValue((value as Record<string, unknown>)[key], depth + 1);
			if (sanitized === undefined) return undefined;
			out[key] = sanitized;
		}
		return out;
	}
	return undefined;
};

export const normalizeCommandInput = (value: unknown): { ok: true; input: Record<string, unknown> } | DeviceFail => {
	const sanitized = sanitizeJsonValue(value ?? {});
	if (!sanitized || typeof sanitized !== 'object' || Array.isArray(sanitized)) {
		return deviceFail(400, 'input must be a bounded JSON object');
	}
	if (Buffer.byteLength(JSON.stringify(sanitized), 'utf8') > 64 * 1024) {
		return deviceFail(413, 'Command input is too large');
	}
	return { ok: true, input: sanitized as Record<string, unknown> };
};

export const normalizeCommandKind = (value: unknown): DeviceCommandKind | null =>
	typeof value === 'string' && (DEVICE_COMMAND_KINDS as readonly string[]).includes(value) ? (value as DeviceCommandKind) : null;

type ConnectorInput = { connectorId: string };
type CursorPageInput = { cursor?: string; limit?: number };

export type DeviceCommandInputByKind = {
	'connector.start': ConnectorInput;
	'connector.stop': ConnectorInput;
	'session.list': ConnectorInput & CursorPageInput & { projectId?: string; search?: string };
	'session.read': ConnectorInput & CursorPageInput & { sessionId: string };
	'session.create': ConnectorInput & { projectId?: string; title?: string };
	'session.send':
		| (ConnectorInput & { sessionId: string; text: string; delivery: 'queue' })
		| (ConnectorInput & { sessionId: string; text: string; delivery: 'steer'; expectedTurnId: string });
	'session.interrupt': ConnectorInput & { sessionId: string; turnId: string };
	'approval.respond': ConnectorInput & { approvalId: string; decision: 'approved' | 'denied' };
	'app.focus': { appId: string };
	'app.launch': { appId: string };
	'app.quit': { appId: string };
	'system.volume.set': { level: number };
	'system.brightness.set': { level: number };
	'system.lock': Record<string, never>;
	'screen.start': { screenSessionId: string; viewOnly: boolean };
	'screen.stop': { screenSessionId: string };
};

export type DeviceCommandEnvelope = {
	[K in DeviceCommandKind]: { kind: K; input: DeviceCommandInputByKind[K] };
}[DeviceCommandKind];

const hasConnectorCapability = (
	connector: Pick<DeviceConnectorSnapshot, 'capabilities'>,
	...ids: readonly DeviceConnectorCapability[]
): boolean =>
	connector.capabilities.some((capability) => {
		const normalized = normalizeDeviceConnectorCapability(capability);
		return normalized !== null && ids.includes(normalized);
	});

/**
 * The current connector snapshot is authoritative for session operations.
 * Lifecycle start/stop is intentionally exempt: a stopped connector cannot
 * advertise a live capability, and its persisted identity is the authority.
 */
export const deviceConnectorSupportsCommand = (
	kind: DeviceCommandKind,
	input: DeviceCommandInputByKind[DeviceCommandKind],
	connector: Pick<DeviceConnectorSnapshot, 'capabilities'>
): boolean => {
	switch (kind) {
		case 'connector.start':
		case 'connector.stop':
			return true;
		case 'session.list':
		case 'session.read':
			return hasConnectorCapability(connector, 'read-history');
		case 'session.create':
			return hasConnectorCapability(connector, 'create-session');
		case 'session.send': {
			const delivery = (input as DeviceCommandInputByKind['session.send']).delivery;
			const canSend = hasConnectorCapability(connector, 'send-message');
			return canSend && (delivery !== 'steer' || hasConnectorCapability(connector, 'steer-turn'));
		}
		case 'session.interrupt':
			return hasConnectorCapability(connector, 'interrupt-turn');
		case 'approval.respond':
			return hasConnectorCapability(connector, 'review-approval');
		default:
			return true;
	}
};

const DEVICE_COMMAND_CAPABILITY: Partial<Record<DeviceCommandKind, string>> = {
	'app.focus': 'apps.launch',
	'app.launch': 'apps.launch',
	'app.quit': 'apps.quit',
	'system.volume.set': 'system.volume.write',
	'system.brightness.set': 'system.brightness.write',
	'system.lock': 'system.lock',
	'screen.start': 'screen.view',
	'screen.stop': 'screen.view'
};

const DEVICE_CAPABILITY_ALIASES: Readonly<Record<string, string>> = {
	'app.focus': 'apps.launch',
	'app.launch': 'apps.launch',
	'application.activate': 'apps.launch',
	'application.launch': 'apps.launch',
	'app.quit': 'apps.quit',
	'application.quit': 'apps.quit',
	'system.volume.set': 'system.volume.write',
	'system.brightness.set': 'system.brightness.write',
	'device.lock.write': 'system.lock',
	'screen.start': 'screen.view',
	'screen.stop': 'screen.view'
};

/**
 * A paired device's signed claim is authoritative for device-wide effects.
 * Connector-scoped commands are checked against the current connector
 * snapshot separately; this function closes direct API calls that otherwise
 * could enqueue an effect the paired node never advertised.
 */
export const deviceSupportsCommand = (kind: DeviceCommandKind, capabilities: unknown): boolean => {
	const required = DEVICE_COMMAND_CAPABILITY[kind];
	if (!required) return true;
	if (!Array.isArray(capabilities)) return false;
	return capabilities.some((value) => {
		if (typeof value !== 'string') return false;
		const normalized = value.trim().toLowerCase();
		return (DEVICE_CAPABILITY_ALIASES[normalized] || normalized) === required;
	});
};

const opaqueId = (value: unknown, max = 200): string | null => {
	const id = bounded(value, max);
	return id && !/[\s/\\\p{Cc}\p{Cf}]/u.test(id) ? id : null;
};

const opaqueCursor = (value: unknown): string | null => {
	if (typeof value !== 'string' || !value || value !== value.trim() || Array.from(value).length > 2_048) return null;
	return /[\p{Cc}\p{Cf}]/u.test(value) ? null : value;
};

const commandMessageText = (value: unknown): string | null => {
	if (typeof value !== 'string' || !value.trim() || Array.from(value).length > 32_000) return null;
	return Array.from(value).some((character) => {
		const code = character.codePointAt(0) ?? 0;
		return (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127;
	})
		? null
		: value;
};

const exactKeys = (raw: Record<string, unknown>, allowed: readonly string[]): boolean => Object.keys(raw).every((key) => allowed.includes(key));

const optionalPage = (raw: Record<string, unknown>): { ok: true; page: CursorPageInput } | DeviceFail => {
	const page: CursorPageInput = {};
	if (raw.cursor !== undefined) {
		const cursor = opaqueCursor(raw.cursor);
		if (!cursor) return deviceFail(400, 'cursor must be a bounded opaque identifier');
		page.cursor = cursor;
	}
	if (raw.limit !== undefined) {
		const limit = Number(raw.limit);
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) return deviceFail(400, 'limit must be an integer from 1 to 100');
		page.limit = limit;
	}
	return { ok: true, page };
};

export const normalizeDeviceCommand = <K extends DeviceCommandKind>(
	kind: K,
	value: unknown
): { ok: true; input: DeviceCommandInputByKind[K] } | DeviceFail => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return deviceFail(400, 'input must be an object');
	const raw = value as Record<string, unknown>;
	const connector = () => opaqueId(raw.connectorId, 120);
	const session = () => opaqueId(raw.sessionId, 512);
	const app = () => opaqueId(raw.appId, 200);
	const screen = () => opaqueId(raw.screenSessionId, 160);
	const ok = (input: unknown) => ({ ok: true as const, input: input as DeviceCommandInputByKind[K] });

	switch (kind) {
		case 'connector.start':
		case 'connector.stop': {
			const connectorId = connector();
			return connectorId && exactKeys(raw, ['connectorId']) ? ok({ connectorId }) : deviceFail(400, `${kind} requires only connectorId`);
		}
		case 'session.list': {
			const connectorId = connector();
			const page = optionalPage(raw);
			if (!connectorId) return deviceFail(400, 'session.list requires connectorId');
			if (page.ok === false) return page;
			if (!exactKeys(raw, ['connectorId', 'projectId', 'search', 'cursor', 'limit']))
				return deviceFail(400, 'session.list input contains an unknown field');
			const projectId = raw.projectId === undefined ? undefined : opaqueId(raw.projectId, 512);
			const search = raw.search === undefined ? undefined : bounded(raw.search, 200);
			if (raw.projectId !== undefined && !projectId) return deviceFail(400, 'projectId must be a bounded opaque identifier');
			if (raw.search !== undefined && !search) return deviceFail(400, 'search must be a bounded non-empty string');
			return ok({ connectorId, ...(projectId ? { projectId } : {}), ...(search ? { search } : {}), ...page.page });
		}
		case 'session.read': {
			const connectorId = connector();
			const sessionId = session();
			const page = optionalPage(raw);
			if (!connectorId || !sessionId) return deviceFail(400, 'session.read requires connectorId and sessionId');
			if (page.ok === false) return page;
			if (!exactKeys(raw, ['connectorId', 'sessionId', 'cursor', 'limit'])) return deviceFail(400, 'session.read input contains an unknown field');
			return ok({ connectorId, sessionId, ...page.page });
		}
		case 'session.create': {
			const connectorId = connector();
			const projectId = raw.projectId === undefined ? undefined : opaqueId(raw.projectId, 512);
			const title = raw.title === undefined ? undefined : bounded(raw.title, 200);
			if (!connectorId || !exactKeys(raw, ['connectorId', 'projectId', 'title'])) return deviceFail(400, 'session.create input is invalid');
			if (raw.projectId !== undefined && !projectId) return deviceFail(400, 'projectId must be a bounded opaque identifier');
			if (raw.title !== undefined && !title) return deviceFail(400, 'title must be a bounded non-empty string');
			return ok({ connectorId, ...(projectId ? { projectId } : {}), ...(title ? { title } : {}) });
		}
		case 'session.send': {
			const connectorId = connector();
			const sessionId = session();
			const text = commandMessageText(raw.text);
			if (!connectorId || !sessionId || !text) return deviceFail(400, 'session.send requires connectorId, sessionId and bounded text');
			if (raw.delivery === 'queue') {
				return exactKeys(raw, ['connectorId', 'sessionId', 'text', 'delivery'])
					? ok({ connectorId, sessionId, text, delivery: 'queue' })
					: deviceFail(400, 'queued session.send input contains an unknown field');
			}
			if (raw.delivery === 'steer') {
				const expectedTurnId = opaqueId(raw.expectedTurnId, 512);
				return expectedTurnId && exactKeys(raw, ['connectorId', 'sessionId', 'text', 'delivery', 'expectedTurnId'])
					? ok({ connectorId, sessionId, text, delivery: 'steer', expectedTurnId })
					: deviceFail(400, 'steered session.send requires expectedTurnId and no unknown fields');
			}
			return deviceFail(400, 'session.send delivery must be queue or steer');
		}
		case 'session.interrupt': {
			const connectorId = connector();
			const sessionId = session();
			const turnId = opaqueId(raw.turnId, 512);
			return connectorId && sessionId && turnId && exactKeys(raw, ['connectorId', 'sessionId', 'turnId'])
				? ok({ connectorId, sessionId, turnId })
				: deviceFail(400, 'session.interrupt requires connectorId, sessionId and turnId');
		}
		case 'approval.respond': {
			const connectorId = connector();
			const approvalId = opaqueId(raw.approvalId, 512);
			const decision = raw.decision === 'approved' || raw.decision === 'denied' ? raw.decision : null;
			return connectorId && approvalId && decision && exactKeys(raw, ['connectorId', 'approvalId', 'decision'])
				? ok({ connectorId, approvalId, decision })
				: deviceFail(400, 'approval.respond requires connectorId, approvalId and an approved/denied decision');
		}
		case 'app.focus':
		case 'app.launch':
		case 'app.quit': {
			const appId = app();
			return appId && exactKeys(raw, ['appId']) ? ok({ appId }) : deviceFail(400, `${kind} requires only a stable appId`);
		}
		case 'system.volume.set':
		case 'system.brightness.set': {
			const level = Number(raw.level);
			return Number.isFinite(level) && level >= 0 && level <= 1 && exactKeys(raw, ['level'])
				? ok({ level })
				: deviceFail(400, `${kind} requires only level from 0 to 1`);
		}
		case 'system.lock':
			return exactKeys(raw, []) ? ok({}) : deviceFail(400, 'system.lock accepts no input fields');
		case 'screen.start': {
			const screenSessionId = screen();
			return screenSessionId && typeof raw.viewOnly === 'boolean' && exactKeys(raw, ['screenSessionId', 'viewOnly'])
				? ok({ screenSessionId, viewOnly: raw.viewOnly })
				: deviceFail(400, 'screen.start requires screenSessionId and viewOnly only');
		}
		case 'screen.stop': {
			const screenSessionId = screen();
			return screenSessionId && exactKeys(raw, ['screenSessionId'])
				? ok({ screenSessionId })
				: deviceFail(400, 'screen.stop requires only screenSessionId');
		}
	}
};

export const normalizeRequestId = (value: unknown): string | null => {
	const id = bounded(value, 160);
	return id && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id) ? id : null;
};

const TRANSITIONS: Record<DeviceCommandStatus, readonly DeviceCommandStatus[]> = {
	queued: ['claimed', 'cancelled'],
	claimed: ['running', 'needs-approval', 'succeeded', 'failed', 'cancelled', 'needs-review'],
	running: ['needs-approval', 'succeeded', 'failed', 'cancelled', 'needs-review'],
	'needs-approval': ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'needs-review'],
	succeeded: [],
	failed: [],
	cancelled: [],
	'needs-review': []
};

export const canTransitionDeviceCommand = (from: DeviceCommandStatus, to: DeviceCommandStatus): boolean => TRANSITIONS[from].includes(to);

export const canLeaseDeviceCommand = (requiresApproval: boolean, approvalState: DeviceCommandApprovalState): boolean =>
	!requiresApproval || approvalState === 'approved';

export type RevisionDecision = 'insert' | 'update' | 'same' | 'stale' | 'conflict';
export const decideDeviceRevision = (
	existingRevision: number | null,
	existingHash: string | null,
	incomingRevision: number,
	incomingHash: string
): RevisionDecision => {
	if (existingRevision === null) return 'insert';
	if (incomingRevision < existingRevision) return 'stale';
	if (incomingRevision > existingRevision) return 'update';
	return existingHash === incomingHash ? 'same' : 'conflict';
};

export const deviceSnapshotHash = (state: DeviceStateSnapshot, connectors: DeviceConnectorSnapshot[]): string =>
	devicePayloadHash({ state, connectors });

export type DeviceLeaseDecision = 'active' | 'expired' | 'invalid';
export const decideDeviceLease = (storedLeaseHash: unknown, presentedLeaseHash: string, leaseExpiresAt: unknown, now: Date): DeviceLeaseDecision => {
	if (storedLeaseHash !== presentedLeaseHash) return 'invalid';
	const expiresAt = leaseExpiresAt ? new Date(leaseExpiresAt as any) : null;
	return expiresAt && Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() > now.getTime() ? 'active' : 'expired';
};

export const deviceControlEventLogicalBytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8') + 512;

export const retainedDeviceControlEventCount = (newestFirstLogicalBytes: number[], maxCount: number, maxBytes: number): number => {
	if (!Number.isSafeInteger(maxCount) || maxCount < 0 || !Number.isSafeInteger(maxBytes) || maxBytes < 0) {
		throw new RangeError('Device control-event retention bounds must be non-negative safe integers');
	}
	let count = 0;
	let bytes = 0;
	for (const value of newestFirstLogicalBytes) {
		if (!Number.isSafeInteger(value) || value < 0) break;
		if (count >= maxCount || bytes + value > maxBytes) break;
		count += 1;
		bytes += value;
	}
	return count;
};

export type DeviceEventCursor = { at: Date; id: string };

export const encodeDeviceEventCursor = (cursor: DeviceEventCursor): string =>
	Buffer.from(JSON.stringify([cursor.at.toISOString(), cursor.id]), 'utf8').toString('base64url');

export const decodeDeviceEventCursor = (value: unknown): DeviceEventCursor | null => {
	if (typeof value !== 'string' || !value || value.length > 512) return null;
	try {
		const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
		if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== 'string' || typeof parsed[1] !== 'string') return null;
		const at = new Date(parsed[0]);
		return Number.isFinite(at.getTime()) && parsed[1] ? { at, id: parsed[1] } : null;
	} catch {
		return null;
	}
};
