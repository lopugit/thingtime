import { requireActiveThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { normalizeDeviceDiagnostic, diagnosticId, DEVICE_DIAGNOSTIC_REQUIREMENTS, type DeviceDiagnostic, type DeviceDiagnosticsPage } from '~/devices/deviceDiagnostics';
import { EXPECTED_DATA_PLANE_HEADER, thingHistoryHref } from '~/utils/dataPlane';
import { DeviceDebugScopeError } from '~/utils/deviceDebugScope';

export const DEVICE_DEBUG_REQUIREMENTS = { 'api.devices-diagnostics': DEVICE_DIAGNOSTIC_REQUIREMENTS['api.devices-diagnostics'] } as const;
export type DebugFilters = { deviceId: string; level: string; category: string };
export type DebugEvent = DeviceDiagnostic;
export type DebugPage = Omit<DeviceDiagnosticsPage, 'ok'>;
export type DebugScope = { origin: string; ownerId: string; dataPlane: string | null; isCurrent: () => boolean };
export class DebugReadError extends Error { constructor(public readonly clear: boolean, message: string) { super(message); } }
const countLabels: Record<string, string> = { inspectedAssets: 'assets inspected', indexedResources: 'resources indexed', pendingOriginals: 'originals pending', unavailableOriginals: 'originals unavailable', uploadedFiles: 'files uploaded', uploadedBytes: 'bytes uploaded', totalBytes: 'total bytes' };
const identifier = diagnosticId;
const timestamp = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));

/** Copy the safe public projection only. Never render/export an unknown response
 * field, arbitrary message, URL, source path or native error object. */
export function parseDebugPage(value: unknown): DebugPage {
	const v = value as DebugPage & { ok: boolean };
	if (!v || v.ok !== true || typeof v.settings?.enabled !== 'boolean' || !Array.isArray(v.events) || !Number.isSafeInteger(v.throughSequence) || v.throughSequence < 0 || (v.nextCursor !== null && typeof v.nextCursor !== 'string') ||
		(v.folder !== null && (!identifier(v.folder?.id) || v.folder.name !== 'Debug' || v.folder.hidden !== true))) throw new DebugReadError(false, 'The debug response is incomplete. Refresh to try again.');
	const events = v.events.map(e => {
		if (!e || !identifier(e.id) || !identifier(e.deviceId) || !timestamp(e.receivedAt)) throw new DebugReadError(false, 'A debug event could not be read safely. Refresh to try again.');
		const input = Object.fromEntries(['eventId', 'occurredAt', 'category', 'level', 'code', 'state', 'retryAt', 'configurationId', 'runKey', 'phase', 'reason', 'failureOperation', 'retrySource', 'counts', 'runtime', 'background', 'systemError'].filter(key => Object.prototype.hasOwnProperty.call(e, key)).map(key => [key, e[key as keyof DebugEvent]]));
		const event = normalizeDeviceDiagnostic(input);
		if (!event) throw new DebugReadError(false, 'A debug event could not be read safely. Refresh to try again.');
		return { ...event, id: e.id, deviceId: e.deviceId, receivedAt: e.receivedAt };
	});
	return { folder: v.folder ? { id: v.folder.id, name: 'Debug', hidden: true } : null, settings: { enabled: v.settings.enabled }, throughSequence: v.throughSequence, events, nextCursor: v.nextCursor };
}

