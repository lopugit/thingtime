/** Safe wire contract. Diagnostics deliberately have no free-form text fields. */
export const DEVICE_DIAGNOSTIC_REQUIREMENTS = { 'api.devices-diagnostics': '1.0.0', 'api.devices-node-diagnostics': '1.0.0' } as const;
export const DIAGNOSTIC_LEVELS = ['info', 'warning', 'error'] as const;
export const DIAGNOSTIC_CATEGORIES = ['lifecycle', 'sync', 'upload', 'index', 'network', 'storage', 'permission'] as const;
export const DIAGNOSTIC_CODES = ['sync.snapshot', 'sync.started', 'sync.waiting', 'sync.failed', 'sync.completed',
    'background.request', 'background.ended', 'transport.failed', 'app.started', 'app.foreground', 'app.background'] as const;
export const DIAGNOSTIC_STATES = ['running', 'waiting', 'failed', 'paused', 'complete', 'idle'] as const;
export const DIAGNOSTIC_PHASES = ['verifying', 'indexing', 'checking-originals', 'downloading', 'checking-cloud', 'uploading', 'publishing', 'waiting', 'complete'] as const;
export const DIAGNOSTIC_REASONS = ['interrupted', 'library-changed', 'photo-access', 'device-storage', 'photo-read', 'cloud-request',
    'saved-settings', 'destination-review', 'retry', 'transfer-permission', 'transfer-expired', 'transfer-missing', 'transfer-state', 'grant-changed', 'queue-changed'] as const;
export const DIAGNOSTIC_OPERATIONS = ['observe-photo-index', 'manifest', 'check-photo-run', 'reserve-photo-original', 'parts', 'complete', 'publish', 'revoke', 'revoke-photo-run', 'local-grant', 'queue'] as const;
export const DIAGNOSTIC_RETRY_SOURCES = ['automaticCheck', 'systemInterruption', 'conditions', 'budget', 'transferBackoff'] as const;
export const DIAGNOSTIC_COUNT_FIELDS = ['inspectedAssets', 'indexedResources', 'pendingOriginals', 'unavailableOriginals', 'uploadedFiles', 'uploadedBytes', 'totalBytes'] as const;
type Member<T extends readonly string[]> = T[number];
export type DeviceDiagnosticInput = {
    eventId: string; occurredAt: string; category: Member<typeof DIAGNOSTIC_CATEGORIES>; level: Member<typeof DIAGNOSTIC_LEVELS>;
    code: Member<typeof DIAGNOSTIC_CODES>; state: Member<typeof DIAGNOSTIC_STATES>;
    configurationId?: string; runKey?: string; phase?: Member<typeof DIAGNOSTIC_PHASES>; reason?: Member<typeof DIAGNOSTIC_REASONS>;
    failureOperation?: Member<typeof DIAGNOSTIC_OPERATIONS>; retrySource?: Member<typeof DIAGNOSTIC_RETRY_SOURCES>; retryAt?: string;
    counts?: Partial<Record<Member<typeof DIAGNOSTIC_COUNT_FIELDS>, number>>;
    runtime?: { platform: 'ios' | 'macos' | 'web'; appVersion?: string; build?: string; osVersion?: string };
    background?: { request?: 'active' | 'declined' | 'waiting' | 'complete';
        outcome?: 'unregistered' | 'busy' | 'cancelled' | 'submitted' | 'declined' | 'launch-timeout' | 'active' | 'expired' | 'completed' | 'failed';
        cause?: 'system-ended' | 'execution-expired' | 'worker-cancelled' | 'worker-failed' | 'completed' | 'checkpointed-wait';
        measuredUnits?: number; lastProgressAt?: string; applicationState?: 'active' | 'inactive' | 'background' };
    systemError?: { domain: 'BGTaskSchedulerErrorDomain' | 'NSURLErrorDomain' | 'NSCocoaErrorDomain' | 'PHPhotosErrorDomain'; code: number };
};
export type DeviceDiagnostic = DeviceDiagnosticInput & { id: string; deviceId: string; receivedAt: string };
export type DeviceDiagnosticsPage = { ok: true; folder: { id: string; name: string; hidden: true } | null;
    settings: { enabled: boolean }; events: DeviceDiagnostic[]; nextCursor: string | null; throughSequence: number };
