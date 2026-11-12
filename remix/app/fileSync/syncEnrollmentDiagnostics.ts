import { SyncJobConfigurationChanged } from './syncJobFailure';

/** Private fixture instrumentation. Never records identities, settings, errors,
 * paths or bytes; it cannot acquire, cancel or release an enrollment claim. */
export type EnrollmentPhase = 'claimed' | 'create-host' | 'capabilities' | 'read-saved' | 'open-journal' | 'read-job' | 'enroll-local' | 'remote-status' | 'remote-start' | 'persist-finish' | 'host-signal' | 'host-adapter' | 'host-resource-policy' | 'host-device-input' | 'host-device-status' | 'host-device-unpaired' | 'host-device-pending' | 'host-device-revoked' | 'host-device-mismatch' | 'host-ready' | 'recovery-identity' | 'recovery-deadline' | 'recovery-storage' | 'recovery-adapter' | 'recovery-pause';
type Failure = 'aborted' | 'configuration-changed' | 'saved-work-unfinished' | 'saved-revision-conflict' | 'already-active' | 'already-queued' | 'native-lane-busy' | 'other';
function enrollmentFailure(cause: unknown): Failure {
 if (cause instanceof SyncJobConfigurationChanged) return 'configuration-changed';
 if (!(cause instanceof Error)) return 'other';
 const known: Record<string, Failure> = {
  'This sync config has saved work. Wait for the device to finish its current transfer before enabling it again.': 'saved-work-unfinished',
  'This connection changed elsewhere. Your draft is preserved; review the saved version before editing again.': 'saved-revision-conflict',
  'This sync config already has a transfer or approval in progress. Check its current status.': 'already-active',
  'This sync config is already being queued. Check its current status.': 'already-queued',
  'The device is busy. Saved automatic setup will resume when it is free.': 'native-lane-busy'
 };
 return Object.prototype.hasOwnProperty.call(known, cause.message) ? known[cause.message] : 'other';
}
const codes = ['request-aborted', 'scope-changed', 'unsupported-bridge', 'unsupported-presence', 'invalid-response', 'missing-device-identity', 'device-timeout', 'native-refused', 'native-busy', 'native-inactive', 'native-identity', 'native-incompatible', 'native-revoked', 'native-secure-storage', 'native-service-unavailable', 'native-invalid-response', 'device-binding', 'identity-changed', 'deadline', 'storage-changed', 'adapter-changed', 'locally-paused', 'resource-policy', 'input-mismatch', 'host-ready'] as const;
export type EnrollmentFacts = { code?: typeof codes[number]; paired?: boolean; deviceMatches?: boolean; adapterCurrent?: boolean; storageCurrent?: boolean; identityCurrent?: boolean; locallyPaused?: boolean };
function projectFacts(facts: EnrollmentFacts) {
 return { ...(codes.includes(facts.code!) ? { code: facts.code } : {}),
  ...Object.fromEntries(['paired', 'deviceMatches', 'adapterCurrent', 'storageCurrent', 'identityCurrent', 'locallyPaused'].flatMap(key =>
   typeof facts[key as keyof EnrollmentFacts] === 'boolean' ? [[key, facts[key as keyof EnrollmentFacts]]] : [])) } as EnrollmentFacts;
}
export function classifyEnrollmentDeviceFailure(cause: unknown): EnrollmentFacts['code'] {
 if (!(cause instanceof Error)) return 'native-refused';
 if (cause.name === 'AbortError') return 'request-aborted';
 const known: Record<string, EnrollmentFacts['code']> = {
  'Mobile device pairing requires an updated Thingtime app.': 'unsupported-bridge',
  'Background presence requires an updated Thingtime iOS app.': 'unsupported-presence',
  'Invalid native device response': 'invalid-response',
  'Missing native device identity': 'missing-device-identity',
  'The device request timed out. Retry to resume saved pairing.': 'device-timeout',
  'Device request cancelled': 'scope-changed',
  'Reconnect this device before transferring files.': 'device-binding',
  'Another device request is still running. Try again shortly.': 'native-busy',
  'Device connection paused. Retry when the app is active.': 'native-inactive',
  'Your account changed. Reopen Things and try again.': 'native-identity',
  'This destination does not support mobile pairing yet.': 'native-incompatible',
  'This device connection was revoked. Add this device again to reconnect.': 'native-revoked',
  'Device credentials could not be saved securely. Retry when this device is unlocked.': 'native-secure-storage',
  'The device service is unavailable. Your saved pairing can be retried.': 'native-service-unavailable',
  'The device service returned an invalid pairing response.': 'native-invalid-response'
 };
 return Object.prototype.hasOwnProperty.call(known, cause.message) ? known[cause.message] : 'native-refused';
}
type Attempt = { generation: number; kind: 'background' | 'foreground'; phase: EnrollmentPhase; started: number; elapsedMs: number; active: boolean; aborted: boolean; signal?: AbortSignal; failure?: Failure; targetId?: string; facts?: EnrollmentFacts };
export function createEnrollmentDiagnostics(now = () => performance.now()) {
 const history = new Map<string, Attempt[]>();
 let generation = 0;
 return {
  begin(key: string, signal?: AbortSignal, targetId?: string) {
   const attempt: Attempt = { generation: ++generation, kind: signal ? 'background' : 'foreground', phase: 'claimed', started: now(), elapsedMs: 0, active: true, aborted: false, signal, targetId };
   const rows = history.get(key) ?? [];
   history.set(key, [...rows.slice(-7), attempt]);
   return {
    phase(phase: EnrollmentPhase, signal?: AbortSignal, facts?: EnrollmentFacts) { attempt.phase = phase; attempt.facts = facts ? projectFacts(facts) : undefined; if (signal) attempt.signal = signal; },
    failed(cause: unknown) {
     attempt.failure = attempt.signal?.aborted ? 'aborted' : enrollmentFailure(cause);
    },
    release() { if (attempt.active) { attempt.active = false; attempt.elapsedMs = Math.max(0, now() - attempt.started); attempt.aborted = attempt.signal?.aborted === true; } }
   };
  },
  read(key: string, targetId?: string) { return (history.get(key) ?? []).map(row => ({ generation: row.generation, kind: row.kind, phase: row.phase, active: row.active,
   elapsedMs: row.active ? Math.max(0, now() - row.started) : row.elapsedMs, aborted: row.active ? row.signal?.aborted === true : row.aborted,
   ...(targetId ? { targetMatches: row.targetId ? row.targetId === targetId : null } : {}), ...(row.failure ? { failure: row.failure } : {}), ...(row.facts ? { facts: projectFacts(row.facts) } : {}) })); }
 };
}

// Explicit opt-in for task-owned fixture builds only. No HTTP endpoint and no
// default production global. A fresh renderer always starts a fresh history.
export const enrollmentDiagnosticsEnabled = import.meta.env?.VITE_THINGTIME_SYNC_DIAGNOSTICS === '1';
