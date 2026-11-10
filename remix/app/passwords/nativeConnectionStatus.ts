export type NativePasswordState = 'index-synchronized' | 'linked-index-pending' | 'disconnected' | 'unknown';
export type NativePasswordResult = { ok: boolean; state: NativePasswordState; linked: boolean | null; indexSynchronized: boolean | null; message: string };
// Only fixed status and copy cross the UI adapter. Legacy replies never proved
// indexing; do not promote their old generic "Connected" message into success.
export function normalizeNativePasswordResult(value: unknown): NativePasswordResult {
  const result = value as Partial<NativePasswordResult> | null;
  if (result?.ok !== true) return { ok: false, state: 'unknown', linked: null, indexSynchronized: null, message: 'Password AutoFill could not connect. Check your Thingtime sign-in, then retry.' };
  if (result.state === 'index-synchronized' && result.linked === true && result.indexSynchronized === true) return { ok: true, state: result.state, linked: true, indexSynchronized: true, message: 'Account linked and password suggestions synchronized. Enable Thingtime in your device’s AutoFill & Passwords settings.' };
  if (result.state === 'linked-index-pending' && result.linked === true && result.indexSynchronized === false) return { ok: true, state: result.state, linked: true, indexSynchronized: false, message: 'Account linked. Password suggestions are not synchronized. Enable Thingtime in your device’s AutoFill & Passwords settings, then retry Connect Password AutoFill.' };
  if (result.state === 'disconnected' && result.linked === false && result.indexSynchronized === false) return { ok: true, state: result.state, linked: false, indexSynchronized: false, message: 'Password AutoFill disconnected.' };
  return { ok: true, state: 'unknown', linked: null, indexSynchronized: null, message: 'Password AutoFill status could not be verified. Update Thingtime and retry Connect Password AutoFill.' };
}

export function supportsNativePasswordProviderVersion(value: unknown): boolean {
  return typeof value === 'string' && /^1\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(value);
}