export function createDeviceDebugClient(scope: DebugScope, transport: { fetch: typeof fetch; capability: typeof requireActiveThingtimeCapability } | { request: (query: string, body: Record<string, unknown> | undefined, signal: AbortSignal) => Promise<unknown> } = { fetch, capability: requireActiveThingtimeCapability }) {
	const assertCurrent = (signal: AbortSignal) => {
		signal.throwIfAborted();
		if (!scope.isCurrent()) throw new DebugReadError(true, 'Your account or server changed.');
		if (scope.dataPlane !== 'home') throw new DebugReadError(true, 'Switch to your home database to read private device activity.');
	};
	const request = async (signal: AbortSignal, query = '', body?: Record<string, unknown>) => {
		assertCurrent(signal);
		if ('request' in transport) {
			try { const result = await transport.request(query, body, signal); assertCurrent(signal); return result; }
			catch (cause) {
				assertCurrent(signal);
				if (cause instanceof DebugReadError) throw cause;
				if (cause instanceof DeviceDebugScopeError) throw new DebugReadError(true, cause.message);
				const status = (cause as { status?: number })?.status;
				throw new DebugReadError(status === 401 || status === 403, status === 401 || status === 403 ? 'Sign in to the owning account to read private device activity.' : 'Device activity is unavailable. Saved events have been kept. Try again.');
			}
		}
		await transport.capability('api.devices-diagnostics', DEVICE_DEBUG_REQUIREMENTS['api.devices-diagnostics'], scope.origin);
		assertCurrent(signal);
		const response = await transport.fetch(scope.origin + '/api/v1/devices/diagnostics' + query, { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal,
			headers: { 'X-Thingtime-Expected-Actor': scope.ownerId, [EXPECTED_DATA_PLANE_HEADER]: 'home', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
		assertCurrent(signal);
		if (!response.ok) throw new DebugReadError(response.status === 401 || response.status === 403, response.status === 401 || response.status === 403 ? 'Sign in to the owning account to read private device activity.' : 'Device activity is unavailable. Your saved events have been kept. Try again.');
		const result: unknown = await response.json();
		assertCurrent(signal);
		return result;
	};
	return {
		read: async (filters: DebugFilters, signal: AbortSignal, cursor?: string) => {
			const query = new URLSearchParams({ limit: '50', ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)), ...(cursor ? { cursor } : {}) });
			return parseDebugPage(await request(signal, '?' + query));
		},
		ensure: (signal: AbortSignal) => request(signal, '', { action: 'ensure' }),
		setEnabled: (enabled: boolean, signal: AbortSignal) => request(signal, '', { action: 'settings', enabled }),
		clear: async (requestId: string, throughSequence: number, signal: AbortSignal) => {
			const value = await request(signal, '', { action: 'clear', requestId, throughSequence }) as { ok?: boolean; requestId?: string; throughSequence?: number; deleted?: number; hasMore?: boolean };
			if (value.ok !== true || value.requestId !== requestId || value.throughSequence !== throughSequence || !Number.isSafeInteger(value.deleted) || value.deleted! < 0 || typeof value.hasMore !== 'boolean') throw new DebugReadError(false, 'The clear result could not be confirmed.');
			return { deleted: value.deleted!, hasMore: value.hasMore };
		}
	};
}

const codeLabels: Record<DebugEvent['code'], string> = { 'sync.snapshot': 'Sync progress', 'sync.started': 'Sync started', 'sync.waiting': 'Sync is waiting', 'sync.failed': 'Sync failed', 'sync.completed': 'Sync completed', 'background.request': 'Background time requested', 'background.ended': 'Background time ended', 'transport.failed': 'Connection failed', 'app.started': 'App started', 'app.foreground': 'App in foreground', 'app.background': 'App in background' };
export function debugEventDisplay(event: DebugEvent, ownerId: string) {
	const date = (value: string) => new Date(value).toLocaleString();
	return { ...event, title: `${event.level[0].toUpperCase() + event.level.slice(1)} · ${codeLabels[event.code]}`, time: date(event.occurredAt),
		stateLine: `${event.category[0].toUpperCase() + event.category.slice(1)} · ${event.state}`,
		phaseLabel: event.phase || event.category, reasonLabel: event.reason || 'No failure reason reported', operationLabel: event.failureOperation || 'Not reported',
		errorLabel: event.systemError ? `${event.systemError.domain} · ${event.systemError.code}` : 'No system error reported',
		backgroundLabel: event.background ? [event.background.request, event.background.outcome, event.background.cause, event.background.applicationState, event.background.lastProgressAt ? `Last progress ${date(event.background.lastProgressAt)}` : '', event.background.measuredUnits === undefined ? '' : `${event.background.measuredUnits} measured units`].filter(Boolean).join(' · ') : 'Not reported',
		configurationLabel: event.configurationId || 'Not reported', retrySourceLabel: event.retrySource || 'Not reported',
		progress: Object.entries(event.counts || {}).map(([key, n]) => `${n.toLocaleString()} ${countLabels[key]}`).join(' · '),
		runtimeLabel: [event.runtime?.platform, event.runtime?.appVersion ? `App ${event.runtime.appVersion}` : '', event.runtime?.build ? `Build ${event.runtime.build}` : '', event.runtime?.osVersion ? `OS ${event.runtime.osVersion}` : ''].filter(Boolean).join(' · ') || 'Not reported',
		retryLabel: event.retryAt ? date(event.retryAt) : 'No retry time reported', receivedLabel: date(event.receivedAt), href: thingHistoryHref(event.id, 'home', ownerId) };
}

export function mergeDebugEvents(previous: DebugEvent[], next: DebugEvent[]) {
	const seen = new Set<string>();
	return [...previous, ...next].filter(event => !seen.has(event.id) && Boolean(seen.add(event.id)));
}