export const diagnosticId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: readonly string[]) => Object.keys(value).every(key => allowed.includes(key));
const member = (value: unknown, allowed: readonly string[]) => typeof value === 'string' && allowed.includes(value);
const date = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const natural = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
export function normalizeDeviceDiagnostic(value: unknown, now = Date.now()): DeviceDiagnosticInput | null {
    if (!object(value) || !keys(value, ['eventId', 'occurredAt', 'category', 'level', 'code', 'state', 'configurationId', 'runKey', 'phase', 'reason', 'failureOperation', 'retrySource', 'retryAt', 'counts', 'runtime', 'background', 'systemError'])) return null;
    if (typeof value.eventId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value.eventId) ||
        !date(value.occurredAt) || Date.parse(value.occurredAt) > now + 60_000 || !member(value.category, DIAGNOSTIC_CATEGORIES) ||
        !member(value.level, DIAGNOSTIC_LEVELS) || !member(value.code, DIAGNOSTIC_CODES) || !member(value.state, DIAGNOSTIC_STATES)) return null;
    if (value.configurationId !== undefined && !diagnosticId(value.configurationId)) return null;
    if (value.runKey !== undefined && (typeof value.runKey !== 'string' || !/^[a-f0-9]{64}$/.test(value.runKey))) return null;
    for (const [key, allowed] of [['phase', DIAGNOSTIC_PHASES], ['reason', DIAGNOSTIC_REASONS], ['failureOperation', DIAGNOSTIC_OPERATIONS], ['retrySource', DIAGNOSTIC_RETRY_SOURCES]] as const)
        if (value[key] !== undefined && !member(value[key], allowed)) return null;
    if (value.retryAt !== undefined && !date(value.retryAt)) return null;
    if (value.counts !== undefined && (!object(value.counts) || !keys(value.counts, DIAGNOSTIC_COUNT_FIELDS) || !Object.values(value.counts).every(natural))) return null;
    if (value.runtime !== undefined) {
        if (!object(value.runtime) || !keys(value.runtime, ['platform', 'appVersion', 'build', 'osVersion']) || !member(value.runtime.platform, ['ios', 'macos', 'web'])) return null;
        for (const key of ['appVersion', 'osVersion']) if (value.runtime[key] !== undefined && (typeof value.runtime[key] !== 'string' || !/^\d{1,6}(?:\.\d{1,6}){0,3}$/.test(value.runtime[key] as string))) return null;
        if (value.runtime.build !== undefined && (typeof value.runtime.build !== 'string' || !/^\d{1,12}$/.test(value.runtime.build))) return null;
    }
    if (value.background !== undefined) {
        const b = value.background;
        if (!object(b) || !keys(b, ['request', 'outcome', 'cause', 'measuredUnits', 'lastProgressAt', 'applicationState'])) return null;
        if (b.request !== undefined && !member(b.request, ['active', 'declined', 'waiting', 'complete'])) return null;
        if (b.outcome !== undefined && !member(b.outcome, ['unregistered', 'busy', 'cancelled', 'submitted', 'declined', 'launch-timeout', 'active', 'expired', 'completed', 'failed'])) return null;
        if (b.cause !== undefined && !member(b.cause, ['system-ended', 'execution-expired', 'worker-cancelled', 'worker-failed', 'completed', 'checkpointed-wait'])) return null;
        if (b.measuredUnits !== undefined && !natural(b.measuredUnits)) return null;
        if (b.lastProgressAt !== undefined && !date(b.lastProgressAt)) return null;
        if (b.applicationState !== undefined && !member(b.applicationState, ['active', 'inactive', 'background'])) return null;
    }
    if (value.systemError !== undefined && (!object(value.systemError) || !keys(value.systemError, ['domain', 'code']) ||
        !member(value.systemError.domain, ['BGTaskSchedulerErrorDomain', 'NSURLErrorDomain', 'NSCocoaErrorDomain', 'PHPhotosErrorDomain']) || !Number.isSafeInteger(value.systemError.code))) return null;
    return value as DeviceDiagnosticInput;
}
