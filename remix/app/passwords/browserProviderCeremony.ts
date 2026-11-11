import { requireThingtimeCapability, requireActiveThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import type { VerificationContext } from './verificationPolicy';
import { passwordApprovalRequest, passwordRequest } from './client';
import { createBrowserPasskeyAssertion, prepareBrowserPasskeyRegistration, requireNoExcludedBrowserPasskey, BrowserPasskeyExcludedError, BROWSER_PASSKEY_EXCLUDED_MESSAGE, validateBrowserPasskeyRequest, type BrowserPasskeyRequest } from './browserPasskey';
import { passwordFieldValue, validatePasswordEntry, type PasswordEntry } from './model';

export type ProviderRequest = BrowserPasskeyRequest & { version: 1; id: string };
export type ProviderChoice = { id: string; title: string; username: string; relyingParty?: string; credentialId?: string };
type ProviderSelection = Pick<ProviderChoice, 'id' | 'relyingParty' | 'credentialId'>;
type Vault = (body: Record<string, unknown>, signal: AbortSignal, cursor?: string) => Promise<any>;
export type BrowserProviderAttempt = { requestFingerprint?: string; sessionBinding?: string; prepared?: Awaited<ReturnType<typeof prepareBrowserPasskeyRegistration>>; id?: string; writeId?: string; context?: VerificationContext };
export function validateProviderRequest(input: unknown): ProviderRequest {
  const value = input as ProviderRequest;
  if (value?.version !== 1 || typeof value.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value.id)) throw new DOMException('Invalid passkey request.', 'DataError');
  return { ...validateBrowserPasskeyRequest(value), version: 1, id: value.id };
}
export const providerRp = (request: BrowserPasskeyRequest) => (request.type === 'create' ? request.publicKey.rp?.id : request.publicKey.rpId) || new URL(request.origin).hostname;
function matchesProviderChoice(request: ProviderRequest, item: ProviderSelection): boolean {
  const allowed = request.publicKey.allowCredentials;
  return item.relyingParty === providerRp(request) && !!item.credentialId &&
    (request.type === 'create' || !allowed?.length || allowed.some(value => value.id === item.credentialId));
}
export async function loadProviderChoices(request: ProviderRequest, vault: Vault, signal: AbortSignal): Promise<ProviderChoice[]> {
  const choices: ProviderChoice[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    signal.throwIfAborted();
    const page = await vault({ operation: 'catalog', ...(cursor ? { cursor } : {}) }, signal);
    signal.throwIfAborted();
    for (const item of page.catalog || []) if (matchesProviderChoice(request, item)) choices.push(item);
    cursor = page.nextCursor || undefined;
    if (cursor && seen.has(cursor)) throw new Error('The password list could not finish. Try again.');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return choices;
}
export function browserProviderVault(ownerId: string, mode: 'discovery' | 'approval' = 'discovery'): Vault {
  return (body, signal) => mode === 'approval' ? passwordApprovalRequest(ownerId, body, signal) : passwordRequest(ownerId, body, signal);
}
/** The extension starts its watchdog before delivery and may cancel earlier.
 * Leave time to show recovery before our estimate of that outer deadline. */
export function providerApprovalBudget(request: ProviderRequest, receivedAt: number, now = performance.now()): number {
  const timeout = Math.max(1, Math.min(request.publicKey.timeout ?? 120_000, 120_000));
  return Math.max(0, Math.floor(receivedAt + timeout - now - Math.min(1_000, timeout / 10)));
}
/** Secrets exist only in this invocation. No response leaves before durable exact readback. */
export async function runProviderCeremony(request: ProviderRequest, password: string, selected: ProviderSelection | null, vault: Vault, signal: AbortSignal, attempt: BrowserProviderAttempt = {}) {
  request = validateProviderRequest(request);
  if (Object.prototype.hasOwnProperty.call(request.publicKey.extensions || {}, 'appid')) await ensureBrowserProvider(signal, request);
  signal.throwIfAborted();
  const selectedId = selected?.id || '', credentialId = selected?.credentialId;
  if (request.type === 'get' && (!selected || !selectedId || !matchesProviderChoice(request, selected)))
    throw new DOMException('Choose a saved passkey for this website.', 'NotAllowedError');
  const fingerprint = JSON.stringify(request);
  if (attempt.requestFingerprint && attempt.requestFingerprint !== fingerprint) throw new DOMException('The passkey request changed.', 'InvalidStateError');
  attempt.requestFingerprint = fingerprint;
  const requestHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint)))).map(value=>String.fromCharCode(value)).join('');
  const context: VerificationContext = {purpose:request.type,rp:providerRp(request),entryId:request.type === 'get' ? selectedId : (attempt.id ||= crypto.randomUUID()),requestHash:btoa(requestHash).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')};
  if (attempt.context && JSON.stringify(attempt.context) !== JSON.stringify(context)) throw new DOMException('The selected passkey changed. Start again.', 'InvalidStateError');
  attempt.context = context;
  const passkeySession = () => ({ requestId: request.id, binding: attempt.sessionBinding, context });
  const verified = await vault({ operation: 'verify-passkey', requestId: request.id, password, context,
    ...(attempt.sessionBinding ? { passkeySession: passkeySession() } : {}) }, signal);
  password = '';
  signal.throwIfAborted();
  if (verified.verified !== true || verified.requestId !== request.id || typeof verified.sessionBinding !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(verified.sessionBinding) || (attempt.sessionBinding && attempt.sessionBinding !== verified.sessionBinding))
    throw new DOMException('Verify your account again.', 'NotAllowedError');
  attempt.sessionBinding = verified.sessionBinding;
  const boundVault: Vault = (body, selectedSignal, cursor) => vault({ ...body, passkeySession: passkeySession() }, selectedSignal, cursor);
  if (request.type === 'get') {
    // Approval is already bound to this entry. Recheck the choice against
    // the exact live record instead of decrypting and paging the whole vault again.
    const saved = await boundVault({ operation: 'read', id: selectedId }, signal);
    signal.throwIfAborted();
    if (saved.id !== selectedId || saved.entry?.passwordType !== 'passkey' || passwordFieldValue(saved.entry, 'credentialId') !== credentialId)
      throw new DOMException('The saved passkey changed. Start again.', 'InvalidStateError');
    const response = await createBrowserPasskeyAssertion(saved.entry, request, true);
    signal.throwIfAborted();
    // Revalidate the exact vault session after signing, before the assertion leaves.
    const current = await boundVault({ operation: 'read', id: selectedId }, signal);
    signal.throwIfAborted();
    if (current.id !== selectedId || current.revision !== saved.revision || JSON.stringify(current.entry) !== JSON.stringify(saved.entry)) throw new DOMException('The saved passkey changed. Start again.', 'InvalidStateError');
    return response;
  }
  const choices = await loadProviderChoices(request, boundVault, signal);
  const excluded: PasswordEntry[] = choices.map(value => ({ title: value.title, passwordType: 'passkey', fields: [
    { id: 'credentialId', label: 'Credential ID', type: 'text', value: value.credentialId! },
    { id: 'relyingParty', label: 'Website', type: 'text', value: value.relyingParty! },
  ] }));
  requireNoExcludedBrowserPasskey(request, excluded);
  const prepared = attempt.prepared || await prepareBrowserPasskeyRegistration(request, true, excluded);
  attempt.prepared = prepared;
  signal.throwIfAborted();
  const id = attempt.id ||= crypto.randomUUID(), writeId = attempt.writeId ||= crypto.randomUUID();
  await boundVault({ operation: 'save', id, writeId, revision: 0, entry: prepared.entry }, signal);
  signal.throwIfAborted();
  const saved = await boundVault({ operation: 'read', id }, signal);
  signal.throwIfAborted();
  // The canonical writer normalizes field labels and object property order.
  // Compare the complete canonical entries so that those normalizations do not
  // reject a durable save, while every key/handle/RP/credential value must match.
  let sameEntry = false;
  try { sameEntry = JSON.stringify(validatePasswordEntry(saved.entry)) === JSON.stringify(validatePasswordEntry(prepared.entry)); } catch { /* Fail closed on invalid stored data. */ }
  if (!sameEntry || saved.entry?.passwordType !== 'passkey' ||
    passwordFieldValue(saved.entry, 'credentialId') !== prepared.response.id) throw new Error('The saved passkey could not be verified. Registration was not completed.');
  return prepared.response;
}
export async function ensureBrowserProvider(signal: AbortSignal, request?: BrowserPasskeyRequest) {
  const appid = request?.type === 'get' && Object.prototype.hasOwnProperty.call(request.publicKey.extensions || {}, 'appid');
  await requireThingtimeCapability('api.passwords', appid ? '1.9.1' : '1.5.0');
  if (appid) await requireActiveThingtimeCapability('api.passwords', '1.9.1');
  signal.throwIfAborted();
}

/** Only our closed exclusion category is terminal; stale operations cannot paint
 * or terminate a replacement request. Other InvalidStateErrors stay distinct. */
export function browserProviderFailure(error: unknown, operation: object, current: object | null): {kind: 'excluded' | 'retryable'; message: string} | null {
  if (operation !== current) return null;
  if (error instanceof DOMException && error.name === 'TimeoutError')
    return {kind: 'retryable', message: 'Thingtime did not respond in time. Try again or choose another passkey provider.'};
  return error instanceof BrowserPasskeyExcludedError
    ? {kind: 'excluded', message: BROWSER_PASSKEY_EXCLUDED_MESSAGE}
    : {kind: 'retryable', message: error instanceof Error ? error.message : 'The passkey could not be completed.'};
}
